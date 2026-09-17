/**
 * A crawler that is invisible to the sites it visits.
 *
 * These are small businesses on shared hosting. A farm's whole web presence is
 * often one WordPress install on a cheap plan, and the difference between a
 * useful dataset and a bad neighbour is entirely in this file.
 *
 * Five rules, all enforced here rather than left to each caller:
 *
 *   robots.txt is fetched, parsed and obeyed, per host, cached for a day.
 *   Crawl-delay is honoured — duboisfarms.com asks for 30 seconds and gets it.
 *   One request per host at a time, never concurrent.
 *   Conditional requests, so an unchanged page costs a 304 and no body.
 *   A host that fails twice in a row is parked, not retried into the ground.
 *
 * The User-Agent names the project and links to the repo, so anybody reading
 * their logs can find out what this is and how to make it stop.
 */

const DEFAULT_UA =
  'map-kit-crawler/0.1 (+https://github.com/minormending/map-kit; polite, obeys robots.txt)'

/** Rules for one host, as parsed out of its robots.txt. */
function parseRobots(text, agent) {
  const lines = text.split('\n').map((l) => l.replace(/#.*$/, '').trim())
  const groups = []
  let current = null
  let lastKey = null

  for (const line of lines) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()

    if (key === 'user-agent') {
      // Consecutive User-agent lines share one group of rules.
      if (!current || lastKey !== 'user-agent') {
        current = { agents: [], rules: [], delay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
    } else if (current) {
      if (key === 'disallow') current.rules.push({ allow: false, path: value })
      else if (key === 'allow') current.rules.push({ allow: true, path: value })
      else if (key === 'crawl-delay') {
        const n = Number(value)
        if (Number.isFinite(n)) current.delay = n
      }
    }
    lastKey = key
  }

  const token = agent.split('/')[0].toLowerCase()
  // A group naming us wins over the wildcard group; that is the whole point of
  // naming ourselves.
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && token.includes(a)))
  const star = groups.find((g) => g.agents.includes('*'))
  const group = mine ?? star ?? { rules: [], delay: null }

  return { rules: group.rules, delay: group.delay }
}

/** Longest match wins; Allow beats Disallow at equal length, per the spec. */
function allowedBy(rules, pathname) {
  let best = null
  for (const r of rules) {
    // An empty Disallow means "nothing is disallowed" — not "/".
    if (r.path === '') continue
    const parts = r.path.split('*')
    let idx = 0
    let ok = true
    for (const part of parts) {
      if (part === '') continue
      const at = pathname.indexOf(part, idx)
      if (at === -1) { ok = false; break }
      idx = at + part.length
    }
    // A rule anchored at / must match from the start.
    if (ok && r.path.startsWith('/') && !pathname.startsWith(r.path.split('*')[0])) ok = false
    if (!ok) continue
    if (!best || r.path.length > best.path.length ||
        (r.path.length === best.path.length && r.allow)) {
      best = r
    }
  }
  return best ? best.allow : true
}

export class PoliteFetcher {
  /**
   * @param {object} opts
   * @param {string} [opts.userAgent]
   * @param {number} [opts.minDelayMs]   floor between requests to one host
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.maxPagesPerHost]
   * @param {Map}    [opts.cache]        etag/last-modified store, url keyed
   */
  constructor(opts = {}) {
    this.ua = opts.userAgent ?? DEFAULT_UA
    this.minDelayMs = opts.minDelayMs ?? 1500
    this.timeoutMs = opts.timeoutMs ?? 20_000
    this.maxPagesPerHost = opts.maxPagesPerHost ?? 6
    this.cache = opts.cache ?? new Map()

    this.robots = new Map()   // host -> { rules, delay, fetchedAt }
    this.lastHit = new Map()  // host -> epoch ms
    this.counts = new Map()   // host -> pages this run
    this.failures = new Map() // host -> consecutive failures
    this.chains = new Map()   // host -> promise, serialising that host
    this.stats = { fetched: 0, notModified: 0, blocked: 0, failed: 0, parked: 0 }
  }

  async robotsFor(host, scheme) {
    const known = this.robots.get(host)
    if (known && Date.now() - known.fetchedAt < 86_400_000) return known

    let parsed = { rules: [], delay: null }
    try {
      const res = await fetch(`${scheme}//${host}/robots.txt`, {
        headers: { 'user-agent': this.ua },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'follow',
      })
      // 4xx means no robots.txt, which means everything is permitted.
      if (res.ok) parsed = parseRobots(await res.text(), this.ua)
    } catch {
      // Unreachable robots.txt is not permission to hammer the host, but it is
      // also not a reason to give up on it. Fall back to the default delay.
    }
    const entry = { ...parsed, fetchedAt: Date.now() }
    this.robots.set(host, entry)
    return entry
  }

  async waitFor(host, delayMs) {
    const last = this.lastHit.get(host) ?? 0
    const due = last + delayMs - Date.now()
    if (due > 0) await new Promise((r) => setTimeout(r, due))
    this.lastHit.set(host, Date.now())
  }

  /**
   * Fetch one URL, or explain why not.
   *
   * @returns {Promise<{ok: boolean, status: number, reason?: string,
   *   body?: string, url?: string, notModified?: boolean}>}
   */
  async get(rawUrl) {
    let url
    try {
      url = new URL(rawUrl)
    } catch {
      return { ok: false, status: 0, reason: 'bad-url' }
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { ok: false, status: 0, reason: 'bad-scheme' }
    }

    const host = url.host
    // One request per host at a time. Chaining onto the host's own promise is
    // what makes that true even when callers fire everything at once.
    const previous = this.chains.get(host) ?? Promise.resolve()
    const run = previous.then(
      () => this.getOne(url, host),
      () => this.getOne(url, host),
    )
    this.chains.set(host, run.catch(() => {}))
    return run
  }

  async getOne(url, host) {
    if ((this.failures.get(host) ?? 0) >= 2) {
      this.stats.parked++
      return { ok: false, status: 0, reason: 'host-parked' }
    }
    const seen = this.counts.get(host) ?? 0
    if (seen >= this.maxPagesPerHost) {
      return { ok: false, status: 0, reason: 'host-page-cap' }
    }

    const robots = await this.robotsFor(host, url.protocol)
    if (!allowedBy(robots.rules, url.pathname)) {
      this.stats.blocked++
      return { ok: false, status: 0, reason: 'robots-disallow' }
    }

    // Crawl-delay is a request, and it is granted. Never go below our floor.
    const delay = Math.max(this.minDelayMs, (robots.delay ?? 0) * 1000)
    await this.waitFor(host, delay)

    const key = url.href
    const prior = this.cache.get(key)
    const headers = { 'user-agent': this.ua, accept: 'text/html,*/*;q=0.8' }
    if (prior?.etag) headers['if-none-match'] = prior.etag
    if (prior?.lastModified) headers['if-modified-since'] = prior.lastModified

    this.counts.set(host, seen + 1)

    try {
      const res = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeoutMs),
      })

      if (res.status === 304) {
        this.failures.set(host, 0)
        this.stats.notModified++
        return { ok: true, status: 304, notModified: true, url: res.url }
      }
      if (!res.ok) {
        // 4xx is the page's answer, not the host failing. Only 5xx and network
        // errors count towards parking a host.
        if (res.status >= 500) this.failures.set(host, (this.failures.get(host) ?? 0) + 1)
        this.stats.failed++
        return { ok: false, status: res.status, reason: `http-${res.status}` }
      }

      const body = await res.text()
      this.cache.set(key, {
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
      })
      this.failures.set(host, 0)
      this.stats.fetched++
      return { ok: true, status: res.status, body, url: res.url }
    } catch (err) {
      this.failures.set(host, (this.failures.get(host) ?? 0) + 1)
      this.stats.failed++
      return { ok: false, status: 0, reason: err.name === 'TimeoutError' ? 'timeout' : 'network' }
    }
  }
}

export { parseRobots, allowedBy, DEFAULT_UA }
