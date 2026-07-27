'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Check, Copy, FileText, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react'

interface PostContent {
  hook?: string
  body?: string
  cta?: string
  hashtags?: string
  raw?: string
}

interface ProductPost {
  id: string
  product_id: string | null
  product_name: string
  post_type: string
  tone: string | null
  language: string | null
  content: PostContent
  offers_used: string[]
  created_at: string
}

interface ProductOption {
  id: string
  name: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const TYPE_LABEL: Record<string, string> = {
  fb_ad: 'FB ad',
  reel_caption: 'Reel caption',
  description: 'Description',
}

interface PostForm {
  id: string | null // null = creating
  productId: string
  productName: string
  postType: string
  hook: string
  body: string
  cta: string
  hashtags: string
}

const EMPTY_FORM: PostForm = {
  id: null,
  productId: '',
  productName: '',
  postType: 'fb_ad',
  hook: '',
  body: '',
  cta: '',
  hashtags: '',
}

// Manage Posts: full post management attributed to products - add existing
// posts manually, edit, copy, delete. Everything saved here feeds the AI
// knowledge centre so new generations never repeat old angles.
export function ManagePosts() {
  const [open, setOpen] = useState(false)
  const { data, isLoading, mutate } = useSWR<{ success: boolean; posts: ProductPost[] }>(
    open ? '/api/product-master/posts' : null,
    fetcher,
  )
  // Product list so manual posts can be attributed to a real inventory item
  const { data: overview } = useSWR<{ success: boolean; products: ProductOption[] }>(
    open ? '/api/product-master/overview' : null,
    fetcher,
  )
  const productOptions = overview?.products ?? []

  const [search, setSearch] = useState('')
  const [openPost, setOpenPost] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [form, setForm] = useState<PostForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const posts = useMemo(() => {
    let list = data?.posts || []
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (p) => p.product_name.toLowerCase().includes(q) || (p.content?.raw || '').toLowerCase().includes(q),
      )
    }
    return list
  }, [data, search])

  const copyPost = async (p: ProductPost) => {
    const c = p.content || {}
    const text = [c.hook, c.body, c.cta, c.hashtags].filter(Boolean).join('\n\n') || c.raw || ''
    await navigator.clipboard.writeText(text)
    setCopiedId(p.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const deletePost = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch('/api/product-master/posts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) mutate()
    } finally {
      setDeletingId(null)
    }
  }

  const startEdit = (p: ProductPost) => {
    setFormError('')
    setForm({
      id: p.id,
      productId: p.product_id ?? '',
      productName: p.product_name,
      postType: p.post_type,
      hook: p.content?.hook || '',
      body: p.content?.body || p.content?.raw || '',
      cta: p.content?.cta || '',
      hashtags: p.content?.hashtags || '',
    })
  }

  const savePost = async () => {
    if (!form) return
    const productName =
      form.productId && productOptions.length > 0
        ? (productOptions.find((o) => o.id === form.productId)?.name ?? form.productName)
        : form.productName
    if (!productName.trim()) {
      setFormError('Pick a product or type a product name.')
      return
    }
    if (!form.hook.trim() && !form.body.trim()) {
      setFormError('Write at least a hook or a body.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const payload = {
        id: form.id,
        productId: form.productId || null,
        productName,
        postType: form.postType,
        content: { hook: form.hook, body: form.body, cta: form.cta, hashtags: form.hashtags },
      }
      const res = await fetch('/api/product-master/posts', {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed')
      setForm(null)
      mutate()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileText className="mr-1.5 h-3.5 w-3.5 text-amber-500" /> Manage Posts
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setForm(null) }}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
                <FileText className="h-4 w-4 text-amber-500" />
              </span>
              Manage Posts
            </DialogTitle>
            <DialogDescription>
              All posts attributed to products - add existing ones, edit, copy or delete. This history feeds the AI knowledge centre.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* ---- Create / Edit form ---- */}
            {form ? (
              <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-semibold">{form.id ? 'Edit post' : 'Add existing post'}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    value={form.productId || 'none'}
                    onValueChange={(v) => setForm({ ...form, productId: v === 'none' ? '' : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={'Attribute to product\u2026'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{'No product / type name below'}</SelectItem>
                      {productOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={form.postType} onValueChange={(v) => setForm({ ...form, postType: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fb_ad">FB ad</SelectItem>
                      <SelectItem value="reel_caption">Reel caption</SelectItem>
                      <SelectItem value="description">Description</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {!form.productId && (
                  <Input
                    placeholder="Product name (if not in inventory)"
                    value={form.productName}
                    onChange={(e) => setForm({ ...form, productName: e.target.value })}
                  />
                )}
                <Input
                  placeholder="Hook (first line that grabs attention)"
                  value={form.hook}
                  onChange={(e) => setForm({ ...form, hook: e.target.value })}
                />
                <Textarea
                  placeholder="Body of the post"
                  rows={4}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="CTA (e.g. Order now on WhatsApp)"
                    value={form.cta}
                    onChange={(e) => setForm({ ...form, cta: e.target.value })}
                  />
                  <Input
                    placeholder="Hashtags"
                    value={form.hashtags}
                    onChange={(e) => setForm({ ...form, hashtags: e.target.value })}
                  />
                </div>
                {formError && <p className="text-sm text-red-400">{formError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={savePost} disabled={saving}>
                    {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                    {form.id ? 'Save changes' : 'Add post'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setForm(null)} disabled={saving}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="relative max-w-xs flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search product or content..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <Button size="sm" variant="outline" onClick={() => { setFormError(''); setForm(EMPTY_FORM) }}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add post
                </Button>
              </div>
            )}

            {isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">{'Loading posts\u2026'}</p>
            )}
            {!isLoading && posts.length === 0 && !form && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No posts yet. Generate one from any product row (AI Post), or click Add post to bring in existing ones.
              </p>
            )}

            <div className="flex flex-col gap-2">
              {posts.map((p) => {
                const isOpen = openPost === p.id
                const c = p.content || {}
                return (
                  <div key={p.id} className="rounded-lg border">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setOpenPost(isOpen ? null : p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setOpenPost(isOpen ? null : p.id)
                        }
                      }}
                      className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                    >
                      <span className="truncate font-medium">{p.product_name}</span>
                      <Badge variant="outline" className="text-xs">{TYPE_LABEL[p.post_type] ?? p.post_type}</Badge>
                      {p.tone === 'manual' && (
                        <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-xs text-sky-400">Manual</Badge>
                      )}
                      {p.offers_used?.length > 0 && (
                        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-500">
                          {p.offers_used[0]}
                          {p.offers_used.length > 1 ? ` +${p.offers_used.length - 1}` : ''}
                        </Badge>
                      )}
                      <span className="ml-auto flex items-center gap-1">
                        <span className="mr-1 text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString()}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Edit post"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(p)
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Copy post"
                          onClick={(e) => {
                            e.stopPropagation()
                            copyPost(p)
                          }}
                        >
                          {copiedId === p.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-400 hover:text-red-400"
                          title="Delete post"
                          disabled={deletingId === p.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            deletePost(p.id)
                          }}
                        >
                          {deletingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </span>
                    </div>
                    {isOpen && (
                      <div className="flex flex-col gap-2 border-t bg-muted/30 px-3 py-2.5 text-sm">
                        {(
                          [
                            ['Hook', c.hook],
                            ['Body', c.body],
                            ['CTA', c.cta],
                            ['Hashtags', c.hashtags],
                          ] as const
                        ).map(([label, text]) =>
                          text ? (
                            <div key={label} className="grid grid-cols-[76px_1fr] gap-2">
                              <Badge variant="outline" className="h-fit justify-center">{label}</Badge>
                              <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
                            </div>
                          ) : null,
                        )}
                        {p.tone && (
                          <p className="text-xs text-muted-foreground">
                            Tone: {p.tone} {'\u00b7'} Language: {p.language || 'en'}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
