'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Check, Copy, FileText, Loader2, Search, Trash2 } from 'lucide-react'

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

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const TYPE_LABEL: Record<string, string> = {
  fb_ad: 'FB ad',
  reel_caption: 'Reel caption',
  description: 'Description',
}

// Manage Posts: every AI-generated post is attributed to its product and
// managed here - view, copy, delete. This same history feeds the AI
// knowledge centre so new generations never repeat old hooks.
export function ManagePosts() {
  const [open, setOpen] = useState(false)
  const { data, isLoading, mutate } = useSWR<{ success: boolean; posts: ProductPost[] }>(
    open ? '/api/product-master/posts' : null,
    fetcher,
  )
  const [search, setSearch] = useState('')
  const [openPost, setOpenPost] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileText className="mr-1.5 h-3.5 w-3.5 text-amber-500" /> Manage Posts
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
                <FileText className="h-4 w-4 text-amber-500" />
              </span>
              Manage Posts
            </DialogTitle>
            <DialogDescription>
              Every generated post, attributed to its product. This history also feeds the AI so it never repeats itself.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="relative mb-3 max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search product or content..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>

            {isLoading && (
              <p className="py-8 text-center text-sm text-muted-foreground">{'Loading posts\u2026'}</p>
            )}
            {!isLoading && posts.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No posts yet. Generate one from any product row (AI Post) and it lands here automatically.
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
