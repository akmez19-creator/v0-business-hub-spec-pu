import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PlacementContent } from "@/components/placement/placement-content"
import { getPlacementDays, getPastWorkingDays } from "@/lib/placement-actions"

export const dynamic = "force-dynamic"

function todayInMauritius(): string {
  // Mauritius is UTC+4 and never observes DST. Deriving "today" from the
  // server's UTC clock would flip the default day four hours early.
  const now = new Date()
  const mu = new Date(now.getTime() + 4 * 60 * 60 * 1000)
  return mu.toISOString().slice(0, 10)
}

export default async function PlacementPage({
  searchParams,
}: {
  // Next 16: searchParams is async and MUST be awaited.
  searchParams: Promise<{ date?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login?next=/dashboard/admin/placement")

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (!profile || !["admin", "manager"].includes(profile.role)) {
    redirect("/dashboard")
  }

  // Only accept a real ISO date from the URL; anything else falls back to today
  // rather than throwing on a hand-typed query string.
  const requested = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayInMauritius()

  // The strip spans a week either side of the chosen day, so a plan made
  // earlier in the week stays visible instead of disappearing off the edge.
  const from = new Date(requested)
  from.setDate(from.getDate() - 7)
  const to = new Date(requested)
  to.setDate(to.getDate() + 14)

  const [days, pastDays] = await Promise.all([
    getPlacementDays(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)),
    getPastWorkingDays(),
  ])

  return <PlacementContent initialDate={requested} initialDays={days} pastDays={pastDays} />
}
