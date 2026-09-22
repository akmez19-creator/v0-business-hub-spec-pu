/**
 * Pinned values for the attendance arithmetic (lib/entry-attendance.ts).
 * Run: pnpm exec tsx scripts/check-entry-attendance.ts
 */
import { MARKETING_SHIFT, dayAttendance, footprintGaps, countActivity, type Footprint } from '@/lib/entry-attendance'

let failed = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

// Shift 08:00-16:30, 5 min grace.
eq('08:04 start is on time', dayAttendance(MARKETING_SHIFT, 1, 8 * 60 + 4, 16 * 60 + 40, false).lateMinutes, 0)
eq('08:05 start is on time (grace inclusive)', dayAttendance(MARKETING_SHIFT, 1, 8 * 60 + 5, 17 * 60, false).lateMinutes, 0)
eq('08:17 start is 12 late', dayAttendance(MARKETING_SHIFT, 1, 8 * 60 + 17, 17 * 60, false).lateMinutes, 12)
eq('07:30 start is not negative', dayAttendance(MARKETING_SHIFT, 1, 7 * 60 + 30, 17 * 60, false).lateMinutes, 0)
eq('15:45 finish is 45 early', dayAttendance(MARKETING_SHIFT, 2, 8 * 60, 15 * 60 + 45, false).earlyLeaveMinutes, 45)
eq('today has no early-leave figure', dayAttendance(MARKETING_SHIFT, 2, 8 * 60, 10 * 60, true).earlyLeaveMinutes, null)
eq('Sunday is not scheduled', dayAttendance(MARKETING_SHIFT, 0, 8 * 60, 16 * 60, false).scheduled, false)
eq('Saturday is scheduled', dayAttendance(MARKETING_SHIFT, 6, 8 * 60, 16 * 60, false).scheduled, true)

// Footprint gaps: visit interval + inbox points, overlapping visit never a gap.
const day = '2026-09-17T'
const pts: Footprint[] = [
  { at: `${day}04:02:00Z`, min: 8 * 60 + 2, kind: 'inbox_open' }, // 08:02 MU
  { at: `${day}05:40:00Z`, min: 9 * 60 + 40, kind: 'order', endAt: `${day}05:52:00Z`, endMin: 9 * 60 + 52 }, // 09:40-09:52
  { at: `${day}05:45:00Z`, min: 9 * 60 + 45, kind: 'inbox_reply' }, // inside the visit
  { at: `${day}06:30:00Z`, min: 10 * 60 + 30, kind: 'inbox_reply' }, // 38 min after the visit ended
]
eq(
  'gaps: 08:02->09:40 (98m) and 09:52->10:30 (38m); reply inside a visit adds nothing',
  footprintGaps(pts, 10),
  [{ startMin: 482, minutes: 98 }, { startMin: 592, minutes: 38 }],
)
eq('gaps below the tracked minimum are dropped', footprintGaps(pts, 60), [{ startMin: 482, minutes: 98 }])
eq('activity counts', countActivity(pts), { replies: 2, opens: 1, stars: 0, orderChanges: 0 })

if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('all attendance checks passed')
