import crypto from 'node:crypto'
import { APPROVED_PAGES, PREFIX, HistoryError, fail, initialState, keyFor, parseCheckpoint, validateState, mergeMessage, nextState, errorState } from './history-core.mjs'

const stateKey = state => keyFor(state.pageId, state.conversationId, state.mode, state.messageId)
const clone = value => structuredClone(value)

/** Inject an already connected pg Client. No network requests or app helpers here. */
export class PgHistoryStore {
  constructor(client, { dryRun = true, clock = Date.now, leaseMs = 90_000, recentCycleMs = 120_000, reconcileRecentActivity = false } = {}) {
    this.client = client; this.dryRun = dryRun; this.clock = clock
    this.leaseMs = leaseMs; this.recentCycleMs = recentCycleMs; this.previewJobs = new Map()
    this.reconcileRecentActivity = reconcileRecentActivity; this.previewPauseUntil = null
  }
  async transaction(fn, readOnly = this.dryRun) {
    await this.client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN')
    try {
      await this.client.query("SET LOCAL statement_timeout='12s'")
      await this.client.query("SET LOCAL lock_timeout='3s'")
      const result = await fn()
      await this.client.query(readOnly ? 'ROLLBACK' : 'COMMIT')
      return result
    } catch (error) {
      await this.client.query('ROLLBACK').catch(() => {})
      throw error instanceof HistoryError ? error : new HistoryError('database_or_local_failure', { retryable: true })
    }
  }
  async putState(key, state) {
    validateState(state)
    if (stateKey(state) !== key) fail('checkpoint_key_identity_mismatch')
    await this.client.query(`UPDATE inbox_sync_state SET cursor=$2,last_run_at=clock_timestamp(),
      last_ok_at=CASE WHEN $3 THEN clock_timestamp() ELSE last_ok_at END,last_error=$4,updated_at=clock_timestamp() WHERE key=$1`,
    [key, JSON.stringify(state), state.status === 'complete', state.lastError])
  }
  async ensureOne(state) {
    const key = stateKey(state)
    const found = await this.client.query(`SELECT key,cursor FROM inbox_sync_state WHERE key=$1${this.dryRun ? '' : ' FOR UPDATE'}`, [key])
    if (found.rows.length) {
      const old = parseCheckpoint(found.rows[0].cursor)
      if (stateKey(old) !== key) fail('checkpoint_key_identity_mismatch')
      const canRenew = state.mode === 'recent' && old.status === 'complete' && Date.parse(state.startedAt) - Date.parse(old.startedAt) >= this.recentCycleMs
      if (!canRenew) { if (this.dryRun) this.previewJobs.set(key, old); return }
      if (this.dryRun) this.previewJobs.set(key, clone(state))
      else await this.putState(key, state)
      return
    }
    if (this.dryRun) this.previewJobs.set(key, clone(state))
    else await this.client.query('INSERT INTO inbox_sync_state(key,cursor,updated_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT(key) DO NOTHING', [key, JSON.stringify(state)])
  }
  async seed(states) {
    if (states.length > 250) fail('seed_budget_exceeded')
    await this.transaction(async () => { for (const state of states) await this.ensureOne(validateState(state)) })
  }
  async activeThreads(cutoff) {
    return this.transaction(async () => {
      const all = []
      const report = { cachedWithoutGraphId: 0, cachedActiveCapped: false }
      for (const pageId of APPROVED_PAGES) {
        const result = await this.client.query(`SELECT page_id,psid,conversation_id FROM messenger_conversations
          WHERE page_id=$1 AND last_message_at >= $2::timestamptz ORDER BY last_message_at DESC,id LIMIT 101`, [pageId, cutoff])
        if (result.rows.length > 100) report.cachedActiveCapped = true
        for (const row of result.rows.slice(0, 100)) {
          if (!row.conversation_id) { report.cachedWithoutGraphId++; continue }
          all.push({ pageId, id: row.conversation_id, psid: row.psid })
        }
      }
      return { threads: all, ...report }
    }, true)
  }
  async ratePause() {
    if (this.previewPauseUntil && Date.parse(this.previewPauseUntil) > this.clock()) return this.previewPauseUntil
    return this.transaction(async () => {
      const result = await this.client.query('SELECT cursor FROM inbox_sync_state WHERE key=$1', ['messenger:recovery:rate-pause:v1'])
      if (!result.rows.length) return null
      let value;try { value=JSON.parse(result.rows[0].cursor) } catch { fail('rate_pause_state_invalid') }
      if (!Number.isFinite(Date.parse(value?.until))) fail('rate_pause_state_invalid')
      return Date.parse(value.until)>this.clock()?value.until:null
    },true)
  }
  async pauseRateLimit(until) {
    if (!Number.isFinite(Date.parse(until))) fail('rate_pause_state_invalid')
    if (this.dryRun) { this.previewPauseUntil=until;return }
    await this.transaction(async()=>{
      await this.client.query(`INSERT INTO inbox_sync_state(key,cursor,last_run_at,updated_at)
        VALUES($1,jsonb_build_object('until',$2::timestamptz,'reason','graph_rate_limited')::text,clock_timestamp(),clock_timestamp())
        ON CONFLICT(key) DO UPDATE SET cursor=jsonb_build_object('until',GREATEST((inbox_sync_state.cursor::jsonb->>'until')::timestamptz,$2::timestamptz),'reason','graph_rate_limited')::text,
        last_run_at=clock_timestamp(),updated_at=clock_timestamp()`, ['messenger:recovery:rate-pause:v1',until])
    },false)
  }
  async claim(pageId, mode) {
    if (!APPROVED_PAGES.includes(pageId)) fail('page_not_approved')
    const now = this.clock()
    if (this.dryRun) {
      const entry = [...this.previewJobs.entries()].filter(([,s]) => s.pageId === pageId && s.mode === mode && s.status === 'pending' && (!s.retryAt || Date.parse(s.retryAt) <= now))
        .sort((a,b) => (a[1].kind === 'discovery' ? 0 : 1) - (b[1].kind === 'discovery' ? 0 : 1) || (a[1].lastClaimed ?? 0) - (b[1].lastClaimed ?? 0) || a[0].localeCompare(b[0]))[0]
      if (!entry) return null
      const [key, old] = entry, state = { ...old, lastClaimed: now, lease: { token: crypto.randomUUID(), until: new Date(now + this.leaseMs).toISOString() } }
      this.previewJobs.set(key, state)
      return { key, state: clone(state) }
    }
    return this.transaction(async () => {
      const prefix = `${PREFIX}${pageId}:${mode}:`
      const found = await this.client.query(`SELECT key,cursor FROM inbox_sync_state
        WHERE key LIKE $1 AND cursor::jsonb->>'status'='pending'
          AND (cursor::jsonb->>'retryAt' IS NULL OR (cursor::jsonb->>'retryAt')::timestamptz <= clock_timestamp())
          AND (cursor::jsonb->'lease' IS NULL OR cursor::jsonb->'lease'='null'::jsonb OR (cursor::jsonb->'lease'->>'until')::timestamptz < clock_timestamp())
        ORDER BY CASE WHEN cursor::jsonb->>'kind'='discovery' THEN 0 ELSE 1 END,last_run_at NULLS FIRST,key
        FOR UPDATE SKIP LOCKED LIMIT 1`, [prefix + '%'])
      if (!found.rows.length) return null
      const { key, cursor } = found.rows[0], state = parseCheckpoint(cursor)
      if (stateKey(state) !== key || state.pageId !== pageId || state.mode !== mode) fail('checkpoint_key_identity_mismatch')
      const time = await this.client.query('SELECT clock_timestamp() AS now')
      const serverNow = new Date(time.rows[0].now).getTime()
      const leased = { ...state, lease: { token: crypto.randomUUID(), until: new Date(serverNow + this.leaseMs).toISOString() } }
      await this.putState(key, leased)
      return { key, state: leased }
    }, false)
  }
  async pageOrder(mode) {
    if (this.dryRun) {
      return [...APPROVED_PAGES].sort((a,b) => Math.max(0,...[...this.previewJobs.values()].filter(s=>s.pageId===a&&s.mode===mode).map(s=>s.lastClaimed??0)) - Math.max(0,...[...this.previewJobs.values()].filter(s=>s.pageId===b&&s.mode===mode).map(s=>s.lastClaimed??0)))
    }
    return this.transaction(async () => {
      const result = await this.client.query(`SELECT cursor::jsonb->>'pageId' AS page_id,MAX(last_run_at) AS latest
        FROM inbox_sync_state WHERE key LIKE $1 AND cursor::jsonb->>'mode'=$2 GROUP BY cursor::jsonb->>'pageId'`, [PREFIX+'%',mode])
      const dates = new Map(result.rows.map(row=>[row.page_id,row.latest?new Date(row.latest).getTime():0]))
      return [...APPROVED_PAGES].sort((a,b)=>(dates.get(a)??0)-(dates.get(b)??0))
    }, true)
  }
  async assertLease(claim) {
    if (this.dryRun) {
      const current = this.previewJobs.get(claim.key)
      if (!current || current.lease?.token !== claim.state.lease?.token) fail('lease_lost', { retryable: true })
      return
    }
    const found = await this.client.query('SELECT cursor FROM inbox_sync_state WHERE key=$1 FOR UPDATE', [claim.key])
    const current = found.rows[0] && parseCheckpoint(found.rows[0].cursor)
    if (!current || stateKey(current) !== claim.key || current.lease?.token !== claim.state.lease?.token) fail('lease_lost', { retryable: true })
    // Token equality is decisive: an expired but unreclaimed lease may finish; a reclaimed one cannot.
  }
  async mergeRows(messages, conversations = []) {
    if (messages.length > 100 || conversations.length > 100) fail('batch_budget_exceeded')
    const stats = { observed: messages.length || conversations.length, inserted: 0, enriched: 0, unchanged: 0, timestampDifferences: 0, attachmentReview: 0 }
    const byOwner = new Map()
    for (const c of conversations) byOwner.set(`${c.pageId}:${c.psid}`, c)
    for (const m of messages) byOwner.set(`${m.page_id}:${m.psid}`, byOwner.get(`${m.page_id}:${m.psid}`) ?? { pageId: m.page_id, psid: m.psid, id: null })
    for (const owner of [...byOwner.values()].sort((a,b) => `${a.pageId}:${a.psid}`.localeCompare(`${b.pageId}:${b.psid}`))) {
      if (!APPROVED_PAGES.includes(owner.pageId) || !owner.psid || owner.psid === owner.pageId) fail('batch_owner_invalid')
      if (!this.dryRun) await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([owner.pageId, owner.psid])])
      const previous = await this.client.query(`SELECT page_id,psid,conversation_id FROM messenger_conversations
        WHERE (page_id=$1 AND psid=$2) OR ($3::text IS NOT NULL AND conversation_id=$3)${this.dryRun ? '' : ' FOR UPDATE'}`, [owner.pageId, owner.psid, owner.id])
      if (previous.rows.some(row => row.page_id !== owner.pageId || row.psid !== owner.psid || owner.id && row.conversation_id && row.conversation_id !== owner.id)) fail('stored_conversation_identity_conflict')
      if (!this.dryRun) {
        await this.client.query(`INSERT INTO messenger_conversations(page_id,psid,conversation_id) VALUES($1,$2,$3)
          ON CONFLICT(page_id,psid) DO NOTHING`, [owner.pageId, owner.psid, owner.id])
        if (owner.id) await this.client.query(`UPDATE messenger_conversations SET conversation_id=$3
          WHERE page_id=$1 AND psid=$2 AND conversation_id IS NULL`, [owner.pageId, owner.psid, owner.id])
      }
    }
    // Sequential within one short transaction; a failed merge rolls back the entire provider page.
    for (const incoming of messages) {
      let found = await this.client.query(`SELECT mid,page_id,psid,direction,body,attachments,created_at,raw,is_echo,app_id
        FROM messenger_messages WHERE mid=$1${this.dryRun ? '' : ' FOR UPDATE'}`, [incoming.mid])
      let result = mergeMessage(found.rows[0], incoming)
      if (!this.dryRun && result.action === 'insert') {
        const inserted = await this.client.query(`INSERT INTO messenger_messages(mid,page_id,psid,direction,body,attachments,created_at,raw)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::timestamptz,$8::jsonb) ON CONFLICT(mid) DO NOTHING RETURNING mid`,
        [incoming.mid,incoming.page_id,incoming.psid,incoming.direction,incoming.body,JSON.stringify(incoming.attachments),incoming.created_at,JSON.stringify(incoming.raw)])
        if (!inserted.rowCount) {
          found = await this.client.query('SELECT mid,page_id,psid,direction,body,attachments,created_at,raw,is_echo,app_id FROM messenger_messages WHERE mid=$1 FOR UPDATE', [incoming.mid])
          if (!found.rows.length) fail('insert_not_verified', { retryable: true })
          result = mergeMessage(found.rows[0], incoming)
        }
      }
      if (!this.dryRun && result.action === 'enrich') {
        const row = result.row
        const updated = await this.client.query(`UPDATE messenger_messages SET body=$2,attachments=$3::jsonb,raw=$4::jsonb
          WHERE mid=$1 AND page_id=$5 AND psid=$6 AND direction=$7 RETURNING mid`,
        [row.mid,row.body,JSON.stringify(row.attachments),JSON.stringify(row.raw),row.page_id,row.psid,row.direction])
        if (updated.rowCount !== 1) fail('enrichment_not_verified', { retryable: true })
      }
      stats[result.action === 'insert' ? 'inserted' : result.action === 'enrich' ? 'enriched' : 'unchanged']++
      if (result.timestampDifference) stats.timestampDifferences++
      if (result.attachmentReview) stats.attachmentReview++
    }
    return stats
  }
  async commitPage(claim, { messages = [], conversations = [], jobs = [], next }) {
    let newState, stats
    await this.transaction(async () => {
      await this.assertLease(claim)
      stats = await this.mergeRows(messages, conversations)
      stats.attachmentReview += jobs.filter(job => job.kind === 'message' && job.status === 'blocked' && job.lastError === 'nested_attachment_pagination_requires_review').length
      if (!this.dryRun && this.reconcileRecentActivity && claim.state.mode==='recent' && messages.length) await this.reconcileActivity(messages,claim.state.cutoff)
      newState = nextState(claim.state, next, stats, new Date(this.clock()).toISOString())
      if (!this.dryRun) {
        for (const state of jobs) await this.ensureOne(state)
        await this.putState(claim.key, newState)
      }
    })
    if (this.dryRun) {
      for (const job of jobs) {
        const key = stateKey(job), previous = this.previewJobs.get(key)
        if (!previous) this.previewJobs.set(key, clone(job))
      }
      this.previewJobs.set(claim.key, newState)
    }
    return { ...stats, complete: newState.status === 'complete', capped: newState.coverageCapped }
  }
  /** Separately enabled recent catch-up only. Operator read counters and Done state stay untouched. */
  async reconcileActivity(messages, cutoff) {
    const owners=new Map(messages.map(message=>[`${message.page_id}:${message.psid}`,{pageId:message.page_id,psid:message.psid}]))
    for(const {pageId,psid} of owners.values()) {
      const result=await this.client.query(`SELECT mid,direction,body,attachments,created_at FROM messenger_messages
        WHERE page_id=$1 AND psid=$2 AND created_at >= $3::timestamptz AND created_at <= $4::timestamptz
        ORDER BY created_at DESC,mid DESC LIMIT 100`,[pageId,psid,cutoff,new Date(this.clock()+300000).toISOString()])
      const newest=result.rows.find(row=>!JSON.stringify(row.attachments??null).includes('notification_messages_'))
      if(!newest)continue
      const snippet=(newest.body|| (newest.attachments?'[Attachment]':'')).slice(0,300)
      await this.client.query(`UPDATE messenger_conversations SET last_message_at=$3::timestamptz,last_snippet=$4,last_from_customer=$5,
        message_count=GREATEST(message_count,(SELECT count(*)::integer FROM messenger_messages WHERE page_id=$1 AND psid=$2)),updated_at=clock_timestamp()
        WHERE page_id=$1 AND psid=$2 AND (last_message_at IS NULL OR last_message_at < $3::timestamptz)`,
      [pageId,psid,new Date(newest.created_at).toISOString(),snippet,newest.direction==='in'])
    }
  }
  async failClaim(claim, error) {
    let updated = errorState(claim.state, error, this.clock())
    // A generic Graph 100 with a cursor may mean expiry. Restart once safely; exact IDs deduplicate replay.
    if (error instanceof HistoryError && error.code === 100 && claim.state.after && claim.state.cursorRestarts < 1) {
      updated = { ...updated, status: 'pending', after: null, retryAt: new Date(this.clock() + 15_000).toISOString(),
        cursorRestarts: claim.state.cursorRestarts + 1, counters: { ...updated.counters, pages: 0 }, lastError: 'cursor_restart_after_graph_100' }
    }
    if (this.dryRun) { await this.assertLease(claim); this.previewJobs.set(claim.key, updated); return updated }
    await this.transaction(async () => { await this.assertLease(claim); await this.putState(claim.key, updated) }, false)
    return updated
  }
  async status(mode) {
    const rows = this.dryRun ? [...this.previewJobs.values()].filter(s => s.mode === mode) : await this.transaction(async () => {
      const result = await this.client.query(`SELECT cursor FROM inbox_sync_state WHERE key LIKE $1 AND cursor::jsonb->>'mode'=$2 LIMIT 20001`, [PREFIX + '%', mode])
      if (result.rows.length > 20000) fail('status_budget_exceeded')
      return result.rows.map(row => parseCheckpoint(row.cursor))
    }, true)
    return APPROVED_PAGES.map(pageId => {
      const states = rows.filter(s => s.pageId === pageId)
      return { pageId, jobs: states.length, pending: states.filter(s => s.status === 'pending').length,
        complete: states.filter(s => s.status === 'complete').length, blocked: states.filter(s => s.status === 'blocked').length,
        capped: states.filter(s => s.coverageCapped).length,
        errors: [...new Set(states.map(s => s.lastError).filter(Boolean))].slice(0, 20) }
    })
  }
}
