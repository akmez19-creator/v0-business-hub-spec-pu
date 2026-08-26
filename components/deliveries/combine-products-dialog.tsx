'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, AlertTriangle, Check, ChevronsUpDown, MapPin, Link2, Merge } from 'lucide-react'

/**
 * Combine two products the reviewer picks by hand.
 *
 * The duplicate scanner only surfaces pairs its NAME comparison happens to
 * catch, so two rows for the same thing under genuinely different wording
 * ("Dumpling Artifact" / "Steam basket set") were unreachable. This is the way
 * in for those.
 *
 * It offers the same two outcomes as the scanner, and deliberately keeps the
 * three decisions separate, because they have different right answers:
 *   1. WHICH ROW SURVIVES  - the shelved one, since only the shelf is truth.
 *   2. WHICH NAME it carries - often the OTHER one, because the hand-typed
 *      shelved row is usually the one with the typo.
 *   3. Link (reversible, both rows kept) or Merge (deletes a row).
 */

type Picked = {
  id: string
  name: string
  quantity: number | null
  zone: string | null
  shelf_code: string | null
  last_counted_at: string | null
  sold_out: boolean | null
  is_active: boolean | null
  category: string | null
  po_count: number
  image_count: number
  variant_count: number
}

type Option = { id: string; name: string; zone?: string | null; is_active?: boolean }

function ProductPicker({
  label,
  options,
  value,
  onChange,
  excludeId,
}: {
  label: string
  options: Option[]
  value: Option | null
  onChange: (o: Option) => void
  excludeId?: string | null
}) {
  const [open, setOpen] = useState(false)
  // The same row on both sides is the one combination that can never mean
  // anything, so it is removed rather than validated after the fact.
  const list = useMemo(() => options.filter(o => o.id !== excludeId), [options, excludeId])

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="justify-between h-auto min-h-10 py-2 text-left font-normal"
          >
            <span className="truncate">
              {value ? value.name : <span className="text-muted-foreground">Search a product…</span>}
            </span>
            <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[420px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Type a product name…" className="h-9" />
            <CommandList>
              <CommandEmpty>No product matches.</CommandEmpty>
              <CommandGroup>
                {list.map(o => (
                  <CommandItem
                    key={o.id}
                    value={o.name}
                    onSelect={() => {
                      onChange(o)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{o.name}</span>
                    <span className="ml-auto flex items-center gap-2 pl-2">
                      {o.is_active === false && (
                        <Badge variant="outline" className="text-[10px]">
                          retired
                        </Badge>
                      )}
                      {o.zone?.trim() && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          Zone {o.zone}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function Facts({ p, isSurvivor }: { p: Picked; isSurvivor: boolean }) {
  const rows: [string, React.ReactNode][] = [
    [
      'Shelf',
      p.shelf_code?.trim() ? (
        <span className="inline-flex items-center gap-1">
          <MapPin className="w-3 h-3" /> {p.shelf_code}
        </span>
      ) : (
        <span className="text-muted-foreground">not shelved</span>
      ),
    ],
    [
      'On hand',
      p.sold_out ? (
        <span>0 · sold out</span>
      ) : p.last_counted_at ? (
        <span>{p.quantity ?? 0}</span>
      ) : (
        // A bare 0 means "never counted" everywhere in this codebase, so it is
        // never shown as a confirmed zero.
        <span className="text-muted-foreground">{p.quantity ?? 0} · never counted</span>
      ),
    ],
    ['Purchase orders', p.po_count],
    ['Photos', p.image_count],
    ['Variants', p.variant_count],
  ]
  return (
    <div
      className={`rounded-lg border p-4 flex flex-col gap-3 ${
        isSurvivor ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium leading-snug text-pretty">{p.name}</span>
        {isSurvivor && (
          <Badge className="shrink-0">
            <Check className="w-3 h-3 mr-1" /> keeps
          </Badge>
        )}
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {p.is_active === false && (
        <p className="text-xs text-muted-foreground">
          Already retired — it is hidden from the order pickers.
        </p>
      )}
    </div>
  )
}

export function CombineProductsDialog({
  open,
  onOpenChange,
  products,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  products: Option[]
  onDone: () => void
}) {
  const [a, setA] = useState<Option | null>(null)
  const [b, setB] = useState<Option | null>(null)
  const [facts, setFacts] = useState<{ a: Picked; b: Picked } | null>(null)
  const [loading, setLoading] = useState(false)
  const [survivorId, setSurvivorId] = useState<string | null>(null)
  const [nameId, setNameId] = useState<string | null>(null)
  const [moveStock, setMoveStock] = useState<boolean | null>(null)
  const [confirmMerge, setConfirmMerge] = useState(false)
  const [busy, setBusy] = useState<'link' | 'merge' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // Both sides chosen: fetch the evidence. PO and photo counts are not
  // readable from the browser, so they come from a route.
  useEffect(() => {
    if (!a || !b) {
      setFacts(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setFacts(null)
    fetch(`/api/products/pair?a=${encodeURIComponent(a.id)}&b=${encodeURIComponent(b.id)}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        if (!j.success) {
          setError(j.error || 'Could not load those products.')
          return
        }
        setFacts({ a: j.a, b: j.b })

        // Defaults follow the conventions the merge screens already use, and
        // the two are deliberately NOT the same choice.
        const zonedA = !!j.a.shelf_code?.trim()
        const zonedB = !!j.b.shelf_code?.trim()
        // Only the shelf is real evidence of which row the warehouse uses.
        // When both or neither are shelved there is no honest default, so the
        // reviewer is left to choose - same rule the scanner calls "undecided".
        setSurvivorId(zonedA !== zonedB ? (zonedA ? j.a.id : j.b.id) : null)
        // The name follows history instead, because the shelved row is usually
        // the hand-typed one carrying the typo.
        const weight = (p: Picked) => p.po_count + p.image_count
        setNameId(weight(j.a) === weight(j.b) ? null : weight(j.a) > weight(j.b) ? j.a.id : j.b.id)
        setMoveStock(null)
        setConfirmMerge(false)
      })
      .catch(e => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [a, b])

  function reset() {
    setA(null)
    setB(null)
    setFacts(null)
    setSurvivorId(null)
    setNameId(null)
    setMoveStock(null)
    setConfirmMerge(false)
    setError(null)
  }

  const survivor = facts && survivorId ? (facts.a.id === survivorId ? facts.a : facts.b) : null
  const other = facts && survivorId ? (facts.a.id === survivorId ? facts.b : facts.a) : null
  const finalName = facts && nameId ? (facts.a.id === nameId ? facts.a.name : facts.b.name) : null
  const strandedQty = other && !other.sold_out ? Number(other.quantity ?? 0) : 0
  const needsStockAnswer = strandedQty > 0
  const ready = !!survivor && !!other && !!finalName && (!needsStockAnswer || moveStock !== null)

  // products.name is UNIQUE and linking keeps BOTH rows, so the survivor
  // cannot take the other row's spelling while that row still holds it.
  // Merge can, because it deletes the row first. Surfaced before the click
  // rather than as a rejected request.
  const nameBlocksLink = !!other && !!finalName && finalName === other.name

  async function run(mode: 'link' | 'merge') {
    if (!survivor || !other || !finalName) return
    setBusy(mode)
    setError(null)
    try {
      const body =
        mode === 'link'
          ? {
              survivorId: survivor.id,
              retiredId: other.id,
              moveStock: moveStock === true,
              finalName: finalName !== survivor.name ? finalName : undefined,
            }
          : {
              winnerId: survivor.id,
              loserId: other.id,
              finalName: finalName !== survivor.name ? finalName : undefined,
            }
      const res = await fetch(`/api/products/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        setError('Your session has expired. Sign in again.')
        return
      }
      const json = await res.json()
      if (!json.success) {
        setError(json.error || 'That did not run.')
        return
      }
      if (mode === 'link') {
        const stock = json.stockMoved
          ? ` ${json.stockMoved} unit${json.stockMoved === 1 ? '' : 's'} moved across.`
          : json.stockStranded
            ? ` ${json.stockStranded} unit${json.stockStranded === 1 ? '' : 's'} left on the retired row.`
            : ''
        const renamed = json.renamedFrom
          ? ` "${json.renamedFrom}" was kept as an alias too.`
          : ''
        setDone(
          `Linked. Both rows kept — "${json.retiredName}" is retired and now resolves to "${json.survivorName}".${stock}${renamed} Reversible.`,
        )
      } else {
        const moved = Object.values((json.moved || {}) as Record<string, number>).reduce(
          (x, y) => x + y,
          0,
        )
        setDone(
          `Merged. "${json.loserName}" was deleted and ${moved} record${
            moved === 1 ? '' : 's'
          } moved onto "${json.finalName || json.winnerName}".`,
        )
      }
      reset()
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        if (!v) {
          reset()
          setDone(null)
        }
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Combine two products</DialogTitle>
          <DialogDescription>
            Pick any two rows that are really the same thing. Use this when the duplicate scanner
            does not find them — it only compares names.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          {done && (
            <p className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">{done}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ProductPicker label="Product A" options={products} value={a} onChange={setA} excludeId={b?.id} />
            <ProductPicker label="Product B" options={products} value={b} onChange={setB} excludeId={a?.id} />
          </div>

          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading both products…
            </p>
          )}

          {error && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          {facts && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Facts p={facts.a} isSurvivor={survivorId === facts.a.id} />
                <Facts p={facts.b} isSurvivor={survivorId === facts.b.id} />
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium mb-2">Which row survives?</legend>
                <p className="text-xs text-muted-foreground mb-1">
                  Keep the shelved row — the shelf is the only record of where the stock physically
                  is.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[facts.a, facts.b].map(p => (
                    <Button
                      key={p.id}
                      type="button"
                      size="sm"
                      variant={survivorId === p.id ? 'default' : 'outline'}
                      onClick={() => setSurvivorId(p.id)}
                    >
                      {p.name}
                      {p.shelf_code?.trim() ? ` · ${p.shelf_code}` : ''}
                    </Button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium mb-2">Which name should it carry?</legend>
                <p className="text-xs text-muted-foreground mb-1">
                  A separate choice on purpose: the shelved row is often the hand-typed one with the
                  typo.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[facts.a, facts.b].map(p => (
                    <Button
                      key={p.id}
                      type="button"
                      size="sm"
                      variant={nameId === p.id ? 'default' : 'outline'}
                      onClick={() => setNameId(p.id)}
                    >
                      {p.name}
                    </Button>
                  ))}
                </div>
              </fieldset>

              {survivor && other && needsStockAnswer && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium mb-2">
                    {`"${other.name}" holds ${strandedQty} on hand`}
                  </legend>
                  <p className="text-xs text-muted-foreground mb-1">
                    Both answers are wrong in some cases, so there is no default. Leave them if that
                    shelf was counted once and written under both names — moving would double the
                    figure.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={moveStock === true ? 'default' : 'outline'}
                      onClick={() => setMoveStock(true)}
                    >
                      {`Move ${strandedQty} onto "${survivor.name}"`}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={moveStock === false ? 'default' : 'outline'}
                      onClick={() => setMoveStock(false)}
                    >
                      Leave them where they are
                    </Button>
                  </div>
                  {moveStock === false && (
                    <p className="text-xs text-muted-foreground">
                      Linking hides that row, so those {strandedQty} units will not be sellable
                      until someone recounts.
                    </p>
                  )}
                </fieldset>
              )}

              {survivor && other && (
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  {nameBlocksLink && (
                    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                      <span className="text-pretty">
                        Linking keeps both rows, and two products cannot share the name
                        {` "${other.name}"`}. Either keep the name {`"${survivor.name}"`}, or use
                        Merge — it deletes the other row, which frees the name.
                      </span>
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={!ready || nameBlocksLink || busy !== null}
                      onClick={() => run('link')}
                    >
                      {busy === 'link' ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Link2 className="w-4 h-4 mr-2" />
                      )}
                      {`Link & retire "${other.name}"`}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!ready || busy !== null}
                      onClick={() => (confirmMerge ? run('merge') : setConfirmMerge(true))}
                    >
                      {busy === 'merge' ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Merge className="w-4 h-4 mr-2" />
                      )}
                      {confirmMerge ? 'Confirm — delete it permanently' : 'Merge instead (deletes a row)'}
                    </Button>
                    {confirmMerge && (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmMerge(false)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground text-pretty">
                    <strong className="font-medium text-foreground">Link</strong> keeps both rows:
                    {` "${other.name}"`} is hidden from the pickers and that spelling resolves to
                    {` "${finalName ?? survivor.name}"`}. It can be undone.{' '}
                    <strong className="font-medium text-foreground">Merge</strong> moves every order,
                    photo and purchase order across and then deletes the row for good — the old
                    spelling stops resolving.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
