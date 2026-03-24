'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Download, Chrome, MousePointer2, Clipboard, Keyboard, CheckCircle2, ArrowRight, Zap } from 'lucide-react'

export function ToolsDownloadPage() {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      // Download ZIP from API route
      const link = document.createElement('a')
      link.href = '/api/download-extension'
      link.download = 'akmez-selector-extension.zip'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('Download failed:', error)
      alert('Download failed. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-violet-950/10 p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <Badge variant="secondary" className="px-4 py-1">
            <Zap className="w-3 h-3 mr-1" />
            Marketing Tools
          </Badge>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Quick Copy Extension
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Speed up your workflow by copying customer data directly from Facebook Business Suite into Akmez
          </p>
        </div>

        {/* Main Card */}
        <Card className="border-2 border-violet-500/20 bg-gradient-to-br from-card to-violet-950/5">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center text-white text-3xl font-bold shadow-xl shadow-orange-500/30 mb-4">
              A
            </div>
            <CardTitle className="text-2xl">Akmez Quick Copy</CardTitle>
            <CardDescription>Chrome Extension v1.0.0</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Features */}
            <div className="grid md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-muted/50 space-y-2">
                <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                  <MousePointer2 className="w-5 h-5 text-violet-500" />
                </div>
                <h3 className="font-semibold">Click to Select</h3>
                <p className="text-sm text-muted-foreground">
                  Click any text on Facebook Business Suite to capture it instantly
                </p>
              </div>
              
              <div className="p-4 rounded-xl bg-muted/50 space-y-2">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <Keyboard className="w-5 h-5 text-emerald-500" />
                </div>
                <h3 className="font-semibold">Quick Assign</h3>
                <p className="text-sm text-muted-foreground">
                  Use Ctrl+1/2/3 to assign to Customer Name, Contact #1, Contact #2
                </p>
              </div>
              
              <div className="p-4 rounded-xl bg-muted/50 space-y-2">
                <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <Clipboard className="w-5 h-5 text-orange-500" />
                </div>
                <h3 className="font-semibold">One-Click Copy</h3>
                <p className="text-sm text-muted-foreground">
                  Copy captured data with one click and paste directly into Akmez
                </p>
              </div>
            </div>

            {/* Download Button */}
            <div className="flex justify-center pt-4">
              <Button 
                size="lg" 
                className="h-14 px-8 text-lg bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500"
                onClick={handleDownload}
                disabled={downloading}
              >
                <Chrome className="w-5 h-5 mr-2" />
                {downloading ? 'Preparing...' : 'Download Extension'}
                <Download className="w-5 h-5 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Installation Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Chrome className="w-5 h-5" />
              Installation Instructions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { step: 1, title: 'Download & Extract', desc: 'Download the extension ZIP file and extract it to a folder on your computer' },
                { step: 2, title: 'Open Chrome Extensions', desc: 'Go to chrome://extensions in your browser' },
                { step: 3, title: 'Enable Developer Mode', desc: 'Toggle "Developer mode" in the top right corner' },
                { step: 4, title: 'Load Extension', desc: 'Click "Load unpacked" and select the extracted folder' },
                { step: 5, title: 'Pin Extension', desc: 'Click the puzzle icon and pin Akmez Quick Copy for easy access' },
              ].map((item, i) => (
                <div key={item.step} className="flex gap-4 items-start">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {item.step}
                  </div>
                  <div className="flex-1 pb-4 border-b border-border/50 last:border-0">
                    <h4 className="font-semibold">{item.title}</h4>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                  {i < 4 && <ArrowRight className="w-4 h-4 text-muted-foreground mt-2 hidden md:block" />}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Usage Guide */}
        <Card className="border-emerald-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              How to Use
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-semibold text-emerald-500">On Facebook Business Suite:</h4>
                <ol className="space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                    <span>Click the Akmez extension icon</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                    <span>Click "Start Selector Mode"</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                    <span>Click on customer name, then press Ctrl+1</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-xs font-bold shrink-0">4</span>
                    <span>Click on phone number, then press Ctrl+2</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-xs font-bold shrink-0">5</span>
                    <span>Press ESC to exit selector mode</span>
                  </li>
                </ol>
              </div>
              
              <div className="space-y-3">
                <h4 className="font-semibold text-violet-500">On Akmez Create Order:</h4>
                <ol className="space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-500 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                    <span>Open the extension popup</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-500 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                    <span>Click "Copy" next to Customer Name</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-500 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                    <span>Click the Paste button in Akmez form</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-500 flex items-center justify-center text-xs font-bold shrink-0">4</span>
                    <span>Repeat for Contact #1 and Contact #2</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-500 flex items-center justify-center text-xs font-bold shrink-0">5</span>
                    <span>Select region, products, and submit!</span>
                  </li>
                </ol>
              </div>
            </div>
            
            <div className="mt-6 p-4 rounded-lg bg-orange-500/10 border border-orange-500/20">
              <p className="text-sm">
                <strong className="text-orange-500">Keyboard Shortcuts:</strong><br/>
                <code className="bg-background px-2 py-0.5 rounded">Ctrl+1</code> = Assign to Customer Name<br/>
                <code className="bg-background px-2 py-0.5 rounded">Ctrl+2</code> = Assign to Contact #1<br/>
                <code className="bg-background px-2 py-0.5 rounded">Ctrl+3</code> = Assign to Contact #2<br/>
                <code className="bg-background px-2 py-0.5 rounded">ESC</code> = Exit selector mode
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
