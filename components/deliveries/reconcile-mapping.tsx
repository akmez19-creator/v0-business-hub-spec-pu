'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertTriangle, Check, ChevronsUpDown, Loader2, Save } from 'lucide-react'

/**
 * Maps the spreadsheet's own vocabulary onto system records.
 *
 * The reconcile preview reports three kinds of value it could not resolve -
 * statuses, rider names and product names. Every one of them was previously a
 * dead end: the summary said "map these in the importer" but there was nowhere
 * to do it without re-running the whole legacy import. This panel closes that
 * loop in place.
 *
 * Saved decisions go to `import_mappings`, so they apply to next month's file
 * too and are shared with the older importer.
 */

type MappingType = 'status' | 'rider' | 'product'

interface Vocab {
  statuses: string[]
  riders: { id: string; name: string | null; contractor_id: string | null }[]
  contractors: { id: string; name: string | null }[]
  products: { id: string; name: string }[]
  existing: { type: MappingType; source: string; target: string }[]
}

interface Props {
  /** File status values no mapping could resolve. */
  statusValues: string[]
  /** Rider-column values that matched no rider (so became zones). */
  riderValues: string[]
  /** Product names absent from the catalogue, with their row counts. */
  productValues: { name: string; rows: number }[]
  /** Re-run the comparison once mappings have been saved. */
  onSaved: () => void
  disabled?: boolean
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  nwd: 'NWD (not working / no delivery)',
  cms: 'CMS (cancelled)',
}

/** A searchable picker - a 488-item catalogue is unusable in a plain dropdown. */
function SearchPicker({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.id === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-8 w-full justify-between text-xs font-normal"
        >
          <span className={selected ? 'truncate' : 'truncate text-muted-foreground'}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command
          filter={(v, search) => {
            const opt = options.find((o) => o.id === v)
            return opt && opt.label.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }}
        >
          <CommandInput placeholder="Search…" className="h-9" />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  onSelect={() => {
                    onChange(o.id === value ? '' : o.id)
                    setOpen(false)
                  }}
                  className="text-xs"
                >
                  <Check className={`mr-2 h-3 w-3 ${o.id === value ? 'opacity-100' : 'opacity-0'}`} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function ReconcileMapping({ statusValues, riderValues, productValues, onSaved, disabled }: Props) {
  const [vocab, setVocab] = useState<Vocab | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  /** Draft choices, keyed `type|source`. Empty string means "not decided". */
  const [draft, setDraft] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/deliveries/reconcile/mappings')
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Could not load mappings')
        return (await res.json()) as Vocab
      })
      .then((v) => {
        if (cancelled) return
        setVocab(v)
        // Pre-fill from what is already saved so an existing decision is visible
        // rather than looking unmapped.
        const pre: Record<string, string> = {}
        for (const e of v.existing) pre[`${e.type}|${e.source.toLowerCase()}`] = e.target
        setDraft(pre)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load mappings'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const key = (type: MappingType, source: string) => `${type}|${source.toLowerCase()}`
  const get = (type: MappingType, source: string) => draft[key(type, source)] ?? ''
  const set = (type: MappingType, source: string, target: string) =>
    setDraft((d) => ({ ...d, [key(type, source)]: target }))

  const riderOptions = useMemo(
    () =>
      (vocab?.riders ?? [])
        .filter((r) => r.name)
        .map((r) => ({
          id: r.id,
          label: r.contractor_id
            ? `${r.name}`
            : `${r.name} (no contractor — only the rider will link)`,
        })),
    [vocab],
  )
  const productOptions = useMemo(
    () => (vocab?.products ?? []).map((p) => ({ id: p.id, label: p.name })),
    [vocab],
  )

  /** Only decided values are sent; everything else stays unmapped and reported. */
  const pending = useMemo(() => {
    const out: { type: MappingType; source: string; target: string }[] = []
    const seed: { type: MappingType; sources: string[] }[] = [
      { type: 'status', sources: statusValues },
      { type: 'rider', sources: riderValues },
      { type: 'product', sources: productValues.map((p) => p.name) },
    ]
    for (const { type, sources } of seed) {
      for (const source of sources) {
        const target = get(type, source)
        if (target) out.push({ type, source, target })
      }
    }
    return out
  }, [draft, statusValues, riderValues, productValues])

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/deliveries/reconcile/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings: pending }),
      })
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Could not save')
      const json = (await res.json()) as { saved: number }
      setSavedCount(json.saved)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save mappings')
    } finally {
      setSaving(false)
    }
  }, [pending, onSaved])

  const nothingToMap = statusValues.length === 0 && riderValues.length === 0 && productValues.length === 0

  if (nothingToMap) {
    return (
      <div className="flex h-[38vh] flex-col items-center justify-center gap-2 rounded-md border text-center">
        <Check className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Every status, rider and product in this file already resolves to a system record.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground text-pretty">
        Tell the importer what these spreadsheet values mean. Saved mappings are remembered for future files, so each
        name only needs deciding once. Anything left blank stays unmapped and is simply reported &mdash; never guessed.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {savedCount > 0 && !error && (
        <Alert>
          <Check className="h-4 w-4" />
          <AlertDescription>
            Saved {savedCount} mapping{savedCount === 1 ? '' : 's'} and re-compared the file.
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex h-[30vh] items-center justify-center gap-2 rounded-md border text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading riders and products…
        </div>
      ) : (
        <ScrollArea className="h-[34vh] rounded-md border p-3">
          <div className="flex flex-col gap-5">
            {statusValues.length > 0 && (
              <section>
                <h4 className="pb-1 text-sm font-semibold">
                  Status <Badge variant="secondary">{statusValues.length}</Badge>
                </h4>
                <p className="pb-2 text-xs text-muted-foreground text-pretty">
                  These read as outcomes in the sheet but match none of the six system statuses. Unmapped values leave
                  the row&apos;s status untouched.
                </p>
                <div className="flex flex-col gap-2">
                  {statusValues.map((s) => (
                    <div key={s} className="flex items-center gap-2">
                      <span className="w-[45%] shrink-0 truncate font-mono text-xs" title={s}>
                        {s}
                      </span>
                      <Select value={get('status', s)} onValueChange={(v) => set('status', s, v)} disabled={disabled}>
                        <SelectTrigger className="h-8 flex-1 text-xs">
                          <SelectValue placeholder="Leave unmapped" />
                        </SelectTrigger>
                        <SelectContent>
                          {(vocab?.statuses ?? []).map((sys) => (
                            <SelectItem key={sys} value={sys} className="text-xs">
                              {STATUS_LABEL[sys] ?? sys}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {riderValues.length > 0 && (
              <section>
                <h4 className="pb-1 text-sm font-semibold">
                  Rider <Badge variant="secondary">{riderValues.length}</Badge>
                </h4>
                <p className="pb-2 text-xs text-muted-foreground text-pretty">
                  The Rider column mixes route labels with people. Anything matching no rider is treated as a delivery
                  zone &mdash; map only the entries that are really a person, and the contractor follows automatically.
                </p>
                <div className="flex flex-col gap-2">
                  {riderValues.map((r) => (
                    <div key={r} className="flex items-center gap-2">
                      <span className="w-[45%] shrink-0 truncate font-mono text-xs" title={r}>
                        {r}
                      </span>
                      <div className="flex-1">
                        <SearchPicker
                          options={riderOptions}
                          value={get('rider', r)}
                          onChange={(id) => set('rider', r, id)}
                          placeholder="Keep as a zone"
                          disabled={disabled}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {productValues.length > 0 && (
              <section>
                <h4 className="pb-1 text-sm font-semibold">
                  Products <Badge variant="secondary">{productValues.length}</Badge>
                </h4>
                <p className="pb-2 text-xs text-muted-foreground text-pretty">
                  These names are not in the catalogue, so those rows import without a stock link. Mapping one is an
                  explicit decision, so it is honoured even on the strict &ldquo;exact name only&rdquo; setting.
                </p>
                <div className="flex flex-col gap-2">
                  {productValues.map((p) => (
                    <div key={p.name} className="flex items-center gap-2">
                      <span className="w-[45%] shrink-0 truncate text-xs" title={p.name}>
                        {p.name}
                        <span className="pl-1 font-mono text-[10px] text-muted-foreground">×{p.rows}</span>
                      </span>
                      <div className="flex-1">
                        <SearchPicker
                          options={productOptions}
                          value={get('product', p.name)}
                          onChange={(id) => set('product', p.name, id)}
                          placeholder="Leave unlinked"
                          disabled={disabled}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </ScrollArea>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {pending.length} mapping{pending.length === 1 ? '' : 's'} ready to save.
        </p>
        <Button onClick={save} disabled={disabled || saving || loading || pending.length === 0} size="sm">
          {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Save mappings &amp; re-compare
        </Button>
      </div>
    </div>
  )
}
