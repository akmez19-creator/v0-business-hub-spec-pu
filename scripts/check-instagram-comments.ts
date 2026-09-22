/**
 * Instagram comments channel - regression checks.
 *
 * Run: pnpm exec tsx scripts/check-instagram-comments.ts
 *
 * Guards the two rules that were actually wrong when this channel was built:
 *   1. An ad post belongs to the Instagram account that PUBLISHED it. Every
 *      Page token can read every ad account, so without this each linked
 *      account scanned all of them and every comment arrived twice (measured:
 *      32 rows for 16 real comments).
 *   2. An ad whose publisher is unknown belongs to NOBODY. Attributing it to
 *      a page at random would send replies from a Page that does not own the
 *      account, which Meta rejects.
 */
import { ownedBy, type AdMedia } from '@/lib/facebook/instagram-attribution'

let failures = 0
let checks = 0

function check(name: string, cond: boolean) {
  checks += 1
  if (!cond) {
    failures += 1
    console.log(`  FAIL  ${name}`)
  } else {
    console.log(`  ok    ${name}`)
  }
}

const MBM = '17841477493135711'
const HOT = '17841474408697899'
const UNLINKED = '17841441803535831'

const ad = (igUserId: string | null, adName = 'ad'): AdMedia => ({ adId: 'a', adName, permalink: undefined, igUserId })

const media = new Map<string, AdMedia>([
  ['m1', ad(MBM, 'MBM - Whitening Toothpaste - 1')],
  ['m2', ad(MBM, 'MBM - Oil Glue - B1G1 - 2')],
  ['m3', ad(HOT, 'HOT - Something - 1')],
  ['m4', ad(UNLINKED, 'DBM - 3 Led Headlamp - 1')],
  ['m5', ad(null, 'Creative with no Instagram publisher')],
])

console.log('Instagram comment attribution')

const mbm = ownedBy(media, MBM)
check('each account gets only its own posts', mbm.length === 2)
check('  and they are the right ones', mbm.map(([id]) => id).sort().join(',') === 'm1,m2')

const hot = ownedBy(media, HOT)
check('a second account gets a disjoint set', hot.length === 1 && hot[0][0] === 'm3')

// The duplication bug: the same media must never be handed to two accounts.
const all = [...mbm, ...hot].map(([id]) => id)
check('no post is claimed by two accounts', new Set(all).size === all.length)

check('an unlinked publisher is nobody\'s post', !ownedBy(media, MBM).some(([id]) => id === 'm4'))
check('  and is not silently given to the other account', !ownedBy(media, HOT).some(([id]) => id === 'm4'))

// A creative with no instagram_user_id must not match an account, and must
// especially not match when the account id is itself empty/undefined.
check('a creative with no publisher matches no account', !ownedBy(media, MBM).some(([id]) => id === 'm5'))
check('an empty account id matches nothing', ownedBy(media, '').length === 0)

// Only the unlinked account remains unclaimed by any linked account.
const claimed = new Set([...ownedBy(media, MBM), ...ownedBy(media, HOT)].map(([id]) => id))
const unclaimed = [...media.keys()].filter((id) => !claimed.has(id))
check('exactly the unattributable posts are left out', unclaimed.sort().join(',') === 'm4,m5')

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
