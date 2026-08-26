import { muToday } from '@/lib/business-date'

/**
 * WHICH DAY THE CONTRACTOR STOCK SCREEN IS ABOUT, and which orders belong to it.
 *
 * This exists because the screen and the generator each had their OWN copy of
 * this logic and the copies disagreed, which is how a validated postponement
 * could show in "Stock by Rider" while the generated stock list came out empty:
 *
 *   - the page read `active_date` (correct - due-day basis)
 *   - `generateDailyStock()` read `delivery_date` (the day goods PHYSICALLY went
 *     out, which is immutable and never moves when an order is postponed)
 *
 * Live proof on MUNSAH for 26 Aug 2026: filtering `delivery_date` returned 0
 * orders, filtering `active_date` returned 2. Pinky's order went out on 24 Aug
 * and was validated onto 26 Aug, so `delivery_date` will never equal 26 Aug for
 * as long as that row exists.
 *
 * THE RULE: anything asking "what does the rider carry that day" is
 * forward-looking and must use `active_date`
 * (= `coalesce(rescheduled_to, delivery_date)`). Only things recording where
 * goods physically were - van stock, cash, the validation key - use
 * `delivery_date`.
 */

/** The column every due-day stock query must filter on. Named so a `.eq(...)` cannot quietly pick the wrong one. */
export const STOCK_DATE_COLUMN = 'active_date' as const

/**
 * The day the stock screen should show: the most recent day that actually has
 * assigned work, never later than today.
 *
 * Bounded at today ON PURPOSE. Reschedules run out to 12 Sep, so taking the
 * plain latest date would jump the screen to a future day that has no
 * `contractor_daily_stock` row and no validation record - it would look empty
 * while today's real load went unvalidated.
 *
 * `muToday()` rather than `new Date().toISOString()`: every date in the database
 * is a Mauritius business date, and this app is used at 4am. At 02:00 in
 * Mauritius, UTC is still the PREVIOUS day, so the UTC version silently bounded
 * the screen to yesterday and hid the whole round.
 */
export async function resolveStockDate(
  supabase: any,
  riderIds: string[],
  contractorId: string,
): Promise<string> {
  const today = muToday()
  if (riderIds.length === 0) return today

  const { data: latestMain } = await supabase
    .from('deliveries')
    .select(STOCK_DATE_COLUMN)
    .in('rider_id', riderIds)
    .not('products', 'is', null)
    .lte(STOCK_DATE_COLUMN, today)
    .order(STOCK_DATE_COLUMN, { ascending: false })
    .limit(1)

  // `partner_deliveries` has no reschedule column, so `order_date` IS its due
  // day. Bounded at today for the same reason as above.
  const { data: latestPartner } = await supabase
    .from('partner_deliveries')
    .select('order_date')
    .eq('contractor_id', contractorId)
    .in('rider_id', riderIds)
    .not('product', 'is', null)
    .lte('order_date', today)
    .order('order_date', { ascending: false })
    .limit(1)

  const mainDate: string | null = latestMain?.[0]?.[STOCK_DATE_COLUMN] || null
  const partnerDate: string | null = latestPartner?.[0]?.order_date || null

  if (mainDate && partnerDate) return mainDate >= partnerDate ? mainDate : partnerDate
  return mainDate || partnerDate || today
}
