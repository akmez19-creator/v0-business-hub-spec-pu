const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const attachmentCount = value => Array.isArray(value) ? value.length : Array.isArray(value?.data) ? value.data.length : 0

/** Claim the first real webhook only for our own Graph recovery provenance marker. */
export function firstRecoveryWebhook(stored, incoming, observedAt) {
  if (stored.mid !== incoming.mid || stored.page_id !== incoming.pageId || stored.psid !== incoming.psid || stored.direction !== incoming.direction) throw new Error('Messenger message identity conflict')
  const marker = object(stored.raw) && stored.raw._akmez_history
  if (!object(marker) || marker.version !== 1 || marker.source !== 'meta_graph' || marker.liveWebhookSeen === true) return null
  const existingTime = new Date(stored.created_at).getTime(), liveTime = Date.parse(incoming.createdAt)
  const sameSecond = Number.isFinite(liveTime) && Math.floor(existingTime / 1000) === Math.floor(liveTime / 1000)
  return {
    body: stored.body || incoming.body || null,
    // Preserve the recovered set when the two delivery shapes cannot be merged by proven attachment IDs.
    attachments: attachmentCount(stored.attachments) > 0 ? stored.attachments : incoming.attachments ?? stored.attachments,
    // Recover the richer webhook timestamp only when both observations identify the same second.
    createdAt: sameSecond ? incoming.createdAt : new Date(stored.created_at).toISOString(),
    isEcho: incoming.isEcho ?? stored.is_echo ?? false,
    appId: incoming.appId ?? stored.app_id ?? null,
    // Use the time visible before enrichment when deciding whether an operator already read it.
    recoveredCreatedAt: new Date(stored.created_at).toISOString(),
    raw: { ...(object(incoming.raw) ? incoming.raw : { webhook_raw: incoming.raw ?? null }),
      _akmez_history: { ...marker, liveWebhookSeen: true, liveWebhookSeenAt: observedAt },
      _akmez_history_observation: stored.raw.message ?? null },
  }
}

/** Delayed recovered inbound is unread only if neither a read nor a later outgoing covers it. */
export function recoveredInboundIsUnread(createdAt, readThrough, lastOutgoingAt) {
  const created = Date.parse(createdAt)
  if (!Number.isFinite(created)) throw new Error('Invalid recovered Messenger timestamp')
  const parsed = value => {
    if (value === null || value === undefined) return -Infinity
    const time = new Date(value).getTime()
    if (!Number.isFinite(time)) throw new Error('Invalid Messenger read watermark')
    return time
  }
  return created > parsed(readThrough) && created > parsed(lastOutgoingAt)
}
