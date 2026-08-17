/**
 * Remove "Offers and announcements" marketing blasts from the Messenger cache.
 *
 * Subscribing the marketing_message_* webhook fields made Meta echo every
 * broadcast into entry.messaging looking exactly like an outbound reply, so
 * the inbox filled with nameless "Unknown customer / No preview" rows and -
 * worse - real leads got bumped and flagged as already answered.
 *
 * The webhook now drops these on arrival; this cleans up what already landed.
 *
 * Two distinct repairs, because the damage differs:
 *  - a blast to someone we had never seen invented a whole thread -> delete it
 *  - a blast to a REAL lead only corrupted the summary -> restore it from
 *    Graph. It cannot be left to the normal sync, which never moves
 *    last_message_at backwards and so would keep the bogus "now" forever.
 *
 * Safe to re-run. Never deletes a thread that has a real name or real stored
 * messages: transcripts are hydrated lazily, so "no messages stored" alone
 * does NOT mean a thread is fake.
 *
 * Finally, puts a name on any thread still reading "Unknown customer".
 *
 * Usage: node --env-file=.env.development.local scripts/repair-messenger-inbox.mjs
 */
import { createClient } from '@supabase/supabase-js'

const GRAPH = 'https://graph.facebook.com/v21.0'
const MARKER = 'notification_messages_'

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/** Page access tokens, so a thread's true state can be re-read from Graph. */
async function pageTokens() {
  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (!token) return {}
  const res = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(token)}`,
  )
  const json = await res.json()
  if (json.error) {
    console.log('[v0] could not load page tokens:', json.error.message)
    return {}
  }
  return Object.fromEntries((json.data ?? []).map((p) => [p.id, p.access_token]))
}

// The three repairs are independent: a run with no new broadcasts must still
// name unknown threads and restore blank previews, so purging cannot early
// return out of the whole script.
async function main() {
  const tokens = await pageTokens()
  await purgeBroadcasts(tokens)
  await nameUnknownThreads(tokens)
  await fixBlankPreviews()
}

async function purgeBroadcasts(tokens) {
  const { data: echoes, error } = await db
    .from('messenger_messages')
    .select('mid,page_id,psid,raw')
    .eq('is_echo', true)
  if (error) throw new Error(error.message)

  const blasts = (echoes ?? []).filter((m) => {
    try {
      return JSON.stringify(m.raw?.message?.attachments ?? '').includes(MARKER)
    } catch {
      return false
    }
  })

  if (blasts.length === 0) {
    console.log('[v0] no marketing broadcasts found - nothing to clean')
    return
  }
  console.log(`[v0] found ${blasts.length} marketing broadcast messages`)

  await db
    .from('messenger_messages')
    .delete()
    .in('mid', blasts.map((m) => m.mid))

  const affected = [...new Set(blasts.map((m) => `${m.page_id}|${m.psid}`))]
  let deleted = 0
  let repaired = 0
  let untouched = 0

  for (const key of affected) {
    const [pageId, psid] = key.split('|')
    const { data: convo } = await db
      .from('messenger_conversations')
      .select('id,customer_name,message_count')
      .eq('page_id', pageId)
      .eq('psid', psid)
      .maybeSingle()
    if (!convo) continue

    const { count: remaining } = await db
      .from('messenger_messages')
      .select('*', { count: 'exact', head: true })
      .eq('page_id', pageId)
      .eq('psid', psid)

    // Phantom: the blast is the ONLY reason this row exists.
    if (!convo.customer_name && (remaining ?? 0) === 0) {
      await db.from('messenger_conversations').delete().eq('id', convo.id)
      deleted += 1
      continue
    }

    // Real thread: re-read the true summary from Graph and restore it.
    const token = tokens[pageId]
    if (!token) {
      untouched += 1
      continue
    }
    const res = await fetch(
      `${GRAPH}/${pageId}/conversations?user_id=${psid}` +
        `&fields=updated_time,snippet,unread_count,message_count&access_token=${encodeURIComponent(token)}`,
    )
    const json = await res.json()
    const thread = json?.data?.[0]
    if (json.error || !thread) {
      console.log(`[v0] could not re-read thread ${psid}:`, json.error?.message ?? 'not found')
      untouched += 1
      continue
    }

    await db
      .from('messenger_conversations')
      .update({
        last_message_at: thread.updated_time,
        last_snippet: thread.snippet ?? '',
        unread_count: thread.unread_count ?? 0,
        message_count: thread.message_count ?? convo.message_count,
        updated_at: new Date().toISOString(),
      })
      .eq('id', convo.id)
    repaired += 1
    console.log(`[v0] repaired ${convo.customer_name}: "${(thread.snippet ?? '').slice(0, 50)}"`)
  }

  console.log(
    `[v0] done - ${deleted} phantom threads deleted, ${repaired} real threads repaired, ${untouched} left for sync`,
  )
}

/**
 * Replace "No preview" with a real label where the last message was a photo,
 * video or voice note. Mirrors snippetFor() in lib/messenger/store.ts, which
 * now does this at write time; this only repairs rows written before that.
 */
async function fixBlankPreviews() {
  const { data: blank } = await db
    .from('messenger_conversations')
    .select('id,page_id,psid')
    .or('last_snippet.is.null,last_snippet.eq.')

  if (!blank?.length) {
    console.log('[v0] no blank previews')
    return
  }

  const label = { image: '[Photo]', video: '[Video]', audio: '[Voice message]', file: '[File]' }
  let fixed = 0

  for (const c of blank) {
    const { data: last } = await db
      .from('messenger_messages')
      .select('body,raw')
      .eq('page_id', c.page_id)
      .eq('psid', c.psid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!last) continue

    const text = last.body?.trim()
    const attachments = last.raw?.message?.attachments
    const snippet = text || (attachments?.length ? (label[attachments[0]?.type] ?? '[Attachment]') : '')
    if (!snippet) continue

    await db.from('messenger_conversations').update({ last_snippet: snippet }).eq('id', c.id)
    fixed += 1
  }
  console.log(`[v0] restored ${fixed}/${blank.length} blank previews`)
}

/**
 * Put a name on every thread still showing "Unknown customer".
 *
 * These are genuine threads created by the webhook, which stores only the ids
 * Meta sends. Note the endpoint: /{page}/conversations?user_id= resolves the
 * participant, while the obvious /{psid}?fields=name fails with "Object does
 * not exist, cannot be loaded due to missing permissions" for the same id.
 */
async function nameUnknownThreads(tokens) {
  const { data: unnamed } = await db
    .from('messenger_conversations')
    .select('id,page_id,psid')
    .is('customer_name', null)

  if (!unnamed?.length) {
    console.log('[v0] no unnamed threads')
    return
  }

  let named = 0
  for (const c of unnamed) {
    const token = tokens[c.page_id]
    if (!token) continue
    try {
      const res = await fetch(
        `${GRAPH}/${c.page_id}/conversations?user_id=${c.psid}` +
          `&fields=participants&access_token=${encodeURIComponent(token)}`,
      )
      const json = await res.json()
      const person = (json?.data?.[0]?.participants?.data ?? []).find((p) => p.id !== c.page_id)
      if (!person?.name) continue
      await db.from('messenger_conversations').update({ customer_name: person.name }).eq('id', c.id)
      named += 1
      console.log(`[v0] named ${c.psid} -> ${person.name}`)
    } catch (e) {
      console.log(`[v0] could not name ${c.psid}:`, e.message)
    }
  }
  console.log(`[v0] named ${named}/${unnamed.length} previously unknown threads`)
}

main().catch((e) => {
  console.error('[v0] purge failed:', e.message)
  process.exit(1)
})
