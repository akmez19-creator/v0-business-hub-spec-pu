'use client'

import { useState } from 'react'
import { Sparkles, Clapperboard, Frame, Copy } from 'lucide-react'
import { ProductsTab } from '@/components/product-master/products-tab'
import { AiPostsTab } from '@/components/product-master/ai-posts-tab'
import { ReelsStudioTab } from '@/components/product-master/reels-studio-tab'
import { CampaignCreatorTab } from '@/components/product-master/campaign-creator-tab'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ToolId = 'ai-posts' | 'reels' | 'frames' | 'campaigns' | null

// Product Master: the inventory + purchase-order table IS the page.
// The creation tools (AI Posts, Reels Studio, Frame Input, Campaign
// Creator) are toolbar buttons beside the title that open as popups.
export default function ProductMasterPage() {
  const [openTool, setOpenTool] = useState<ToolId>(null)

  return (
    <main className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Product Master</h1>
          <p className="text-sm text-muted-foreground">
            Inventory, purchasing, content and campaign creation in one place
          </p>
        </div>

        {/* Functionality tools - pop up over the product table */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpenTool('ai-posts')}>
            <Sparkles className="h-4 w-4 text-amber-500" /> AI Posts
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpenTool('reels')}>
            <Clapperboard className="h-4 w-4 text-sky-500" /> Reels Studio
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setOpenTool('frames')}
          >
            <Frame className="h-4 w-4 text-muted-foreground" /> Frame Input
            <Badge variant="outline" className="ml-0.5 border-amber-500/40 bg-amber-500/10 px-1 text-[9px] text-amber-500">
              Soon
            </Badge>
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpenTool('campaigns')}>
            <Copy className="h-4 w-4 text-emerald-500" /> Campaign Creator
          </Button>
        </div>
      </header>

      {/* The product table is the page content */}
      <ProductsTab />

      {/* ---- Tool popups ---- */}
      <Dialog open={openTool === 'ai-posts'} onOpenChange={(o) => !o && setOpenTool(null)}>
        <DialogContent className="max-h-[85vh] w-full max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" /> AI Post Generation
            </DialogTitle>
            <DialogDescription>Generate ad copy, captions and descriptions per product</DialogDescription>
          </DialogHeader>
          <AiPostsTab />
        </DialogContent>
      </Dialog>

      <Dialog open={openTool === 'reels'} onOpenChange={(o) => !o && setOpenTool(null)}>
        <DialogContent className="max-h-[85vh] w-full max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clapperboard className="h-5 w-5 text-sky-500" /> Reels Studio
            </DialogTitle>
            <DialogDescription>Cut scenes and merge clips into a reel, all in your browser</DialogDescription>
          </DialogHeader>
          {/* Mount only while open so the ~30MB ffmpeg wasm core never loads early */}
          {openTool === 'reels' && <ReelsStudioTab />}
        </DialogContent>
      </Dialog>

      <Dialog open={openTool === 'frames'} onOpenChange={(o) => !o && setOpenTool(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Frame className="h-5 w-5" /> Structured Frame Input
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

      <Dialog open={openTool === 'campaigns'} onOpenChange={(o) => !o && setOpenTool(null)}>
        <DialogContent className="max-h-[85vh] w-full max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-5 w-5 text-emerald-500" /> Campaign Creator
            </DialogTitle>
            <DialogDescription>
              Duplicate an existing campaign and rename campaign, ad sets and ads to one common name
            </DialogDescription>
          </DialogHeader>
          <CampaignCreatorTab />
        </DialogContent>
      </Dialog>
    </main>
  )
}
