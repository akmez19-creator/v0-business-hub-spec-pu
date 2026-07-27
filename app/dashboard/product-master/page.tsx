'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Boxes, Sparkles, Clapperboard, Frame, Copy } from 'lucide-react'
import { ProductsTab } from '@/components/product-master/products-tab'
import { AiPostsTab } from '@/components/product-master/ai-posts-tab'
import { ReelsStudioTab } from '@/components/product-master/reels-studio-tab'
import { CampaignCreatorTab } from '@/components/product-master/campaign-creator-tab'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// Product Master: one hub per product - stock + purchase orders, AI post
// generation, reels cut/merge studio, and FB campaign duplication.
export default function ProductMasterPage() {
  const [tab, setTab] = useState('products')

  return (
    <main className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Product Master</h1>
        <p className="text-sm text-muted-foreground">
          Inventory, purchasing, content and campaign creation in one place
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="products" className="gap-1.5">
            <Boxes className="h-4 w-4" /> Products
          </TabsTrigger>
          <TabsTrigger value="ai-posts" className="gap-1.5">
            <Sparkles className="h-4 w-4" /> AI Posts
          </TabsTrigger>
          <TabsTrigger value="reels" className="gap-1.5">
            <Clapperboard className="h-4 w-4" /> Reels Studio
          </TabsTrigger>
          <TabsTrigger value="frames" className="gap-1.5">
            <Frame className="h-4 w-4" /> Frame Input
            <Badge variant="outline" className="ml-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-500">
              Soon
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-1.5">
            <Copy className="h-4 w-4" /> Campaign Creator
          </TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <ProductsTab />
        </TabsContent>
        <TabsContent value="ai-posts">
          <AiPostsTab />
        </TabsContent>
        <TabsContent value="reels">
          {/* Mount only when opened so the ~30MB ffmpeg wasm core never loads early */}
          {tab === 'reels' && <ReelsStudioTab />}
        </TabsContent>
        <TabsContent value="frames">
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <Frame className="h-10 w-10 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Structured Frame Input</h2>
              <p className="max-w-md text-sm text-muted-foreground text-pretty">
                Feed a structured frame template (hook, scenes, captions, CTA) and generate
                ready-to-post reels automatically. This workflow is coming soon.
              </p>
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500">
                Coming soon
              </Badge>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="campaigns">
          <CampaignCreatorTab />
        </TabsContent>
      </Tabs>
    </main>
  )
}
