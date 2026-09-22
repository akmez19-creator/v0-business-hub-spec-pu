import { filterThreads, type UnifiedThread } from '@/lib/inbox/unified'

// Pins: the search box matches names the way a person reads them.
// V GOWREESUNKER (20 Sep 2026) reached us from WhatsApp as "V  GOWREESUNKER"
// - two spaces - and the one-space search the owner typed found nothing.

function thread(over: Partial<UnifiedThread>): UnifiedThread {
  return {
    key: 'wa:23052501972',
    channel: 'whatsapp',
    nativeId: '23052501972',
    name: 'V  GOWREESUNKER',
    snippet: 'Hello! Can I get more info on this?',
    updatedAt: '2026-09-20T12:44:05Z',
    unreadCount: 0,
    outsideWindow: false,
    source: 'Made By Moris',
    pageId: null,
    recipientId: '23052501972',
    adId: '120249488877130621',
    adName: 'RELAX YOUR FEET WITH ACUPRESSURE REFLEXOLOGY SOCKS',
    product: 'Acupuncture Socks',
    productId: null,
    productCategory: null,
    productSource: 'ad',
    campaignId: null,
    campaignName: null,
    ...over,
  } as UnifiedThread
}

const messenger = { channel: 'messenger' as const, adId: null, adName: null, product: null, productSource: null }
const rows: UnifiedThread[] = [
  thread({}),
  thread({ ...messenger, key: 'm:1', nativeId: '1', recipientId: '1', name: 'Noor Rjn', snippet: '57612113' }),
  thread({ ...messenger, key: 'm:2', nativeId: '2', recipientId: '2', name: 'Éric Désiré', snippet: 'ok' }),
]

const base = { channel: 'all' as const, ad: 'all' as const, unreadOnly: false }
const found = (query: string) => filterThreads(rows, { ...base, query }).map((r) => r.key)

const cases: Array<[string, string[]]> = [
  ['V GOWREESUNKER', ['wa:23052501972']],
  ['v gowreesunker', ['wa:23052501972']],
  ['V  GOWREESUNKER', ['wa:23052501972']],
  ['gowreesunker v', ['wa:23052501972']],
  ['GOWREESUNKER', ['wa:23052501972']],
  ['5250 1972', ['wa:23052501972']],
  ['+230 5250 1972', ['wa:23052501972']],
  ['23052501972', ['wa:23052501972']],
  ['5250-1972', ['wa:23052501972']],
  // A Messenger PSID is not a phone: digits typed against a Messenger thread only match its text.
  ['1972', ['wa:23052501972']],
  ['acupressure socks', ['wa:23052501972']],
  ['eric desire', ['m:2']],
  ['Éric', ['m:2']],
  ['57612113', ['m:1']],
  ['noor 57612113', ['m:1']],
  ['   ', ['wa:23052501972', 'm:1', 'm:2']],
  ['nobody here', []],
]

let failed = 0
for (const [query, expected] of cases) {
  const got = found(query)
  const ok = got.length === expected.length && expected.every((k) => got.includes(k))
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} "${query}" -> ${JSON.stringify(got)}${ok ? '' : ` expected ${JSON.stringify(expected)}`}`)
}
console.log(`${cases.length - failed}/${cases.length} passed`)
if (failed) process.exit(1)
