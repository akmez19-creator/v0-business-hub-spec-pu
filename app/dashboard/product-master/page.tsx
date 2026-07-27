'use client'

import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { Clapperboard, Copy, Frame, GitMerge, Sparkles } from 'lucide-react'
import { ProductsTab, type ToolRequest } from '@/components/product-master/products-tab'
import { AiPostsTab } from '@/components/product-master/ai-posts-tab'
import { ReelsStudioTab } from '@/components/product-master/reels-studio-tab'
import { CampaignCreatorTab } from '@/components/product-master/campaign-creator-tab'
import { MergeCenter } from '@/components/product-master/merge-center'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Product Master: the inventory + purchase-order table IS the page, and
// every product row carries its own tool buttons (AI Post, Reels, Frame,
// Campaign). Clicking one pops the tool up pre-loaded with that product.
// The AI Merge Center reconciles differing product names from POs and
// deliveries into the canonical inventory, with user validation.
export default function ProductMasterPage() {
  const [request, setRequest] = useState<ToolRequest | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)

  // Unmatched count for the header badge
  const { data: mergeData } = useSWR<{ unmatched?: unknown[] }>('/api/product-master/merge', fetcher)
  const unmatchedCount = mergeData?.unmatched?.length ?? 0

  const close = () => setRequest(null)
  const productName = request?.product.name ?? ''

  return (
    <main className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Product Master</h1>
          <p className="text-sm text-muted-foreground">
            Inventory, purchasing, content and campaign creation in one place
          </p>
        </div>
        <Button variant="outline" onClick={() => setMergeOpen(true)}>
          <GitMerge className="mr-2 h-4 w-4 text-violet-400" />
          AI Merge
          {unmatchedCount > 0 && (
            <Badge className="ml-2 border-amber-500/40 bg-amber-500/15 text-amber-500" variant="outline">
              {unmatchedCount}
            </Badge>
          )}
        </Button>
      </header>

      {/* The product table is the page - tools live on each row */}
      <ProductsTab onOpenTool={setRequest} />

      {/* ---- AI Merge Center ---- */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15">
                <GitMerge className="h-4 w-4 text-violet-400" />
              </span>
              AI Merge Center
            </DialogTitle>
            <DialogDescription>
              Match purchase order and delivery product names to your inventory. AI suggests, you validate.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {mergeOpen && <MergeCenter onMerged={() => mutate('/api/product-master/overview')} />}
          </div>
        </DialogContent>
      </Dialog>

      {/* ---- Tool popups, pre-loaded with the clicked product ---- */}
      <Dialog open={request?.tool === 'ai-posts'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
                <Sparkles className="h-4 w-4 text-amber-500" />
              </span>
              AI Post
              <span className="truncate font-normal text-muted-foreground">{productName}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Generate ad copy, captions and descriptions for this product
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {request?.tool === 'ai-posts' && <AiPostsTab initialProductId={request.product.id} />}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={request?.tool === 'reels'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15">
                <Clapperboard className="h-4 w-4 text-sky-500" />
              </span>
              Reels Studio
              <span className="truncate font-normal text-muted-foreground">{productName}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Cut scenes and merge clips into a reel, all in your browser
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {/* Mount only while open so the ~30MB ffmpeg wasm core never loads early */}
            {request?.tool === 'reels' && <ReelsStudioTab />}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={request?.tool === 'frames'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Frame className="h-5 w-5" /> Frame Input {'\u2014'} {productName}
            </DialogTitle>
            <DialogDescription>
              Feed a structured frame template (hook, scenes, captions, CTA) and generate
              ready-to-post reels automatically. This workflow is coming soon.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-4">
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500">
              Coming soon
            </Badge>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={request?.tool === 'campaigns'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15">
                <Copy className="h-4 w-4 text-emerald-500" />
              </span>
              Campaign Creator
              <span className="truncate font-normal text-muted-foreground">{productName}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Duplicate an existing campaign and rename campaign, ad sets and ads to one common name
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {request?.tool === 'campaigns' && <CampaignCreatorTab initialName={productName} />}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
