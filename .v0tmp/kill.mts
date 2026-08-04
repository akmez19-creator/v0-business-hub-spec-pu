import { evaluateAd, findKillCandidates, KILL_SPEND_RS } from '../lib/ads/kill-rule.ts'
import { USD_TO_RS } from '../lib/ads/currency.ts'

const now = new Date('2026-08-04T12:00:00Z')
const old = '2026-08-01T12:00:00Z' // 72h before now
const fresh = '2026-08-04T02:00:00Z' // 10h before now

// Rs 150 exactly, in USD
const usdFor = (rs: number) => rs / USD_TO_RS

let pass = 0
let fail = 0
function check(label: string, got: boolean, want: boolean, extra = '') {
  if (got === want) {
    pass++
    console.log(`  ok   ${label}${extra ? ' -> ' + extra : ''}`)
  } else {
    fail++
    console.log(`  FAIL ${label}: got kill=${got}, want kill=${want} ${extra}`)
  }
}

const base = { adId: 'a', spendUsd: usdFor(300), clients: 0, createdAt: old, status: 'ACTIVE' }

console.log('core rule:')
check('Rs 300, 0 clients, 72h', evaluateAd(base, now).kill, true, evaluateAd(base, now).reason)
check('Rs 300, 1 client', evaluateAd({ ...base, clients: 1 }, now).kill, false, evaluateAd({ ...base, clients: 1 }, now).reason)
check('Rs 50, 0 clients', evaluateAd({ ...base, spendUsd: usdFor(50) }, now).kill, false)
check('fresh 10h old', evaluateAd({ ...base, createdAt: fresh }, now).kill, false, evaluateAd({ ...base, createdAt: fresh }, now).reason)

console.log('\nboundaries:')
// exactly Rs 150 -> spendRs < 150 is false, so it qualifies
check('exactly Rs 150', evaluateAd({ ...base, spendUsd: usdFor(KILL_SPEND_RS) }, now).kill, true)
check('Rs 149.99', evaluateAd({ ...base, spendUsd: usdFor(149.99) }, now).kill, false)
// exactly 24h -> ageHours <= 24 is true, so spared
check('exactly 24h old', evaluateAd({ ...base, createdAt: '2026-08-03T12:00:00Z' }, now).kill, false)
check('24h + 1min old', evaluateAd({ ...base, createdAt: '2026-08-03T11:59:00Z' }, now).kill, true)

console.log('\nsafety:')
check('already killed stays killed', evaluateAd({ ...base, killedAt: old }, now).kill, false, evaluateAd({ ...base, killedAt: old }, now).reason)
check('paused ad not flagged', evaluateAd({ ...base, status: 'PAUSED' }, now).kill, false)
check('null createdAt not flagged', evaluateAd({ ...base, createdAt: null }, now).kill, false, evaluateAd({ ...base, createdAt: null }, now).reason)
check('garbage date not flagged', evaluateAd({ ...base, createdAt: 'not-a-date' }, now).kill, false)
check('NaN spend not flagged', evaluateAd({ ...base, spendUsd: Number.NaN }, now).kill, false)
// reactivated ad gets a fresh window
check('reactivated 2h ago spared', evaluateAd({ ...base, killedAt: old, reactivatedAt: '2026-08-04T10:00:00Z' }, now).kill, false, evaluateAd({ ...base, killedAt: old, reactivatedAt: '2026-08-04T10:00:00Z' }, now).reason)

console.log('\nsorting:')
const cands = findKillCandidates([
  { adId: 'small', spendUsd: usdFor(200), clients: 0, createdAt: old, status: 'ACTIVE' },
  { adId: 'huge', spendUsd: usdFor(900), clients: 0, createdAt: old, status: 'ACTIVE' },
  { adId: 'safe', spendUsd: usdFor(900), clients: 5, createdAt: old, status: 'ACTIVE' },
], now)
check('worst first', cands[0]?.adId === 'huge', true, cands.map((c) => c.adId).join(','))
check('only 2 flagged', cands.length === 2, true)

console.log(`\n${pass} passed, ${fail} failed`)
console.log(`Rs ${KILL_SPEND_RS} threshold = $${usdFor(KILL_SPEND_RS).toFixed(2)} at ${USD_TO_RS}`)
