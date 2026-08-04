// Single source of truth for the USD -> Rs conversion.
//
// Facebook reports every spend figure in USD, but the whole business thinks in
// rupees: the Rs 150 kill threshold, cost-per-client, the TV wall. This lived
// as a local const inside app/dashboard/ads/page.tsx, which meant the kill rule
// could silently disagree with the number displayed next to it. One export now.
export const USD_TO_RS = 57.5

/** Facebook USD spend -> Rs. Non-finite input is treated as zero spend. */
export function usdToRs(usd: number): number {
  return Number.isFinite(usd) ? usd * USD_TO_RS : 0
}
