/**
 * Pull EVERY row of a query, not just the first page.
 *
 * Supabase (PostgREST) caps a single select at 1000 rows and returns the first
 * 1000 without any error or flag - a table with 1,200 orders looks exactly
 * like a table with 1,000. An explicit `.limit()` does the same thing sooner.
 *
 * MEASURED consequence on the purchase orders dashboard: `.limit(500)` on a
 * newest-first list with 690 orders silently dropped the 190 oldest. The
 * first-ever Pest Repellent PO (3,000 units, entered 14 Aug, Received) sat at
 * position 656 and was never sent to the page, while the stats card beside
 * the list said "690 orders". 104 products had at least one order only in
 * the cut. The owner's "my agent did enter it" was right; the screen was
 * wrong.
 *
 * Use this for any read whose result feeds a number or a list a person
 * relies on being complete. Per-product reads (`.eq('product_id', x)`) do not
 * need it.
 *
 * The builder MUST apply a total order that includes a unique tiebreaker
 * (e.g. `.order('created_at', ...).order('id')`). Rows inserted in one batch
 * share the same `created_at` to the microsecond, so paging on that column
 * alone can repeat or skip rows across the page boundary.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 100_000; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    out.push(...data)
    if (data.length < pageSize) break
  }
  return out
}
