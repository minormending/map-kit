/**
 * Materialise a kit SQL template into an app's migration.
 *
 * The output is written once and committed as plain SQL. It is deliberately
 * not substituted at apply time: a migration's checksum has to be stable, and
 * a file whose content depends on an environment variable is a file whose
 * hash changes under you.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql')

export function readKitSql(name, vars = {}) {
  const raw = readFileSync(join(SQL_DIR, `${name}.sql`), 'utf8')
  const out = raw.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!(key in vars)) {
      throw new Error(`${name}.sql needs a value for ${match}`)
    }
    return vars[key]
  })
  const missed = out.match(/\{\{[A-Z_]+\}\}/)
  if (missed) throw new Error(`${name}.sql still contains ${missed[0]}`)
  return out
}
