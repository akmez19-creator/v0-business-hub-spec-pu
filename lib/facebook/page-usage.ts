import { createAdminClient } from '@/lib/supabase/server'
import type { FbPage } from './pages'

/**
 * Rank Facebook Pages by how much we ACTUALLY post to them.
 *
 * `getManageablePages` sorts alphabetically, and three separate callers then
 * took `pages[0]` as their default: the Reels Studio brand-page dropdown, the
 * publish panel's destination picker, and the publish route's own fallback.
 * Alphabetical order put "Alf Trading Ltd" first - a Page with 6 posts in its
 * whole history - ahead of "Made By Moris" (1132) and "Destockage By Moris"
 * (703), which are ~85% of everything we post. So the Studio opened on the
 * wrong Page, silently applied that Page's saved logo and banner layout, and
 * an unattended publish went to a Page we effectively never use.
 *
 * The inbox already learned this lesson - see the resolution order in
 * `getInboxPage` - but the Studio never got the same treatment.
 *
 * Ordering is derived from data, never hardcoded to two Page names, so it keeps
 * itself honest: start posting to a new Page and it climbs on its own.
 */

/** A Page plus how many posts we have on record for it. */
export type RankedPage = FbPage & { posts: number }

// The REGULAR_PAGE_POSTS grouping threshold lives in ./page-usage-shared
// because this module pulls in `createAdminClient` -> `next/headers`, which
// would break the build for any client component that imported it.

// `page_post_ads` is the synced history of real Page posts, so it is the
// truthful record of where we publish. Tallying is a single-column read
// (~2k short rows) cached for the same 10 minutes as the Page list itself,
// so ranking costs nothing on the hot path.
let cache: { counts: Map<string, number>; at: number } | null = null
const CACHE_TTL_MS = 10 * 60 * 1000

async function postCountsByPage(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.counts

  const counts = new Map<string, number>()
  try {
    const adminDb = createAdminClient()
    // PostgREST has no GROUP BY, so pull just the id column and tally here
    const { data, error } = await adminDb.from('page_post_ads').select('page_id')
    // A failed read must not silently read as "every Page has zero posts" -
    // that would look like a deliberate ranking and quietly restore the old
    // alphabetical default. Leave the cache unset and report nothing known.
    if (error) return counts
    for (const row of (data ?? []) as { page_id: string | null }[]) {
      const id = row.page_id
      if (!id) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    cache = { counts, at: Date.now() }
  } catch {
    // Same as above: unknown, not zero
  }
  return counts
}

/**
 * Most-posted-to Page first. Pages we have never posted to keep the
 * alphabetical order they arrived in, so the tail of the list stays scannable
 * rather than being shuffled by meaningless tie-breaks.
 *
 * Never throws and never drops a Page: on any database trouble every count is
 * 0, the sort is stable, and the caller gets the plain alphabetical list back.
 */
export async function rankPagesByUse(pages: FbPage[]): Promise<RankedPage[]> {
  const counts = await postCountsByPage()
  return pages
    .map((p) => ({ ...p, posts: counts.get(p.id) ?? 0 }))
    .sort((a, b) => b.posts - a.posts)
}
