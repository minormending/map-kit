/**
 * Migrations, applied in filename order and tracked by hash.
 *
 * Never edit a migration that has been applied — the hash check will refuse
 * it, and it is right to. Add another.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'

const TRACKING = `
create table if not exists schema_migrations (
  version    text primary key,
  checksum   text not null,
  applied_at timestamptz not null default now()
);`

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

export function migrationFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(dir, f), 'utf8')
      return { version: basename(f, '.sql'), file: f, sql, checksum: sha(sql) }
    })
}

async function appliedMap(client) {
  await client.query(TRACKING)
  const { rows } = await client.query('select version, checksum from schema_migrations')
  return new Map(rows.map((r) => [r.version, r.checksum]))
}

export async function status(client, dir) {
  const applied = await appliedMap(client)
  const files = migrationFiles(dir)
  if (files.length === 0) return console.log('no migration files found')
  for (const m of files) {
    const known = applied.get(m.version)
    const state = known === undefined ? 'PENDING'
      : known === m.checksum ? 'applied'
      : 'applied (FILE CHANGED SINCE)'
    console.log(`  ${state.padEnd(28)} ${m.file}`)
  }
  const pending = files.filter((m) => !applied.has(m.version)).length
  console.log(`\n${files.length} migration${files.length === 1 ? '' : 's'}, ${pending} pending`)
}

export async function migrate(client, dir, { baseline = false } = {}) {
  const applied = await appliedMap(client)
  const pending = migrationFiles(dir).filter((m) => !applied.has(m.version))

  if (pending.length === 0) return console.log('nothing to apply')

  if (baseline) {
    for (const m of pending) {
      await client.query(
        'insert into schema_migrations (version, checksum) values ($1, $2) on conflict do nothing',
        [m.version, m.checksum])
      console.log(`  recorded (not run)  ${m.file}`)
    }
    console.log(`\nbaselined ${pending.length} migration${pending.length === 1 ? '' : 's'}`)
    return
  }

  for (const m of pending) {
    process.stdout.write(`  applying ${m.file} ... `)
    // Each migration is one transaction: it lands whole or not at all.
    await client.query('begin')
    try {
      await client.query(m.sql)
      await client.query(
        'insert into schema_migrations (version, checksum) values ($1, $2)',
        [m.version, m.checksum])
      await client.query('commit')
      console.log('ok')
    } catch (err) {
      await client.query('rollback')
      console.log('FAILED')
      console.error(`\n${err.message}`)
      if (err.position) console.error(`  at character ${err.position}`)
      if (err.hint) console.error(`  hint: ${err.hint}`)
      process.exit(1)
    }
  }
  console.log(`\napplied ${pending.length} migration${pending.length === 1 ? '' : 's'}`)
}

/** Print any query result as a table a person can read. */
export function printResult(res) {
  const results = Array.isArray(res) ? res : [res]
  for (const r of results) {
    if (!r) continue
    if (!r.rows || r.rows.length === 0) {
      console.log(`${r.command ?? 'OK'}${r.rowCount != null ? ` ${r.rowCount}` : ''}`)
      continue
    }
    const cols = r.fields.map((f) => f.name)
    const cell = (v) =>
      v === null ? 'NULL'
        : v instanceof Date ? v.toISOString()
        : typeof v === 'object' ? JSON.stringify(v)
        : String(v)
    const widths = cols.map((c, i) =>
      Math.max(c.length, ...r.rows.map((row) => cell(row[cols[i]]).length)))
    const line = (chars) => chars.map((c, i) => c.padEnd(widths[i])).join('  ')
    console.log(line(cols))
    console.log(widths.map((w) => '-'.repeat(w)).join('  '))
    for (const row of r.rows) console.log(line(cols.map((c) => cell(row[c]))))
    console.log(`(${r.rows.length} row${r.rows.length === 1 ? '' : 's'})`)
  }
}
