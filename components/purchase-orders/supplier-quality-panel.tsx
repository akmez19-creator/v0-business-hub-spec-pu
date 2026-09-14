'use client'

import { useRef, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import type { QualityImportOption, QualityNoteInput, QualityPage, SupplierQualitySummary } from '@/lib/purchase-orders/1688-types'

export function QualityRating({ quality, platform = false }: { quality: SupplierQualitySummary | null | undefined; platform?: boolean }) {
  const rating = platform ? quality?.platformRating : quality?.internalRating
  const stamp = platform ? quality?.platformObservedAt : null
  return <div className="flex flex-col gap-1 text-sm leading-relaxed">
    {rating == null ? <span className="text-muted-foreground">{platform ? quality?.platformStatus === 'unavailable' ? 'Unavailable' : 'Not checked' : 'Not rated'}</span>
      : <span className="inline-flex items-center gap-1.5 tabular-nums"><Star className="size-4" aria-hidden="true" />{rating.toFixed(1)} / 5</span>}
    {stamp && <span className="text-muted-foreground">{quality?.platformStatus === 'unavailable' ? 'Previous · ' : ''}{new Date(stamp).toLocaleDateString('en-GB')}</span>}
  </div>
}

export function SupplierQualityPanel({ name, initialQuality, products, imports, loadPage, saveNote }: {
  name: string
  initialQuality: SupplierQualitySummary | null
  products: { id: string; name: string }[]
  imports: QualityImportOption[]
  loadPage: (name: string, cursor: string | null) => Promise<QualityPage>
  saveNote: (input: QualityNoteInput) => Promise<SupplierQualitySummary>
}) {
  const router = useRouter()
  const [cursor, setCursor] = useState<string | null>(null)
  const [older, setOlder] = useState<QualityPage['notes']>([])
  const { data, error: loadError, isLoading, mutate } = useSWR(['supplier-quality', name, cursor], () => loadPage(name, cursor), { revalidateOnFocus: true, shouldRetryOnError: false })
  const summary = data?.summary ?? initialQuality
  const [rating, setRating] = useState(initialQuality?.internalRating == null ? 'none' : String(initialQuality.internalRating))
  const [revision, setRevision] = useState(initialQuality?.revision ?? 0)
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<'general' | 'defect'>('general')
  const [productId, setProductId] = useState('none')
  const [importId, setImportId] = useState('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<{ fingerprint: string; key: string } | null>(null)
  const saving = useRef(false)
  const notes = [...new Map([...older, ...(data?.notes ?? [])].map(note => [note.id, note])).values()]
  const changedElsewhere = (summary?.revision ?? 0) !== revision

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving.current || !body.trim() || changedElsewhere) return
    saving.current = true
    setBusy(true)
    setError(null)
    const payload = { name, revision, rating: rating === 'none' ? null : Number(rating), body: body.trim(), kind, productId: productId === 'none' ? null : productId, importId: importId === 'none' ? null : importId }
    const fingerprint = JSON.stringify(payload)
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() }
    try {
      const saved = await saveNote({ ...payload, requestKey: request.current.key })
      setRevision(saved.revision)
      setRating(saved.internalRating == null ? 'none' : String(saved.internalRating))
      setBody('')
      setOlder([])
      setCursor(null)
      request.current = null
      await mutate()
      router.refresh()
      toast.success('Quality note saved. Earlier notes are unchanged.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the note. Your text is still here.')
      await mutate()
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <section aria-label={`Quality history for ${name}`} className="flex min-w-0 flex-col gap-6 text-sm leading-relaxed">
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold">1688 platform rating</h3>
      <QualityRating quality={summary} platform />
      {summary?.memberId ? <p className="break-all text-muted-foreground">Verified shop · {summary.memberId}</p> : <p className="text-muted-foreground">No verified 1688 shop identity yet. Similar names are never merged automatically.</p>}
      {summary?.platformError && <p className="text-muted-foreground">Last attempt: {summary.platformError}. Any previous rating above retains its original date.</p>}
      {!!summary?.platformRatings.length && <dl className="flex flex-col gap-1.5">{summary.platformRatings.map(value => <div key={value.type} className="flex justify-between gap-3"><dt className="text-muted-foreground">{value.title || value.type}</dt><dd className="tabular-nums">{value.score.toFixed(1)} / 5</dd></div>)}</dl>}
      <p className="text-muted-foreground">Opening this sheet and saving a note do not run paid lookups.</p>
    </div>
    <Separator />
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Your quality record</h3>{!!summary?.defectCount && <Badge variant="destructive">{summary.defectCount} defect report{summary.defectCount === 1 ? '' : 's'}</Badge>}</div>
      <p className="text-muted-foreground">Internal ratings are your assessment, separate from 1688. Changing a rating requires a note; corrections are added to the history, never erased.</p>
    </div>
    {changedElsewhere && <Alert><AlertTriangle /><AlertTitle>Another buyer updated this supplier</AlertTitle><AlertDescription><p>Review the new rating and notes before saving. Your note text has been kept.</p><Button type="button" variant="outline" size="sm" onClick={() => { setRevision(summary?.revision ?? 0); setRating(summary?.internalRating == null ? 'none' : String(summary.internalRating)); setError(null) }}>Use latest rating and revision</Button></AlertDescription></Alert>}
    <form onSubmit={submit}>
      <FieldGroup>
        <Field data-disabled={busy}><FieldLabel htmlFor="internal-quality-rating">Internal rating</FieldLabel><Select value={rating} onValueChange={setRating} disabled={busy}><SelectTrigger id="internal-quality-rating"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">Not rated</SelectItem>{[1, 2, 3, 4, 5].map(value => <SelectItem key={value} value={String(value)}>{value} / 5</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field data-disabled={busy}><FieldLabel htmlFor="quality-note-kind">Note type</FieldLabel><Select value={kind} onValueChange={value => setKind(value as 'general' | 'defect')} disabled={busy}><SelectTrigger id="quality-note-kind"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="general">General note</SelectItem><SelectItem value="defect">Defect / quality issue</SelectItem></SelectGroup></SelectContent></Select></Field>
        <Field data-disabled={busy}><FieldLabel htmlFor="quality-product">Product (optional)</FieldLabel><Select value={productId} onValueChange={value => { setProductId(value); setImportId('none') }} disabled={busy}><SelectTrigger id="quality-product"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">Supplier-wide note</SelectItem>{products.map(product => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field data-disabled={busy}><FieldLabel htmlFor="quality-import">Import (optional)</FieldLabel><Select value={importId} onValueChange={value => { setImportId(value); const linked = imports.find(entry => entry.id === value); if (linked?.productId) setProductId(linked.productId) }} disabled={busy}><SelectTrigger id="quality-import"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">No specific import</SelectItem>{imports.filter(entry => productId === 'none' || entry.productId === productId).map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.caption}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field data-disabled={busy} data-invalid={!!error}><FieldLabel htmlFor="quality-note">Dated quality note</FieldLabel><Textarea id="quality-note" value={body} onChange={event => setBody(event.target.value)} required maxLength={4000} rows={4} disabled={busy} placeholder="Describe what happened, the affected batch, or why the rating changed." aria-describedby="quality-note-help" /><FieldDescription id="quality-note-help">Your name and the save date are recorded automatically.</FieldDescription></Field>
        {error && <Alert variant="destructive"><AlertTitle>Note not saved</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="submit" disabled={busy || changedElsewhere || !body.trim()}>{busy && <Loader2 data-icon="inline-start" className="animate-spin" />}Save quality note</Button>
      </FieldGroup>
    </form>
    <Separator />
    <div className="flex flex-col gap-4">
      <h3 className="font-semibold">Dated history · {summary?.noteCount ?? 0} notes</h3>
      {loadError && <Alert variant="destructive"><AlertTitle>History unavailable</AlertTitle><AlertDescription><p>{loadError.message}</p><Button variant="outline" size="sm" onClick={() => void mutate()}>Reload notes</Button></AlertDescription></Alert>}
      {isLoading && <p role="status" className="text-muted-foreground">Loading quality history…</p>}
      {!isLoading && !loadError && !notes.length && <p className="text-muted-foreground">No quality notes yet. An unrated supplier is not a zero-star supplier.</p>}
      <ol className="flex flex-col gap-5">{notes.map(note => <li key={note.id} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{note.authorName}</span><time className="text-muted-foreground" dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</time>{note.kind === 'defect' && <Badge variant="destructive">Defect report</Badge>}</div>
        {note.ratingChanged && <p className="text-muted-foreground">Rating: {note.ratingBefore == null ? 'Not rated' : `${note.ratingBefore}/5`} → {note.ratingAfter == null ? 'Not rated' : `${note.ratingAfter}/5`}</p>}
        <p className="whitespace-pre-wrap break-words">{note.body}</p>
        {(note.productCaption || note.importCaption) && <p className="text-muted-foreground">{[note.productCaption, note.importCaption].filter(Boolean).join(' · ')}</p>}
      </li>)}</ol>
      {data?.nextCursor && <Button variant="outline" disabled={isLoading} onClick={() => { setOlder(notes); setCursor(data.nextCursor) }}>Load older notes</Button>}
    </div>
  </section>
}
