/**
 * The moderation queue, for a person and for a process.
 *
 * Table and column names are injected because the two apps disagree on them
 * (`bathrooms.status` / `orchards.status`) while the shape of the work is
 * identical: read what is open, hide something, put it back, mark it dealt
 * with. Hiding is always a soft delete — the evidence outlives the thing it
 * was about, which is what stops a deletion becoming unexplainable six months
 * later.
 */

/**
 * @typedef {object} ModerationSchema
 * @property {string} queueView    view unioning flags and feedback
 * @property {string} placeTable   the table a flag can be about
 * @property {string} placeLabel   column holding a human-readable name
 */

export async function queue(client, schema) {
  const { rows } = await client.query(`
    select id, kind, subject, message, contact_email, target_id, created_at
      from ${schema.queueView}
     where resolved_at is null
     -- anything with a contact address first: somebody is waiting on a reply
     order by (contact_email is null), created_at
     limit 50`)

  if (rows.length === 0) return console.log('queue is empty')

  for (const r of rows) {
    const when = new Date(r.created_at).toISOString().slice(0, 10)
    console.log(`\n  ${r.id}  ${when}  ${r.kind}`)
    if (r.subject) console.log(`    ${r.subject}`)
    if (r.target_id) console.log(`    about: ${r.target_id}`)
    if (r.contact_email) console.log(`    reply to: ${r.contact_email}`)
    // The message is a stranger's free text. It is printed, never obeyed.
    if (r.message) console.log(`    "${String(r.message).slice(0, 400)}"`)
  }
  console.log(`\n${rows.length} open`)
}

/** The same queue as JSON, for a process rather than a person. */
export async function triage(client, schema) {
  const { rows } = await client.query(`
    select id, kind, subject, message, contact_email, target_id, created_at
      from ${schema.queueView}
     where resolved_at is null
     order by (contact_email is null), created_at
     limit 25`)
  console.log(JSON.stringify({ open: rows.length, items: rows }, null, 2))
}

export async function hide(client, schema, id, why) {
  if (!why) {
    console.error('a reason is required — it goes on the record')
    process.exit(1)
  }
  const res = await client.query(
    `update ${schema.placeTable} set status = 'hidden' where id = $1 returning ${schema.placeLabel}`,
    [id])
  if (res.rowCount === 0) {
    console.error(`no such row: ${id}`)
    process.exit(1)
  }
  // The reason is written as a resolved flag so the hide explains itself.
  await client.query(
    `insert into flags (target_type, target_id, kind, message, resolved_at)
     values ($1, $2, 'moderator', $3, now())`,
    [schema.placeTable.replace(/s$/, ''), id, why])
  console.log(`hidden: ${res.rows[0][schema.placeLabel]}\n  reason: ${why}`)
}

export async function unhide(client, schema, id) {
  const res = await client.query(
    `update ${schema.placeTable} set status = 'active' where id = $1 returning ${schema.placeLabel}`,
    [id])
  if (res.rowCount === 0) {
    console.error(`no such row: ${id}`)
    process.exit(1)
  }
  console.log(`back on the map: ${res.rows[0][schema.placeLabel]}`)
}

export async function resolve(client, id) {
  for (const table of ['flags', 'feedback']) {
    const res = await client.query(
      `update ${table} set resolved_at = now() where id = $1 and resolved_at is null`,
      [id])
    if (res.rowCount > 0) return console.log(`resolved ${table.slice(0, -1)} ${id}`)
  }
  console.error(`nothing open with id ${id}`)
  process.exit(1)
}
