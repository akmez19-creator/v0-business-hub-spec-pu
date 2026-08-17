/**
 * One-time seed of the inbox cache from the Graph API.
 *
 * Threads and comments already on Facebook predate the webhook, so nothing
 * would show until each one received a new message. This walks them once.
 *
 * Deliberately cheap: ONE /conversations call and ONE nested /feed call per
 * Page (12 requests total for 6 Pages). Per-thread transcripts are NOT
 * fetched - that fan-out is exactly what exhausted the hourly cap - they are
 * hydrated lazily when a thread is first opened.
 *
 * Stops immediately on error #4 and records where it stopped, so it can be
 * re-run later instead of hammering an already-exhausted quota.
 *
 *   node --env-file=.env.development.local scripts/backfill-inbox-cache.mjs
 */
import { createClient } from '@supabase/supabase-js'

const GRAPH = 'https://graph.facebook.com/v21.0'
const TOKEN = process.env.FACEBOOK_ACCESS_TOKEN
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004])

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

class RateLimited extends Error {}

async function graph(url) {
  const res = await fetch(url)
  const json = await res.json()
  if (json.error) {
    if (RATE_LIMIT_CODES.has(json.error.code)) throw new RateLimited(json.error.message)
    throw new Error(`${json.error.code}: ${json.error.message}`)
  }
  return json
}

async function main() {
  if (!TOKEN) throw new Error('FACEBOOK_ACCESS_TOKEN is not set')

  const pages = (await graph(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=25&access_token=${TOKEN}`)).data ?? []
  console.log(`[v0] ${pages.length} pages reachable`)

  let threads = 0
  let comments = 0

  for (const page of pages) {
    // ---- conversations -----------------------------------------------------
    try {
      const url =
        `${GRAPH}/${page.id}/conversations?fields=id,snippet,updated_time,unread_count,message_count,participants,` +
        `${encodeURIComponent('messages.limit(1){from,created_time}')}&limit=100&access_token=${page.access_token}`
      const convos = (await graph(url)).data ?? []

      const rows = []
      for (const c of convos) {
        const customer = (c.participants?.data ?? []).find((p) => p.id !== page.id)
        if (!customer) continue
        const newest = c.messages?.data?.[0]
        rows.push({
          page_id: page.id,
          psid: customer.id,
          conversation_id: c.id,
          page_name: page.name,
          customer_name: customer.name ?? null,
          last_message_at: c.updated_time ?? null,
          last_snippet: c.snippet ?? '',
          // Who spoke last decides whether this thread is waiting on us.
          last_from_customer: newest?.from?.id ? newest.from.id !== page.id : false,
          message_count: c.message_count ?? 0,
          unread_count: c.unread_count ?? 0,
          updated_at: new Date().toISOString(),
        })
      }

      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db
          .from('messenger_conversations')
          .upsert(rows.slice(i, i + 200), { onConflict: 'page_id,psid' })
        if (error) console.log(`[v0]   upsert error: ${error.message}`)
      }
      threads += rows.length
      console.log(`[v0] ${page.name}: ${rows.length} threads`)
    } catch (e) {
      if (e instanceof RateLimited) {
        console.log(`[v0] RATE LIMITED on ${page.name} - stopping, re-run later`)
        await note('backfill', e.message)
        return { threads, comments, stopped: true }
      }
      console.log(`[v0] ${page.name}: conversations failed - ${e.message}`)
    }

    // ---- comments ----------------------------------------------------------
    try {
      const url =
        `${GRAPH}/${page.id}/feed?fields=id,message,permalink_url,` +
        `${encodeURIComponent('comments.limit(50){id,message,created_time,from,like_count,is_hidden,permalink_url,parent,comments.limit(10){id,message,created_time,from}}')}` +
        `&limit=50&access_token=${page.access_token}`
      const posts = (await graph(url)).data ?? []

      const rows = []
      for (const post of posts) {
        for (const c of post.comments?.data ?? []) {
          const fromPage = c.from?.id === page.id
          rows.push({
            comment_id: c.id,
            post_id: post.id,
            parent_id: null,
            page_id: page.id,
            page_name: page.name,
            author_id: c.from?.id ?? null,
            // Usually null: Meta withholds `from` without Page Public Content
            // Access. Expected, not a failure.
            author_name: c.from?.name ?? null,
            message: c.message ?? null,
            created_time: c.created_time ?? null,
            from_page: fromPage,
            is_hidden: Boolean(c.is_hidden),
            like_count: c.like_count ?? 0,
            permalink: c.permalink_url ?? null,
            post_message: post.message ?? '',
            post_permalink: post.permalink_url ?? null,
            updated_at: new Date().toISOString(),
          })
          for (const r of c.comments?.data ?? []) {
            rows.push({
              comment_id: r.id,
              post_id: post.id,
              parent_id: c.id,
              page_id: page.id,
              page_name: page.name,
              author_id: r.from?.id ?? null,
              author_name: r.from?.name ?? null,
              message: r.message ?? null,
              created_time: r.created_time ?? null,
              from_page: r.from?.id === page.id,
              // Explicit: upsert sends the full column list, so a missing key
              // becomes an explicit NULL and trips the NOT NULL constraint
              // rather than falling back to the column default.
              is_hidden: false,
              like_count: 0,
              post_message: post.message ?? '',
              updated_at: new Date().toISOString(),
            })
          }
        }
      }

      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db
          .from('page_comments')
          .upsert(rows.slice(i, i + 200), { onConflict: 'comment_id' })
        if (error) console.log(`[v0]   comment upsert error: ${error.message}`)
      }
      comments += rows.length
      console.log(`[v0] ${page.name}: ${rows.length} comments`)
    } catch (e) {
      if (e instanceof RateLimited) {
        console.log(`[v0] RATE LIMITED on ${page.name} comments - stopping, re-run later`)
        await note('backfill', e.message)
        return { threads, comments, stopped: true }
      }
      console.log(`[v0] ${page.name}: comments failed - ${e.message}`)
    }
  }

  await note('backfill', null)
  return { threads, comments, stopped: false }
}

async function note(key, error) {
  await db.from('inbox_sync_state').upsert(
    {
      key,
      last_run_at: new Date().toISOString(),
      last_ok_at: error ? null : new Date().toISOString(),
      last_error: error,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  )
}

main()
  .then((r) => console.log(`[v0] done: ${r.threads} threads, ${r.comments} comments, stopped=${r.stopped}`))
  .catch((e) => {
    console.error('[v0] backfill failed:', e.message)
    process.exit(1)
  })
