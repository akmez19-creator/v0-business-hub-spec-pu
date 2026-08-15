'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const ALL_PAGES = 'all'

export type ScopeStat = {
  id: string
  name: string
  /** Items needing attention, or null when the Page could not be read. */
  count: number | null
  error?: string
}

/**
 * Page selector shared by every channel.
 *
 * The per-Page counts come free from the merged fetch, so the dropdown shows
 * where work is piling up without having to switch Page to find out - the
 * reason a single-Page default hid ~129 unread messages before.
 */
export function PageScopeSelect({
  pages,
  stats,
  value,
  onChange,
  label = 'Facebook Page',
}: {
  pages: { id: string; name: string }[]
  stats: ScopeStat[]
  value: string
  onChange: (next: string) => void
  label?: string
}) {
  if (pages.length <= 1) return null

  const byId = new Map(stats.map((s) => [s.id, s]))
  const total = stats.reduce((n, s) => n + (s.count ?? 0), 0)

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder="Select a Page" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_PAGES}>All pages{total > 0 ? ` (${total})` : ''}</SelectItem>
        {pages.map((p) => {
          const stat = byId.get(p.id)
          const suffix = stat?.error != null ? ' (unavailable)' : stat?.count ? ` (${stat.count})` : ''
          return (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              {suffix}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
