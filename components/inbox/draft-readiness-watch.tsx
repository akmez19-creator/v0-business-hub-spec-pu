'use client'

import { useEffect, useRef } from 'react'
import { createDraftReadinessClient, draftContextStatus, validDraftScope,
  type DraftScope, type DraftContextStatus } from './draft-readiness-client'

/**
 * Headless: keeps this thread's AI-readability status current for the draft guard.
 * There is no panel to show - what the AI cannot read is already reported in the
 * amber drafting banner, with "Draft anyway" next to it.
 */
export function DraftReadinessWatch({ scope, visible, onContextChange }: {
  scope: DraftScope; visible: boolean; onContextChange: (value: DraftContextStatus | null) => void
}) {
  const client = useRef<ReturnType<typeof createDraftReadinessClient> | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  useEffect(() => {
    const current = createDraftReadinessClient({ phoneNumberId: scope.phoneNumberId, waId: scope.waId })
    client.current = current
    const update = () => onContextChange(draftContextStatus(current.getSnapshot()))
    const unsubscribe = current.subscribe(update)
    update()
    if (visibleRef.current && validDraftScope(scope)) void current.refresh()
    const timer = setInterval(() => {
      if (visibleRef.current && document.visibilityState === 'visible' && !current.getSnapshot().loading) void current.refresh()
    }, 30000)
    return () => { clearInterval(timer); unsubscribe(); current.dispose(); if (client.current === current) client.current = null; onContextChange(null) }
  }, [scope.phoneNumberId, scope.waId, onContextChange])
  useEffect(() => {
    if (!visible) client.current?.cancel()
    else if (client.current?.getSnapshot().cancelled) void client.current.refresh()
  }, [visible])
  return null
}
