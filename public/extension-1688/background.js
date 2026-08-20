// Akmez 1688 Guide - service worker
// Only job: forward the Alt+Z keyboard command to the guide running in the tab.

chrome.commands.onCommand.addListener(command => {
  if (command !== 'toggle-guide') return
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs[0]
    if (!tab?.id) return
    // The content script only exists on 1688 tabs, so a failed send is expected
    // elsewhere and must not surface as an unchecked runtime error.
    chrome.tabs.sendMessage(tab.id, { action: 'toggle' }, () => void chrome.runtime.lastError)
  })
})
