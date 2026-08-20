'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Download,
  Chrome,
  Languages,
  Crosshair,
  MousePointerClick,
  ClipboardCopy,
  Keyboard,
  Sparkles,
  Globe,
} from 'lucide-react'

const VERSION = '2.0.0'
const LAST_UPDATED = '2026-08-20'

const FEATURES = [
  {
    icon: Sparkles,
    title: 'Ask the AI anything',
    description:
      'Type what you want to do. The AI reads the controls on the page, answers in English, and gives you numbered steps.',
  },
  {
    icon: Globe,
    title: 'Works on every website',
    description: 'Not just 1688 - suppliers, banks, couriers, government portals. Anywhere you get stuck.',
  },
  {
    icon: Crosshair,
    title: 'Shows where to click',
    description: 'Dims the page and rings the exact button you need - or presses it for you with one tap.',
  },
  {
    icon: Languages,
    title: 'Hover to translate',
    description: 'Hover any Chinese label for the English meaning plus what it means for your order.',
  },
]

const PAGES = [
  { page: 'Product page', does: 'MOQ, price tiers, factory and OEM badges, weight, variants, add to cart' },
  { page: 'Search results', does: 'Sort by sales volume, image search, factory filters, repeat-buyer rate' },
  { page: 'Purchase cart', does: 'Quantities against MOQ, yuan total, checkout' },
  { page: 'Checkout', does: 'Forwarder address, remarks, domestic freight, submit order' },
  { page: 'Login', does: 'Mobile number, password and SMS verification fields' },
]

const STEPS = [
  { title: 'Download & Extract', desc: 'Download the ZIP and extract it to a folder' },
  { title: 'Open Extensions', desc: 'Go to chrome://extensions in your browser' },
  { title: 'Developer Mode', desc: 'Toggle "Developer mode" in the top right' },
  { title: 'Load Extension', desc: 'Click "Load unpacked" and select the folder' },
  { title: 'Open any page', desc: 'Press Alt+Z, sign in once, then ask' },
]

export function Tools1688Guide() {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = () => {
    setDownloading(true)
    try {
      const link = document.createElement('a')
      link.href = '/api/download-extension-1688?v=' + Date.now()
      link.download = `akmez-guide-v${VERSION}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 pb-12">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-card via-card to-sky-950/20 border border-border/50 p-8 md:p-12 mb-8">
        <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

        <div className="relative flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
          <div className="flex-1 text-center lg:text-left flex flex-col gap-6">
            <div className="inline-flex self-center lg:self-start items-center gap-2 px-4 py-2 rounded-full bg-sky-500/10 border border-sky-500/20">
              <Languages className="w-4 h-4 text-sky-400" />
              <span className="text-sm font-medium text-sky-400">Purchasing Tools</span>
            </div>

            <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight text-balance">
              Akmez Guide
              <span className="block text-sky-400">AI on every page</span>
            </h1>

            <p className="text-lg text-muted-foreground max-w-lg text-pretty">
              Stuck on any website? Open the panel and ask. The AI reads what is actually on screen, answers in English,
              and rings the exact button to click - or clicks it for you. On 1688.com it also translates the Chinese and
              captures listings for purchase orders.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <Button
                size="lg"
                className="h-14 px-8 text-lg bg-sky-500 hover:bg-sky-600 text-white shadow-lg shadow-sky-500/25 transition-all hover:scale-[1.02] active:scale-[0.98]"
                onClick={handleDownload}
                disabled={downloading}
              >
                <Chrome className="w-5 h-5 mr-2" />
                {downloading ? 'Preparing...' : 'Download Extension'}
                <Download className="w-5 h-5 ml-2" />
              </Button>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline" className="border-sky-500/30 text-sky-400">
                  v{VERSION}
                </Badge>
                <span>Updated {LAST_UPDATED}</span>
              </div>
            </div>
          </div>

          {/* Overlay mockup */}
          <div className="relative shrink-0">
            <div
              className="rounded-2xl overflow-hidden border border-border/50 shadow-2xl bg-[#0f1115] p-4 -rotate-2 hover:rotate-0 transition-transform duration-500"
              style={{ width: 320 }}
            >
              <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-orange-500/20 to-transparent border border-orange-500/20 mb-4">
                <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center text-white font-bold">
                  A
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">Akmez Guide</div>
                  <div className="text-[11px] text-slate-400">AI co-pilot for any page</div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3 text-[11px] text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Detected page: <span className="text-orange-400 font-semibold">Product page</span>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 mb-3 text-[11.5px] text-slate-300">
                How do I order 200 of these?
              </div>

              <div className="flex flex-col gap-2">
                {[
                  { n: 1, t: 'Check the minimum order quantity', cn: '起订量' },
                  { n: 2, t: 'Confirm this seller is a factory', cn: '实力工厂' },
                  { n: 3, t: 'Add to the purchase cart', cn: '加入进货单' },
                ].map(s => (
                  <div
                    key={s.n}
                    className={`flex gap-2.5 p-2.5 rounded-xl border ${
                      s.n === 3 ? 'bg-orange-500/15 border-orange-500' : 'bg-white/[0.035] border-white/10'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 shrink-0 rounded-md text-[10px] font-bold flex items-center justify-center ${
                        s.n === 3 ? 'bg-orange-500 text-white' : 'bg-orange-500/20 text-orange-400'
                      }`}
                    >
                      {s.n}
                    </div>
                    <div>
                      <div className="text-[12px] font-medium text-slate-100 leading-snug">{s.t}</div>
                      <div className="inline-block mt-1.5 px-1.5 py-0.5 rounded bg-sky-400/15 text-sky-300 text-[11px] font-semibold">
                        {s.cn}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="absolute -top-3 -right-3 px-3 py-1.5 rounded-full bg-sky-500/20 border border-sky-500/30 text-sky-400 text-xs font-medium">
              Alt+Z
            </div>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {FEATURES.map(f => (
          <Card key={f.title} className="group border-sky-500/20 bg-card/50 hover:bg-card transition-all duration-300">
            <CardContent className="p-6">
              <div className="w-12 h-12 rounded-xl bg-sky-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <f.icon className="w-6 h-6 text-sky-400" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Page coverage + capture */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <Card className="border-border/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center">
                <MousePointerClick className="w-5 h-5 text-sky-400" />
              </div>
              <h3 className="font-semibold text-foreground">Walkthroughs it knows</h3>
            </div>
            <ul className="flex flex-col gap-3">
              {PAGES.map(p => (
                <li key={p.page} className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-foreground">{p.page}</span>
                  <span className="text-xs text-muted-foreground leading-relaxed">{p.does}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center">
                <ClipboardCopy className="w-5 h-5 text-orange-400" />
              </div>
              <h3 className="font-semibold text-foreground">Straight into a purchase order</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              On any product page the guide captures the offer ID, listing link, price, MOQ, and the factory and OEM
              badges. One click copies it all, ready to paste into a new purchase order in Akmez.
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Keyboard className="w-4 h-4 text-orange-400" />
              Press <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-semibold">Alt+Z</span>
              to open or close the guide
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Install */}
      <Card className="border-border/50">
        <CardContent className="p-6">
          <h3 className="font-semibold text-foreground mb-5">Installation</h3>
          <div className="grid sm:grid-cols-5 gap-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex flex-col gap-2">
                <div className="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-400 font-bold text-sm flex items-center justify-center">
                  {i + 1}
                </div>
                <div className="text-sm font-medium text-foreground leading-snug">{s.title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed">{s.desc}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
