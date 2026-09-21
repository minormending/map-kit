# The shared database

One Supabase project holds several apps: a shared layer in `public`, and one
schema per app. This is how to work in it, and how to add the next one.

## Why it is arranged this way

The free plan allows **two active projects per account** — across every
organisation, so a second organisation does not buy a third project. Paused
projects do not count, which makes pausing the way to free a slot.

A project per app was therefore unaffordable. A schema per app is free.

Putting a second app into an existing database is a bad idea only if both use
`public`: they collide on `profiles`, `flags`, `feedback`, `rate_limit` and
whatever else the kit installs, and the grants migration of one reaches into
the other. A schema each removes every one of those collisions while keeping
the parts worth sharing — one identity, one rate limiter, one moderation queue.

**What you give up.** `auth.users` is per project, so every app shares one pool
of accounts: signing into one signs you into all of them. Storage quota is
shared too. Both are fine for a portfolio and wrong for products with separate
audiences or separate owners.

## What is in it now

Project `minormending-apps` (`gwlgmuiorzwfsimlfvuk`), us-east-1.

| schema | app | holds |
|---|---|---|
| `public` | — | `profiles`, `rate_limit`, `apps`, `moderators`, `flags`, `feedback`, and the queue views |
| `trip` | trip-companion | trips, check-ins, corrections, entity cards |
| `restroom` | restroom-map | bathrooms, codes, claims, comments, reports, credit ledger |

Each app owns its own migrations, in its own repo, tracked in its own
`<schema>.schema_migrations`. Two repos writing one tracking table is a race
nobody wins.

## Adding an app

### 1. Its first migration creates the schema

```sql
create schema if not exists myapp;
grant usage on schema myapp to anon, authenticated;

-- Supabase grants the API roles everything on each new table by default.
-- This stops that happening for tables created from here on.
alter default privileges in schema myapp revoke all on tables from anon, authenticated;

insert into public.apps (slug, name, schema, target_types)
values ('my-app', 'My App', 'myapp', array['thing'])
on conflict (slug) do nothing;
```

`target_types` is the list `submit_flag` validates against. An app with an
empty list cannot file a flag at all, which is the safe direction.

### 2. Point the migration runner at the schema

The runner creates `schema_migrations` unqualified, so it lands wherever the
search path points. Set it before migrating and each app tracks itself:

```js
await client.query(`create schema if not exists ${schema}`)
await client.query(`set search_path = ${schema}, public, extensions`)
```

`trip-companion/scripts/db.mjs` does this with a named set per app; either
shape is fine as long as the search path is set first.

### 3. Expose the schema to PostgREST

**This is the step that gets forgotten.** A schema that exists in Postgres is
invisible to the API until it is listed, and the failure is a flat
`Invalid schema: myapp` with a 406 — the database is perfect and the API will
not speak to it.

```bash
node scripts/expose-schema.mjs myapp --apply
```

It is a Management API field, not the dashboard-only setting it looks like.
Needs `SUPABASE_ACCESS_TOKEN` in `.env`; delete that line afterwards, because
it can create and delete projects across the whole account.

### 4. Tell the client which schema it owns

```ts
createClient(url, anonKey, { db: { schema: 'myapp' } })
```

The client's **type** carries its schema, so a bare `SupabaseClient` annotation
stops compiling. Infer it instead of widening it:

```ts
function connect() { return createClient(url, key, { db: { schema: 'myapp' } }) }
export type AppClient = ReturnType<typeof connect>
```

### 5. Use the shared functions, with the app argument

`submit_flag` and `submit_feedback` serve every app, so they take the caller:

```ts
supabase.rpc('submit_flag', {
  p_app: 'my-app', p_target_type: 'thing', p_target_id: id,
  p_message: text, p_contact_email: email ?? null,
})
```

Note `p_message`, not `p_reason`. Apps written before map-kit was extracted use
the older name.

### 6. Add its site to the auth redirect list

Auth is per project, so it is shared. `configure-auth.mjs` holds one allow list
covering every app's site — add a line, or a user of the new app signs in and
lands on another app's domain.

## Moving an existing app in

Harder than starting fresh, because of one thing: **`auth.users` is per
project, so its user ids do not exist in the destination.** Everything
referencing them has to be remapped, orphaned, or the users recreated.

Decide that before anything else. It is cheap while an app has no users and
expensive afterwards, which is the argument for moving an app early rather
than when it matters.

1. **Pause the source project** and download its backup from Studio's Project
   Overview. A paused project stops counting against the two-project limit, and
   its data stays put. Do not resume it — resuming needs a free slot.
2. **Split its `public`**: app tables become `<app>.*`; its `profiles`,
   `flags`, `feedback` and `rate_limit` are dropped, because the shared layer
   has them. Their *rows* may still be worth moving into the shared tables
   tagged with the app — a flag often explains a row that no longer exists, and
   that is the only surviving explanation.
3. **Keep the backup** after the move. Anything orphaned is recoverable only
   from there.

`restroom-map` did this; `trip-companion/scripts/import-restroom.mjs` is a
worked example, and the traps it hit are below.

## Traps, each of which cost an hour

**Supabase grants the API roles everything on new `public` tables.** RLS
usually covers for it — the grant is there, the policy denies, the API returns
an empty list, and it looks correct. It stops covering at a view, which runs as
its **definer** unless declared `security_invoker`: a readable view over a
locked table hands back every row it was built from. This is how a moderation
queue served contact addresses to anyone with the publishable key. The kit's
SQL now revokes its own tables; `sql/lockdown.sql` revokes the schema default
for yours.

**pg_dump bakes `SET search_path TO 'public'` into every function.** A
`LANGUAGE sql` body is validated at creation, so unqualified names inside it
resolve against the wrong schema and the import fails on the first function.

**No ordering of object types works** when restoring a dump: a function may
select from a view while a view calls a function. Defer whatever fails and
retry until a pass makes no progress.

**pg_dump precedes every statement with a comment block.** Buffer those into
the statement and a `^CREATE` match never fires.

**`COPY` appears for every schema, not just yours.** Parse only `public.` and
the other schemas' *data* flows into your SQL parser — `auth.users` bcrypt
hashes contain `$2a$10$…`, which corrupts dollar-quote tracking and destroys
statement boundaries from that point on.

**Grants are not part of the schema dump you think you are reading.** Import
tables, types, functions, views, indexes, policies and triggers and you can
still have an app that cannot read a single row.

**A trigger that did two jobs now does one.** If an app's `handle_new_user`
also awarded credits, the shared one will not. Split the app-specific half into
its own trigger, and name it to fire *after* the shared one — same-event
triggers fire in alphabetical order, and the app's row usually references the
profile.

**Deploy config and code ship separately.** Setting a repo variable after the
merge that triggered the build means the build used the old value and passed
green. Read the deployed bundle, not the check mark.

## Operating it

```bash
node scripts/db.mjs status  <set>     # applied and pending
node scripts/db.mjs migrate <set>     # apply
node scripts/db.mjs queue             # open reports, every app
node scripts/db.mjs query "<sql>"
```

Moderators are per app, not global: `public.moderators(user_id, app_slug)`, and
`is_moderator('my-app')` is what the policies check. Somebody trusted to hide a
restroom has no business rewriting a transit card.

### Checking it is still locked down

Worth running after adding an app, and after anything that creates a view:

```sql
-- Anything the API roles can reach in the shared layer.
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon','authenticated')
 order by 1, 2;

-- Views that still run as their definer.
select c.relname,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'off') as security_invoker
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v';
```

`profiles` and `apps` should show `SELECT` and nothing else. Any view answering
`off` is one stray grant away from being a leak.

And from outside, with only the publishable key — a refusal should be
`permission denied`, not an empty list:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "apikey: $ANON" -H "authorization: Bearer $ANON" \
  "$URL/rest/v1/moderation_queue?select=*"
```
