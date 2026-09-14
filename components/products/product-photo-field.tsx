'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Upload, X, ClipboardPaste, Sparkles, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ProductThumb } from '@/components/ui/product-thumb'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { titleCase } from '@/lib/products/title-case'
import type { MatchCandidate } from '@/lib/types'

/**
 * What the identify pass says about a photo. `names` is what the thing is
 * called (label first); `matches` are catalogue rows that LOOK like the same
 * product, which is the only duplicate check a brand-new name can get - by
 * definition the name matcher has nothing to compare against yet.
 */
export type PhotoReading = {
  names: string[]
  matches: MatchCandidate[]
}

/**
 * The one product-photo input: upload / paste / drop, then read the picture.
 *
 * Exists because the same three capabilities lived in three places that did
 * not talk to each other: the inventory Add Product dialog could take a
 * picture but never named it, Stock Count could name a picture but only for a
 * count, and the purchasing page could create a product but took no picture
 * at all. The buyer's question "already have this in the system right?" was
 * fair - every part existed, none of it was joined up.
 *
 * Reading runs when a photo LANDS, not when the dialog opens. The photo is the
 * request: nobody uploads a picture of a product they do not want identified.
 * That is the line between this and the Studio search, which used to fire on
 * open and spent budget on accidental clicks. One reading per photo.
 */
export function ProductPhotoField({
  imageUrl,
  onImageChange,
  onReading,
  onUploadStateChange,
  disabled,
  label = 'Product photo',
  hint = 'Drop, paste or click to upload. The photo suggests a name and checks for an existing match.',
}: {
  imageUrl: string
  onImageChange: (url: string) => void
  /** Called once per photo with whatever the picture reader could tell. */
  onReading?: (reading: PhotoReading | null, error?: string) => void
  onUploadStateChange?: (uploading: boolean) => void
  disabled?: boolean
  label?: string
  hint?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [reading, setReading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const uploadInFlight = useRef(false)
  const activeRead = useRef<AbortController | null>(null)
  useEffect(() => () => { activeRead.current?.abort() }, [])

  async function upload(source: File | (() => Promise<File>)) {
    if (disabled || uploadInFlight.current) return
    uploadInFlight.current = true
    activeRead.current?.abort()
    setReading(false)
    setError(null)
    setUploading(true)
    onUploadStateChange?.(true)
    try {
      const file = typeof source === 'function' ? await source() : source
      if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.size > 10 * 1024 * 1024) {
        throw new Error('Choose a photo under 10 MB, not an SVG file.')
      }
      // Same bucket and naming as the inventory dialog, so a photo added here
      // is indistinguishable from one added there.
      const supabase = createClient()
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png'
      const ext = /^[a-z0-9]+$/.test(extension) ? extension : 'png'
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('product-images')
        .upload(fileName, file, { cacheControl: '3600', upsert: false })
      if (upErr) throw upErr
      const {
        data: { publicUrl },
      } = supabase.storage.from('product-images').getPublicUrl(fileName)
      onImageChange(publicUrl)
      void read(publicUrl)
    } catch (e) {
      setError('Upload failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      uploadInFlight.current = false
      setUploading(false)
      onUploadStateChange?.(false)
    }
  }

  async function read(url: string) {
    if (!onReading) return
    const controller = new AbortController()
    activeRead.current?.abort()
    activeRead.current = controller
    setReading(true)
    try {
      // The stock-count identifier already does both halves - names the object
      // and compares it against catalogue photos - and only asks for a signed-in
      // user. Reusing it means one vision pipeline to keep accurate, not two.
      const res = await fetch('/api/stock-count/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: url }),
        signal: controller.signal,
      })
      const data = (await res.json()) as { names?: string[]; candidates?: MatchCandidate[]; error?: string }
      if (!res.ok) throw new Error(data.error || `Identify failed (${res.status})`)
      // The model answers in lower case ("air fryer silicone pot"); the
      // catalogue is written in Title Case. Case them here so a name accepted
      // as-is is not a second spelling for the name matcher to trip over.
      const seen = new Set<string>()
      const names = (data.names ?? [])
        .map((n) => titleCase(n))
        .filter((n) => {
          const k = n.toLowerCase()
          if (!k || seen.has(k)) return false
          seen.add(k)
          return true
        })
      if (!controller.signal.aborted) onReading({ names, matches: data.candidates ?? [] })
    } catch (e) {
      // A failed reading must not block the create - the photo is still saved.
      if (!controller.signal.aborted) onReading(null, e instanceof Error ? e.message : 'Could not read the photo')
    } finally {
      if (activeRead.current === controller && !controller.signal.aborted) setReading(false)
    }
  }

  async function pasteFromClipboard() {
    await upload(async () => {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) {
          const blob = await item.getType(type)
          return new File([blob], `pasted.${type.split('/')[1] || 'png'}`, { type })
        }
      }
      throw new Error('No image in the clipboard - copy an image first.')
    })
  }

  const busy = uploading || reading || disabled

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex items-start gap-4">
        <div
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy}
          aria-label={imageUrl ? 'Replace product photo' : 'Upload product photo'}
          className={cn(
            'relative h-24 w-24 shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 border-dashed bg-muted transition-colors',
            dragOver ? 'border-primary' : 'border-border hover:border-primary/50',
            busy && 'pointer-events-none opacity-70',
          )}
          onClick={() => { if (!busy) fileRef.current?.click() }}
          onKeyDown={(e) => {
            if (busy || e.target !== e.currentTarget || e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const f = e.dataTransfer.files?.[0]
            if (f && f.type.startsWith('image/')) void upload(f)
          }}
        >
          {imageUrl ? (
            <>
              <ProductThumb src={imageUrl} alt="Product photo" className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label="Remove photo"
                disabled={busy}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/70 text-background"
                onClick={(e) => {
                  e.stopPropagation()
                  activeRead.current?.abort()
                  setReading(false)
                  onImageChange('')
                  onReading?.(null)
                }}
              >
                <X className="h-3 w-3" />
              </button>
              {reading && (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-foreground/70 py-0.5 text-[10px] text-background">
                  <Sparkles className="h-3 w-3" /> reading
                </div>
              )}
            </>
          ) : uploading ? (
            <div className="flex h-full w-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Upload className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </div>
        {/* min-w-0 + flex-1: without it the hint text sets this column's width
            and the whole row pushes past the dialog's right edge. */}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <Button type="button" variant="outline" size="sm" onClick={pasteFromClipboard} disabled={busy} className="text-xs">
            <ClipboardPaste className="mr-1 h-3 w-3" />
            Paste image
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground text-pretty">{hint}</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/**
 * The names the picture reader proposed, as one-click fills for a name field.
 * Rendered by the caller so the chips sit under the name input they fill.
 */
export function NameSuggestions({
  names,
  current,
  onPick,
}: {
  names: string[]
  current: string
  onPick: (name: string) => void
}) {
  if (names.length === 0) return null
  const norm = (s: string) => s.trim().toLowerCase()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Sparkles className="h-3 w-3" /> From the photo:
      </span>
      {names.slice(0, 6).map((n) => {
        const active = norm(n) === norm(current)
        return (
          <button
            key={n}
            type="button"
            onClick={() => onPick(n)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors',
              active ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-foreground hover:bg-accent',
            )}
          >
            {active && <Check className="h-3 w-3" />}
            {n}
          </button>
        )
      })}
    </div>
  )
}
