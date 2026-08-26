'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * The extension's region box, reproduced (public/extension/content.js ~3767).
 *
 * Agents already type regions this way all day, so the ranking, the cap of 8,
 * the arrow-key wrap-around and the Enter/Tab accept are copied rather than
 * reinvented - a different feel here would be its own source of error.
 */

/** content.js rankRegions(): starts-with first, then contains, capped at 8. */
export function rankRegions(regions: string[], q: string): string[] {
  const query = q.toLowerCase().trim()
  if (!query) return regions.slice(0, 8)
  const starts: string[] = []
  const contains: string[] = []
  for (const r of regions) {
    const l = r.toLowerCase()
    if (l.startsWith(query)) starts.push(r)
    else if (l.includes(query)) contains.push(r)
  }
  return starts.concat(contains).slice(0, 8)
}

export function RegionTypeahead({
  id,
  value,
  regions,
  onChange,
  onReload,
}: {
  id: string
  value: string
  regions: string[]
  onChange: (v: string) => void
  /** Regions have not arrived yet; let the agent retry from inside the box. */
  onReload?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const matches = useMemo(() => rankRegions(regions, value), [regions, value])

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current)
    }
  }, [])

  function select(i: number) {
    if (i < 0 || i >= matches.length) return
    onChange(matches[i])
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter confirms an IME composition before it ever means "accept the
    // highlighted region", so never act on a composing keystroke.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return

    const isOpen = open && matches.length > 0
    if (e.key === 'ArrowDown') {
      if (!isOpen) {
        setOpen(true)
        return
      }
      e.preventDefault()
      setActive((a) => (a + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      if (!isOpen) return
      e.preventDefault()
      setActive((a) => (a - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // Enter stays in the form, Tab still moves on - as in the extension.
      if (isOpen && active >= 0) {
        if (e.key === 'Enter') e.preventDefault()
        select(active)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const listId = `${id}-list`

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Type region..."
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // The list must outlive the blur or a click on it never lands.
          blurTimer.current = setTimeout(() => setOpen(false), 150)
        }}
        onKeyDown={onKeyDown}
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {regions.length === 0 ? (
            <li>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onReload?.()
                }}
              >
                Loading regions... tap to reload
              </button>
            </li>
          ) : matches.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">No region matches that</li>
          ) : (
            matches.map((r, i) => (
              <li key={r}>
                <button
                  id={`${listId}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={cn(
                    'w-full rounded px-2 py-1.5 text-left text-sm',
                    i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
                  )}
                  // mousedown fires before blur, so the value is set before the
                  // list hides - a click handler here would never run.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    select(i)
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {r}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
