'use client'

/**
 * Every past China import, searchable, for one reorder line.
 *
 * The old per-line dropdown only listed imports already linked to THIS exact
 * product record, so a product with no import of its own (e.g. a spinner whose
 * history sits under "fidget spinner" / "Magic Flying Ball") offered nothing at
 * all - no way to seed price, freight, weight or CBM from a comparable buy.
 *
 * This shows the product's own imports first, then every other import as an
 * estimate the buyer can adopt and adjust. Same Popover + Command shape as
 * `product-picker.tsx`. Filtering matches every typed word anywhere across the
 * product name, import number, supplier and date.
 */

import { useMemo, useState } from 'react'
import { ChevronsUpDown, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import type { ImportReference } from '@/lib/purchase-orders/workflow'

const CLEAR = '__clear__'

function referenceLabel(reference: ImportReference) {
  const parts = [reference.index_no || 'Import', reference.product_name || 'Unnamed product']
  if (reference.supplier_name) parts.push(reference.supplier_name)
  const when = reference.order_date || (reference.created_at ? `recorded ${reference.created_at.slice(0, 10)}` : null)
  if (when) parts.push(when)
  return parts.join(' · ')
}

export function ImportReferencePicker({
  references,
  productId,
  value,
  disabled,
  onSelect,
  id,
}: {
  references: ImportReference[]
  productId: string | null
  value: string | null
  disabled?: boolean
  onSelect: (reference: ImportReference | null) => void
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const own = useMemo(
    () => (productId ? references.filter((row) => row.product_id === productId) : []),
    [references, productId],
  )
  const others = useMemo(
    () => references.filter((row) => !productId || row.product_id !== productId),
    [references, productId],
  )
  // Lower-cased once so filtering does not rebuild the haystack on every keystroke.
  const searchable = useMemo(() => {
    const map = new Map<string, string>([[CLEAR, 'no reference enter manually clear none']])
    for (const row of references)
      map.set(
        row.id,
        `${row.product_name ?? ''} ${row.index_no ?? ''} ${row.supplier_name ?? ''} ${row.order_date ?? ''} ${row.created_at ?? ''}`.toLowerCase(),
      )
    return map
  }, [references])
  const selected = value ? references.find((row) => row.id === value) ?? null : null
  const selectedIsEstimate = Boolean(selected && productId && selected.product_id !== productId)

  const renderItem = (reference: ImportReference, estimate: boolean) => (
    <CommandItem
      key={reference.id}
      value={reference.id}
      onSelect={() => {
        onSelect(reference)
        setOpen(false)
      }}
      className="flex flex-col items-start gap-0.5 text-xs"
    >
      <span className="w-full truncate font-medium">{reference.index_no || 'Import'} · {reference.product_name || 'Unnamed product'}</span>
      <span className="flex w-full flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{reference.supplier_name || 'No supplier on file'}</span>
        {reference.qty != null && <span>· {reference.qty} units</span>}
        {reference.order_date && <span>· {reference.order_date}</span>}
        {estimate && <Badge variant="secondary" className="ml-auto shrink-0">Estimate</Badge>}
        {reference.referenceWarning && (
          <Badge variant="destructive" className="shrink-0">Check cost</Badge>
        )}
      </span>
    </CommandItem>
  )

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <History className="size-4 shrink-0 opacity-60" />
            <span className="truncate">{selected ? referenceLabel(selected) : 'No reference — enter manually'}</span>
            {selectedIsEstimate && (
              <Badge variant="secondary" className="shrink-0">Estimate</Badge>
            )}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[320px] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            const hay = searchable.get(itemValue)
            if (hay == null) return 0
            const words = search.toLowerCase().split(/\s+/).filter(Boolean)
            return words.every((word) => hay.includes(word)) ? 1 : 0
          }}
        >
          <CommandInput placeholder="Search by product, import number or supplier…" className="h-9" />
          <CommandList className="max-h-80">
            <CommandEmpty>No past import matches those words.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={CLEAR}
                onSelect={() => {
                  onSelect(null)
                  setOpen(false)
                }}
                className="text-xs"
              >
                No reference — enter manually
              </CommandItem>
            </CommandGroup>
            {own.length > 0 && (
              <CommandGroup heading="This product">{own.map((row) => renderItem(row, false))}</CommandGroup>
            )}
            {others.length > 0 && (
              <CommandGroup heading="Other imports · estimate">
                {others.map((row) => renderItem(row, true))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
