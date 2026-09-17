# map-kit

The parts [`restroom-map`](https://github.com/minormending/restroom-map) and
[`orchard-map`](https://github.com/minormending/orchard-map) would otherwise
have copied twice.

Both are the same shape: **a static bundle on GitHub Pages talking straight to
Postgres, with no server in between.** That shape forces a particular set of
decisions, and those decisions are what lives here.

> The browser can read public data and propose writes. It never decides whether
> a write is legitimate.

## What is in it

| | |
| --- | --- |
| `src/` | browser TypeScript — Supabase client, Google OAuth, Photon geocoding, freshness |
| `node/` | scripts — migration runner, moderation queue, a polite crawler, a test harness |
| `sql/` | migration templates — rate limiting, flags + feedback, accounts |

### `node/fetch.mjs` — the polite crawler

The one piece with a victim if it is wrong. Orchard and farm sites are small
businesses on shared hosting, so the crawler obeys `robots.txt`, honours
`Crawl-delay` (duboisfarms.com asks for 30 seconds and gets 30 seconds), makes
one request per host at a time, sends conditional requests so an unchanged page
costs a 304 and no body, and parks a host that fails twice rather than retrying
it into the ground. Its User-Agent names the project and links here, so anybody
reading their logs can find out what this is and how to make it stop.

It is the only module with its own test suite, and every case in
`test/robots.test.mjs` is a real `robots.txt` observed in the wild.

### `sql/` — templates, materialised once

These are not applied from the package. `readKitSql()` substitutes the
placeholders and the app writes the result into its own
`supabase/migrations/`, where it is committed as plain SQL.

That indirection is deliberate: a migration's checksum has to be stable, and a
file whose content depends on an environment variable is a file whose hash
changes underneath you. The runner refuses a migration that changed after it
was applied, and it is right to.

## Using it

```bash
pnpm add github:minormending/map-kit
```

A git dependency rather than a registry publish — `prepare` builds `dist/` on
install, which is the standard mechanism and saves maintaining npm auth in two
repos' CI for a package with two consumers.

The app's `scripts/db.mjs` is then three lines of its own:

```js
import { run } from '@minormending/map-kit/node/cli'

await run({
  root: ROOT,
  app: 'orchard-map',
  schema: { queueView: 'moderation_queue', placeTable: 'orchards', placeLabel: 'name' },
})
```

And in the browser, configuration is passed in rather than read from the
environment:

```js
const supabase = createSupabase({ supabaseUrl, supabaseAnonKey })
const auth = createAuth(supabase, { supabaseUrl, supabaseAnonKey })
```

`restroom-map` reads `import.meta.env` at module scope, which is fine in a Vite
SPA where there is exactly one environment. Astro runs the same module twice —
once on the server during the build, once in the browser as an island — and the
two do not see the same variables. A module-level read is then a value that
silently differs between them, which is the worst shape a config bug can take.

## What is deliberately not in it

**Components.** The two apps look nothing alike and should not be pushed
towards looking alike by a shared button. `useEscape` is here because it
encodes a lesson rather than a look.

**Anything domain-specific.** No confidence scoring, no credits, no claims.
Those rules are different in the two projects — a restroom's accessibility
needs two strangers to agree because nobody publishes it, while an orchard's
opening hours are published by the orchard. Sharing the mechanism would force
the wrong epistemics onto one of them.

**Schema.** The migration *runner* is shared; the migrations are not.

## Tests

```bash
node --test test/robots.test.mjs
```
