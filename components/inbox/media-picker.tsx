'use client'

import { useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Film, ImageIcon, Link2, Loader2, Paperclip, Search, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { mediaSrc } from '@/lib/media-url'
import type { QuickOrderProduct } from '@/lib/orders/quick-order'
import { readInbox } from './inbox-session'

export type ComposerAttachment = {
  url: string
  kind: 'image' | 'video'
  mime: string
  /** Shown on the chip in the composer. */
  label: string
}

type ProductMedia = { productName: string; items: { url: string; kind: 'image' | 'video'; primary: boolean }[] }
type AdPost = { permalinkUrl: string; adName: string | null; mediaType: string | null } | null

/**
 * "Attach a photo or video" for a reply.
 *
 * Three sources, three tabs: the product's stored photos and clips (opens on
 * the product in Quick order or the ad's product), a file from the agent's
 * device, and the ad's own post - shared as a LINK because Facebook video URLs
 * expire and Meta refuses to re-host its own media. Product and upload picks
 * are staged on our public store first so the customer's app can fetch them.
 */
export function MediaPicker({
  productId,
  adId,
  disabled,
  onAttach,
  onInsertLink,
}: {
  productId: string | null
  adId: string | null
  disabled?: boolean
  onAttach: (attachment: ComposerAttachment) => void
  onInsertLink: (url: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [chosenProductId, setChosenProductId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busyUrl, setBusyUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Same key as the Quick order panel, so the catalogue is already in the SWR cache.
  const { data: catalogue } = useSWR<{ products?: QuickOrderProduct[] }>(open ? '/api/extension' : null, readInbox, { revalidateOnFocus: false })
  const products = catalogue?.products ?? []
  const activeProductId = chosenProductId ?? productId
  const { data: media, isLoading: mediaLoading } = useSWR<ProductMedia>(
    open && activeProductId ? `/api/inbox/media?productId=${encodeURIComponent(activeProductId)}` : null,
    readInbox,
    { revalidateOnFocus: false },
  )
  const { data: adData, isLoading: adLoading } = useSWR<{ post: AdPost }>(
    open && adId ? `/api/inbox/media?adId=${encodeURIComponent(adId)}` : null,
    readInbox,
    { revalidateOnFocus: false },
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [products, query])

  const stage = async (init: RequestInit, key: string) => {
    setBusyUrl(key)
    setError(null)
    try {
      const res = await fetch('/api/inbox/media', { method: 'POST', ...init })
      const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string; media?: ComposerAttachment } | null
      if (!res.ok || !body?.success || !body.media) throw new Error(body?.error || 'The file could not be prepared.')
      onAttach(body.media)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file could not be prepared.')
    } finally {
      setBusyUrl(null)
    }
  }

  const pickProductMedia = (url: string) => {
    if (!activeProductId) return
    void stage({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: activeProductId, url }) }, url)
  }

  const pickFile = (file: File | undefined) => {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    void stage({ body: form }, `upload:${file.name}`)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setError(null); setQuery('') } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="h-7 gap-1.5 text-xs" aria-label="Attach a photo or video">
          <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          Photo / video
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a photo or video</DialogTitle>
          <DialogDescription>The text in the reply box is sent as the caption.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="product">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="product" className="gap-1.5"><ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />Product</TabsTrigger>
            <TabsTrigger value="upload" className="gap-1.5"><Upload className="h-3.5 w-3.5" aria-hidden="true" />Upload</TabsTrigger>
            <TabsTrigger value="ad" className="gap-1.5" disabled={!adId}><Link2 className="h-3.5 w-3.5" aria-hidden="true" />Ad post</TabsTrigger>
          </TabsList>

          <TabsContent value="product" className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search another product..." className="h-8 pl-8 text-sm" aria-label="Search products" />
              {matches.length ? (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md" role="listbox">
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button type="button" role="option" aria-selected={p.id === activeProductId} onClick={() => { setChosenProductId(p.id); setQuery('') }}
                        className="w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent">{p.name}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {!activeProductId ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Choose a product in Quick order or search one above.</p>
            ) : mediaLoading ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading photos...</p>
            ) : !media?.items.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{media?.productName ?? 'This product'} has no stored photos or clips.</p>
            ) : (
              <>
                <p className="truncate text-xs text-muted-foreground">{media.productName} · {media.items.filter((i) => i.kind === 'image').length} photos, {media.items.filter((i) => i.kind === 'video').length} clips</p>
                <ul className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                  {media.items.map((item) => (
                    <li key={item.url}>
                      <button type="button" onClick={() => pickProductMedia(item.url)} disabled={Boolean(busyUrl)}
                        className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted transition hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                        aria-label={item.kind === 'image' ? `Send this photo of ${media.productName}` : `Send this clip of ${media.productName}`}>
                        {item.kind === 'image' ? (
                          <img src={mediaSrc(item.url)} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <video src={mediaSrc(item.url)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                        )}
                        {item.kind === 'video' ? <Film className="absolute bottom-1 right-1 h-4 w-4 rounded bg-background/80 p-0.5 text-foreground" aria-hidden="true" /> : null}
                        {item.primary ? <span className="absolute left-1 top-1 rounded bg-background/80 px-1 text-[10px] font-medium">Main</span> : null}
                        {busyUrl === item.url ? <span className="absolute inset-0 flex items-center justify-center bg-background/70"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /></span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </TabsContent>

          <TabsContent value="upload" className="flex flex-col items-center gap-3 py-4">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,video/quicktime" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} aria-label="Choose a photo or video from this device" />
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={Boolean(busyUrl)} className="gap-2">
              {busyUrl?.startsWith('upload:') ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {busyUrl?.startsWith('upload:') ? 'Preparing...' : 'Choose from this device'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">JPG, PNG or WebP up to 5 MB · MP4 video up to 16 MB</p>
          </TabsContent>

          <TabsContent value="ad" className="flex flex-col gap-3 py-2">
            {adLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Finding the ad&apos;s post...</p>
            ) : !adData?.post ? (
              <p className="text-sm text-muted-foreground">This ad&apos;s post could not be found, so there is no link to share.</p>
            ) : (
              <>
                <p className="text-sm">
                  {adData.post.adName ? <span className="font-medium">{adData.post.adName}</span> : 'The ad the customer clicked'}
                  {adData.post.mediaType ? <span className="text-muted-foreground"> · {adData.post.mediaType.toLowerCase()}</span> : null}
                </p>
                <p className="truncate rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">{adData.post.permalinkUrl}</p>
                <Button type="button" size="sm" onClick={() => { onInsertLink(adData.post!.permalinkUrl); setOpen(false) }} className="gap-1.5 self-start">
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />Add the link to the reply
                </Button>
                <p className="text-xs text-muted-foreground">Facebook video files cannot be re-sent, so the post itself is shared as a link the customer opens in Facebook.</p>
              </>
            )}
          </TabsContent>
        </Tabs>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  )
}
