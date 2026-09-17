#!/usr/bin/env node
/**
 * The database CLI both apps wrap.
 *
 * An app's scripts/db.mjs is expected to be three lines: import this, describe
 * its own schema, call run(). Everything below is identical between projects.
 */
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { withClient } from './connect.mjs'
import { status, migrate, printResult } from './migrate.mjs'
import { queue, triage, hide, unhide, resolve } from './moderation.mjs'

const USAGE = `
  db status              list applied and pending migrations
  db migrate             apply pending migrations
  db migrate --baseline  record existing files as applied without running them
  db file <path.sql>     run one SQL file
  db query "<sql>"       run ad-hoc SQL
  db query -             read SQL from stdin

  db queue               open flags and feedback, for a person
  db triage              the same queue as JSON, for a process
  db hide <id> "<why>"   take a place off the map now
  db unhide <id>         put it back
  db resolve <id>        mark a flag or feedback dealt with

Needs SUPABASE_DB_PASSWORD in .env — just the password. Host, port and user are
derived from the Supabase URL. That password bypasses RLS entirely; .env is
gitignored and must stay that way.
`

/**
 * @param {object} opts
 * @param {string} opts.root          the app's root directory
 * @param {string} opts.app           application_name for the connection
 * @param {object} opts.schema        { queueView, placeTable, placeLabel }
 */
export async function run({ root, app, schema }) {
  const migrations = join(root, 'supabase', 'migrations')
  const [cmd, ...rest] = process.argv.slice(2)

  const commands = {
    status: (c) => status(c, migrations),
    migrate: (c) => migrate(c, migrations, { baseline: rest.includes('--baseline') }),
    file: async (c) => {
      if (!rest[0]) throw new Error('which file?')
      printResult(await c.query(readFileSync(rest[0], 'utf8')))
    },
    query: async (c) => {
      const sql = rest[0] === '-' ? readFileSync(0, 'utf8') : rest[0]
      if (!sql) throw new Error('what query?')
      printResult(await c.query(sql))
    },
    queue: (c) => queue(c, schema),
    triage: (c) => triage(c, schema),
    hide: (c) => hide(c, schema, rest[0], rest.slice(1).join(' ')),
    unhide: (c) => unhide(c, schema, rest[0]),
    resolve: (c) => resolve(c, rest[0]),
  }

  if (!cmd || !(cmd in commands)) {
    console.log(USAGE)
    process.exit(cmd ? 1 : 0)
  }

  try {
    await withClient((c) => commands[cmd](c), { root, applicationName: `${app}/scripts` })
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
