/**
 * Database connection for an app's scripts.
 *
 * Needs SUPABASE_DB_PASSWORD in the app's .env — just the password. Host, port
 * and user are derived from VITE_SUPABASE_URL. Set SUPABASE_DB_URL instead if
 * you would rather supply a full connection string. .env is gitignored either
 * way, and it holds full database access that bypasses RLS entirely.
 *
 * The app's root is passed in rather than derived from this file's location,
 * because in a consuming project this file lives in node_modules and its own
 * directory says nothing about where the .env is.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

export function loadEnv(root) {
  const path = join(root, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (!(m[1] in process.env)) process.env[m[1]] = value
  }
}

export function dbConfig({ root, applicationName = 'map-kit/scripts' }) {
  loadEnv(root)
  const common = {
    // Supabase terminates TLS at the pooler with a cert Node's default trust
    // store does not carry. The channel is still encrypted.
    ssl: { rejectUnauthorized: false },
    application_name: applicationName,
    connectionTimeoutMillis: 15_000,
  }

  // A full URL wins if you have set one.
  if (process.env.SUPABASE_DB_URL) {
    return { connectionString: process.env.SUPABASE_DB_URL, ...common }
  }

  // Otherwise derive it: the project ref is already in the public API URL, and
  // the password is passed as a field rather than interpolated into a URL, so
  // characters like @ : / # need no escaping.
  const password = process.env.SUPABASE_DB_PASSWORD
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(
    process.env.VITE_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL ?? '')?.[1]

  if (password && ref) {
    return {
      host: process.env.SUPABASE_DB_HOST ?? 'aws-0-us-east-1.pooler.supabase.com',
      port: Number(process.env.SUPABASE_DB_PORT ?? 5432),
      database: 'postgres',
      user: `postgres.${ref}`,
      password,
      ...common,
    }
  }

  console.error(`No database credentials found.

Add ONE line to .env:

  SUPABASE_DB_PASSWORD=your-database-password

That is the password from when the project was created. If it was not saved,
reset it at Database Settings -> Database password. Everything else (host,
port, user) is derived from the Supabase URL.

Alternatively set a full SUPABASE_DB_URL if you would rather paste a
connection string. .env is gitignored either way.`)
  process.exit(1)
}

export async function withClient(fn, options) {
  const client = new pg.Client(dbConfig(options))
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
