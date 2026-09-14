'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { CENTRAL_BUSINESSES, centralBusinessViews, createCentralRecoveryClient } from './whatsapp-central-client'
import { WhatsAppCentralView } from './whatsapp-central-view'

export function WhatsAppCentral() {
  const [client] = useState(() => createCentralRecoveryClient())
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    client.activate()
    void client.refresh()
    const refreshWhenVisible = () => { if (!document.hidden) void client.refresh() }
    const refreshTimer = setInterval(refreshWhenVisible, 5_000)
    const clockTimer = setInterval(() => { if (!document.hidden) setNow(Date.now()) }, 1_000)
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); void client.refresh() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(refreshTimer)
      clearInterval(clockTimer)
      document.removeEventListener('visibilitychange', onVisible)
      client.dispose()
    }
  }, [client])

  const errors = CENTRAL_BUSINESSES.flatMap(item => state.errors[item.phoneNumberId] ? [`${item.name}: ${state.errors[item.phoneNumberId]}`] : [])
  return <WhatsAppCentralView
    businesses={centralBusinessViews(state, now)} selectedBusinessId={state.selectedBusinessId} now={now}
    loading={Object.values(state.loading).some(Boolean)} error={errors.length ? errors.join(' ') : null}
    notice={state.notice} checkedAt={state.checkedAt}
    onSelectBusiness={client.selectBusiness}
    onConnect={id => { void client.connect(id) }}
    onPause={id => { void client.pause(id) }}
    onFetch={id => { void client.fetchHistory(id) }}
    onRefresh={() => { void client.refresh(true) }}
    onCopyPairing={id => { void client.copyPairing(id) }}
    onDismissPairing={client.dismissPairing}
    onReadSetupCode={client.readSetupCode}
  />
}
