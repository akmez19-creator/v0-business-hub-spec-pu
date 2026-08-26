'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Plus, X, MessageSquare } from 'lucide-react'
import type { SupplierSummary, SupplierThread } from './po-suppliers-content'

type Message = { id: string; from: 'me' | 'them'; body: string }

/**
 * Everything we know about one supplier: their captured 1688 conversations and
 * the products they supply.
 */
export function SupplierDetailSheet({
  supplier,
  allProducts,
  onClose,
}: {
  supplier: SupplierSummary | null
  allProducts: { id: string; name: string }[]
  onClose: () => void
}) {
  const router = useRouter()
  const [thread, setThread] = useState<SupplierThread | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [busyProduct, setBusyProduct] = useState('')

  // Default to the most recently captured conversation.
  useEffect(() => {
    setThread(supplier?.threads[0] ?? null)
    setMessages(null)
    setError('')
    setProductQuery('')
  }, [supplier])

  useEffect(() => {
    if (!thread) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`/api/suppliers/thread/${thread.id}`)
      .then(async res => {
        // Branch on the status BEFORE reading the body: an expired session
        // returns a bare 401 and an HTML error page would throw here and be
        // reported as whatever the catch block says.
        if (res.status === 401) throw new Error('Your session expired. Sign in again to read this conversation.')
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || 'Could not load this conversation.')
        return json
      })
      .then(json => {
        if (!cancelled) setMessages(json.messages)
      })
      .catch(e => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [thread])

  // Products actually ordered, plus any attached by hand. Ordered ones are
  // derived from purchase orders and cannot be removed here.
  const orderedNames = useMemo(() => new Set(supplier?.products ?? []), [supplier])
  const manual = supplier?.manualProducts ?? []

  const candidates = useMemo(() => {
    const q = productQuery.trim().toLowerCase()
    if (!q) return []
    const taken = new Set(manual.map(m => m.id))
    return allProducts
      .filter(p => !taken.has(p.id) && !orderedNames.has(p.name) && p.name.toLowerCase().includes(q))
      .slice(0, 6)
  }, [productQuery, allProducts, manual, orderedNames])

  async function addProduct(productId: string) {
    if (!supplier) return
    setBusyProduct(productId)
    try {
      const res = await fetch('/api/suppliers/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierName: supplier.name, productId }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setProductQuery('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not attach that product.')
    } finally {
      setBusyProduct('')
    }
  }

  async function removeProduct(productId: string) {
    if (!supplier) return
    setBusyProduct(productId)
    try {
      const res = await fetch(
        `/api/suppliers/products?supplierName=${encodeURIComponent(supplier.name)}&productId=${productId}`,
        { method: 'DELETE' },
      )
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that product.')
    } finally {
      setBusyProduct('')
    }
  }

  return (
    <Sheet open={!!supplier} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0 overflow-hidden">
        {supplier && (
          // min-h-0 is load-bearing: without it this flex child keeps its full
          // content height, and the scrolling message list is painted OVER the
          // tab strip - which silently swallows every click on "Products".
          <div className="flex min-h-0 flex-1 flex-col">
            <SheetHeader className="p-6 pb-4 shrink-0">
              <SheetTitle className="text-balance">{supplier.name}</SheetTitle>
              <SheetDescription>
                {supplier.orders} order{supplier.orders === 1 ? '' : 's'} · {supplier.threads.length} conversation
                {supplier.threads.length === 1 ? '' : 's'} on file
              </SheetDescription>
            </SheetHeader>

            <Tabs defaultValue="chat" className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <TabsList className="mx-6 w-fit shrink-0">
                <TabsTrigger value="chat">Conversation</TabsTrigger>
                <TabsTrigger value="products">Products</TabsTrigger>
              </TabsList>

              <TabsContent value="chat" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 mt-4">
                {supplier.threads.length > 1 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {supplier.threads.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setThread(t)}
                        className={`rounded-md border px-2.5 py-1 text-xs ${
                          thread?.id === t.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t.handle} · {t.messages}
                      </button>
                    ))}
                  </div>
                )}

                {thread && !thread.complete && (
                  <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Only the messages loaded so far are stored. Older ones are archived the next time this chat is
                    opened in 1688.
                  </p>
                )}

                {loading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Loading conversation...
                  </div>
                )}

                {error && !loading && (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}

                {!loading && !error && messages?.length === 0 && (
                  <p className="text-sm text-muted-foreground">This conversation was captured but held no messages.</p>
                )}

                {!loading && !error && messages && messages.length > 0 && (
                  <ol className="flex flex-col gap-2">
                    {messages.map(m => (
                      <li
                        key={m.id}
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                          m.from === 'me'
                            ? 'self-end bg-primary text-primary-foreground'
                            : 'self-start bg-muted text-foreground'
                        }`}
                      >
                        {m.body}
                      </li>
                    ))}
                  </ol>
                )}

                {!supplier.threads.length && (
                  <div className="text-center py-10 text-muted-foreground">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
                    <p className="text-sm">No conversation captured yet.</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="products" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 mt-4">
                <h3 className="text-sm font-medium mb-2">Ordered from this supplier</h3>
                {supplier.products.length ? (
                  <div className="flex flex-wrap gap-1.5 mb-6">
                    {supplier.products.map(p => (
                      <Badge key={p} variant="secondary" className="font-normal">
                        {p}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mb-6">Nothing ordered yet.</p>
                )}

                <h3 className="text-sm font-medium mb-2">Added by hand</h3>
                {manual.length ? (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {manual.map(p => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs"
                      >
                        {p.name}
                        <button
                          type="button"
                          onClick={() => removeProduct(p.id)}
                          disabled={busyProduct === p.id}
                          aria-label={`Remove ${p.name} from ${supplier.name}`}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                        >
                          <X className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mb-4">
                    Nothing added by hand. Use this for products discussed but not yet ordered.
                  </p>
                )}

                <Input
                  placeholder="Search a product to attach..."
                  value={productQuery}
                  onChange={e => setProductQuery(e.target.value)}
                  aria-label="Search a product to attach to this supplier"
                />
                {candidates.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {candidates.map(p => (
                      <li key={p.id}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start font-normal"
                          disabled={busyProduct === p.id}
                          onClick={() => addProduct(p.id)}
                        >
                          <Plus className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                          {p.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {productQuery.trim() && candidates.length === 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">No other products match that search.</p>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
