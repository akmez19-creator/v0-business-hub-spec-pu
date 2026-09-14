/**
 * Page-usage values shared by the server ranker and the client pickers.
 *
 * Separate from `./page-usage` on purpose: that module imports
 * `createAdminClient`, which reaches `next/headers` and cannot be pulled into a
 * client component. Keeping the constant here lets the Reels Studio dropdown
 * and the publish panel group their lists on the same number the API ranks by.
 */

/**
 * Posts on record before a Page counts as one we genuinely use.
 *
 * The split in the real data is stark - 1132 and 703 posts for the two working
 * Pages, then 102 and below for everything else - so this sits well clear of
 * both sides. Deliberately a threshold rather than a list of Page names, which
 * would go stale the moment a new Page starts getting used.
 */
export const REGULAR_PAGE_POSTS = 250
