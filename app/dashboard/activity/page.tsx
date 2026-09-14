import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEntryActivity } from '@/lib/entry-activity'
import { EntryActivityCalendar } from '@/components/dashboard/entry-activity-calendar'

export const metadata = {
  title: 'Entry Activity | Made By Moris',
  description: 'Month calendar of every order entered into the system, by agent and time of day.',
}

/**
 * Roles allowed on this screen. Riders, contractors and storekeepers never
 * enter orders, so the page would be empty for them and is not offered at all.
 */
const ALLOWED = ['admin', 'manager', 'marketing_agent']

export default async function EntryActivityPage({
  searchParams,
}: {
  // Next.js 16: searchParams is a promise and must be awaited.
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('id,role').eq('id', user.id).single()
  if (!profile) return null
  if (!ALLOWED.includes(profile.role)) redirect('/dashboard')

  /*
   * Scoping happens inside getEntryActivity from the profile role read here on
   * the server. A marketing agent gets a query restricted to their own
   * `created_by`, so another agent's numbers are never sent to the browser -
   * rather than being fetched in full and hidden in the client, where anyone
   * could read them out of the payload.
   */
  const data = await getEntryActivity(month, { id: profile.id, role: profile.role })

  return (
    /*
     * Width is CAPPED and centred. Uncapped, this page stretched to the full
     * width of the owner's 3120px monitor, where every shift bar became a
     * ~2400px hairline and the agent table's columns were flung so far apart a
     * row could not be read across. A measured reading width is the whole point
     * of a page about times.
     *
     * A plain div, NOT <main>: the dashboard layout already renders this page's
     * <main> (and owns the padding). Nesting a second one is invalid HTML and
     * gives screen readers two competing main landmarks.
     */
    <div className="mx-auto w-full max-w-[1680px]">
      <EntryActivityCalendar data={data} />
    </div>
  )
}
