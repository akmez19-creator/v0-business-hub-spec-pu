'use client'

import { useState } from 'react'
import { Clapperboard, Copy, Frame, Sparkles } from 'lucide-react'
import { ProductsTab, type ToolRequest } from '@/components/product-master/products-tab'
import { AiPostsTab } from '@/components/product-master/ai-posts-tab'
import { ReelsStudioTab } from '@/components/product-master/reels-studio-tab'
import { CampaignCreatorTab } from '@/components/product-master/campaign-creator-tab'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Product Master: the inventory + purchase-order table IS the page, and
// every product row carries its own tool buttons (AI Post, Reels, Frame,
// Campaign). Clicking one pops the tool up pre-loaded with that product.
export default function ProductMasterPage() {
  const [request, setRequest] = useState<ToolRequest | null>(null)

  const close = () => setRequest(null)
  const productName = request?.product.name ?? ''

  return (
    <main className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Product Master</h1>
        <p className="text-sm text-muted-foreground">
          Inventory, purchasing, content and campaign creation in one place
        </p>
      </header>

      {/* The product table is the page - tools live on each row */}
      <ProductsTab onOpenTool={setRequest} />

      {/* ---- Tool popups, pre-loaded with the clicked product ---- */}
      <Dialog open={request?.tool === 'ai-posts'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[85vh] w-full max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" /> AI Post {'\u2014'} {productName}
            </DialogTitle>
            <DialogDescription>Generate ad copy, captions and descriptions for this product</DialogDescription>
          </DialogHeader>
          {request?.tool === 'ai-posts' && <AiPostsTab initialProductId={request.product.id} />}
        </DialogContent>
      </Dialog>

      <Dialog open={request?.tool === 'reels'} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-h-[85vh] w-full max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clapperboard className="h-5 w-5 text-sky-500" /> Reels Studio {'\u2014'} {productName}
            </DialogTitle>
            <DialogDescription>Cut scenes and merge clips into a reel, all in your browser</DialogDescription>
          </DialogHeader>
          {/* Mount only while open so the ~30MB ffmpeg wasm core never loads early */}
          {request?.tool === 'reels' && <ReelsStudioTab />}
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
        <DialogContent className="max-h-[85vh] w-full max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-5 w-5 text-emerald-500" /> Campaign Creator {'\u2014'} {productName}
            </DialogTitle>
            <DialogDescription>
              Duplicate an existing campaign and rename campaign, ad sets and ads to one common name
            </DialogDescription>
          </DialogHeader>
          {request?.tool === 'campaigns' && <CampaignCreatorTab initialName={productName} />}
        </DialogContent>
      </Dialog>
    </main>
  )
}
