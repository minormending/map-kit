/**
 * How much to believe something, given when it was last checked.
 *
 * Both apps face the same asymmetry and it is the reason this is shared rather
 * than copied: a stale "yes" costs somebody a wasted journey, and a stale "no"
 * costs a pin somebody can restore. The cheaper mistake gets the lighter
 * weight, so nothing here ever rounds an old answer up.
 */
export type Freshness = 'fresh' | 'recent' | 'stale' | 'unknown'

export interface FreshnessRule {
  /** Within this many days, an answer is presented as current fact. */
  freshDays: number
  /** Beyond this, it is shown as history rather than as an answer. */
  staleDays: number
}

export function freshnessOf(
  checkedAt: string | Date | null | undefined,
  rule: FreshnessRule,
  now: Date = new Date(),
): Freshness {
  if (!checkedAt) return 'unknown'
  const then = checkedAt instanceof Date ? checkedAt : new Date(checkedAt)
  if (Number.isNaN(then.getTime())) return 'unknown'
  const days = (now.getTime() - then.getTime()) / 86_400_000
  if (days < 0) return 'unknown' // a future timestamp is a bug, not a fact
  if (days <= rule.freshDays) return 'fresh'
  if (days <= rule.staleDays) return 'recent'
  return 'stale'
}

/** "yesterday" / "3 days ago" / "in March". Leads with *when*, deliberately. */
export function agoLabel(
  checkedAt: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!checkedAt) return 'never checked'
  const then = checkedAt instanceof Date ? checkedAt : new Date(checkedAt)
  if (Number.isNaN(then.getTime())) return 'never checked'

  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return then.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
