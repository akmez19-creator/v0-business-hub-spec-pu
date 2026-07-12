'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Image from 'next/image'
import { 
  Download, 
  Chrome, 
  MousePointer2, 
  Clipboard, 
  Keyboard, 
  CheckCircle2, 
  Zap, 
  RefreshCw,
  Sparkles,
  ArrowRight,
  Settings,
  Search,
  Lock,
  User,
  Clock,
  Shield,
  LogIn,
  Package
} from 'lucide-react'

// Current extension version - update this when making changes
const EXTENSION_VERSION = '4.36.0'
const LAST_UPDATED = '2026-07-12'

export function ToolsDownloadPage() {
  const [downloading, setDownloading] = useState(false)
  const [activeStep, setActiveStep] = useState<number | null>(null)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const link = document.createElement('a')
      // Add timestamp to bust cache
      link.href = '/api/download-extension?v=' + Date.now()
      link.download = `akmez-quick-order-v${EXTENSION_VERSION}.zip`
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

  const features = [
    {
      icon: MousePointer2,
      title: 'Click to Select',
      description: 'Click any text on Facebook Business Suite to capture it instantly',
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
      borderColor: 'border-cyan-500/20'
    },
    {
      icon: Keyboard,
      title: 'Quick Assign',
      description: 'Use Ctrl+1/2/3 to assign to Customer Name, Contact #1, Contact #2',
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
      borderColor: 'border-emerald-500/20'
    },
    {
      icon: Clipboard,
      title: 'One-Click Copy',
      description: 'Copy captured data with one click and paste directly into Akmez',
      color: 'text-orange-400',
      bgColor: 'bg-orange-500/10',
      borderColor: 'border-orange-500/20'
    }
  ]

  const newFeatures = [
    { icon: Clock, text: 'Clock in and out with a single tap - the PIN has been removed since you are already signed in with your email and password' },
    { icon: Search, text: 'New "My Stats" tab: search the last 30 days of clients by name or phone, and see your live daily figures - total clients handled today, working time (first entry to last entry), and average clients per working hour' },
    { icon: Package, text: 'B1G1 pricing fixed: the free unit is bonus stock, not a price discount, so clients pay full unit price for every unit ordered (e.g. 3x Hanging Rope at Rs 475 = Rs 1,425). Bundle "N for Rs X" pricing still applies' },
    { icon: Package, text: 'Multi-product orders now create a separate delivery entry for each product, so a 2-product order becomes 2 rows (each with its own quantity, amount and reply link) for cleaner picking and tracking' },
    { icon: Shield, text: 'Exchange & Trade In now require a real past customer: enter the phone and the widget verifies a delivered order exists, auto-fills the most recent product bought, and blocks the order if the client has no delivery history' },
    { icon: Package, text: 'Orders now save clean product names (e.g. "3 IN 1 Dustpan") without the "x1" suffix; quantity is only shown when more than one unit is ordered' },
    { icon: Package, text: 'Exchange & Trade In now capture the returned item: pick the product the client currently has, and the widget records it in notes. Exchange (defective) charges nothing; Trade In charges only the price difference for an equivalent product (nil if the price matches)' },
    { icon: Shield, text: 'Bad clients now show a severity level (Low / Moderate / High risk / Critical) based on how many failed CMS orders they have, so you can spot repeat offenders at a glance' },
    { icon: Package, text: 'Sales Type pills in the order form: log each order as Sale, Exchange, Trade In, Refund or Drop Off with one tap, and it flows through to All Deliveries' },
    { icon: Shield, text: 'Instant client rating: as soon as a phone number lands in Contact 1, a badge shows GOOD / AVERAGE / BAD / NEW client with their order count, delivered % and total sales from past history' },
    { icon: MousePointer2, text: 'Quick-fill toolbar now appears on double-click as well as text selection, streamlined to just C1 and C2 for faster contact entry' },
    { icon: Package, text: 'Product photos now enlarge on hover as well, so agents can preview an item just by moving the mouse over its thumbnail' },
    { icon: Package, text: 'Widget pricing now matches inventory exactly, auto-applying bundle offers (e.g. 2 for Rs775) and Buy-One-Get-One-Free, with savings shown in the cart' },
    { icon: Sparkles, text: 'Orders now record the source page code (e.g. MBM) in the MEDIUM column instead of "Extension", matching the import sheet' },
    { icon: Sparkles, text: 'Rock-solid page detection: link a page to its Facebook ID once (Settings, link button) and its code + logo show instantly on every conversation for that page' },
    { icon: Sparkles, text: 'Page detection also reads the full conversation text (e.g. "reply to Destockage By Moris") across Business Suite, Messenger and Instagram inboxes' },
    { icon: Sparkles, text: 'Page badges can now carry a logo: admins upload a picture per page and it shows next to the code (e.g. MBM) in the widget header' },
    { icon: Search, text: 'Picking a region now shows which contractor and rider handle its delivery (assigned by admin in the Regions module)' },
    { icon: Shield, text: 'Admins can define page codes (e.g. Made By Moris = MBM); a badge in the widget shows which page each message comes from' },
    { icon: RefreshCw, text: 'Switching to a new customer now clears the product cart so items never carry over from the previous client' },
    { icon: Package, text: 'Captured Ad ID now auto-adds its linked product to the order (ad to campaign to product)' },
    { icon: Shield, text: 'Admins configure auto-fill selectors and cut-off once; all agents inherit them automatically' },
    { icon: Lock, text: 'Non-admin agents see settings as read-only (managed by admin)' },
    { icon: Search, text: 'Products are now type-to-search with keyboard navigation (no more scrolling a big list)' },
    { icon: MousePointer2, text: 'Selected products show as a clean list with quantity +/- controls' },
    { icon: Search, text: 'Region field is type-to-search with instant suggestions' }
  ]

  const installSteps = [
    { title: 'Download & Extract', desc: 'Download the ZIP file and extract it to a folder' },
    { title: 'Open Extensions', desc: 'Go to chrome://extensions in your browser' },
    { title: 'Developer Mode', desc: 'Toggle "Developer mode" in the top right' },
    { title: 'Load Extension', desc: 'Click "Load unpacked" and select the folder' },
    { title: 'Pin & Enjoy', desc: 'Pin Akmez Quick Order for easy access' }
  ]

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        
        {/* Hero Section */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-card via-card to-orange-950/20 border border-border/50 p-8 md:p-12 mb-8">
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
          
          <div className="relative flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
            {/* Left side - Text content */}
            <div className="flex-1 text-center lg:text-left space-y-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/20">
                <Zap className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-medium text-orange-400">Marketing Tools</span>
              </div>
              
              <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight text-balance">
                Quick Order
                <span className="block text-orange-400">Extension</span>
              </h1>
              
              <p className="text-lg text-muted-foreground max-w-lg">
                Speed up your workflow by copying customer data directly from Facebook Business Suite into Akmez orders.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
                <Button 
                  size="lg" 
                  className="h-14 px-8 text-lg bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/25 transition-all hover:shadow-orange-500/40 hover:scale-[1.02] active:scale-[0.98]"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  <Chrome className="w-5 h-5 mr-2" />
                  {downloading ? 'Preparing...' : 'Download Extension'}
                  <Download className="w-5 h-5 ml-2" />
                </Button>
                
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="border-orange-500/30 text-orange-400">
                    v{EXTENSION_VERSION}
                  </Badge>
                  <span>Updated {LAST_UPDATED}</span>
                </div>
              </div>
            </div>
            
            {/* Right side - Extension Preview Mockup */}
            <div className="relative">
              <div className="relative rounded-2xl overflow-hidden border border-border/50 shadow-2xl transform rotate-2 hover:rotate-0 transition-transform duration-500 bg-card p-4" style={{ width: 320 }}>
                {/* Extension Header */}
                <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-orange-500/20 to-orange-500/5 rounded-xl border border-orange-500/20 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center text-white font-bold text-lg">A</div>
                  <div className="flex-1">
                    <div className="font-semibold text-foreground text-sm">Quick Order v4.0</div>
                    <div className="text-xs text-muted-foreground">Create orders from anywhere</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-6 h-6 rounded bg-muted/50 flex items-center justify-center">
                      <Settings className="w-3 h-3 text-muted-foreground" />
                    </div>
                    <div className="w-6 h-6 rounded bg-muted/50 flex items-center justify-center">
                      <span className="text-muted-foreground text-xs">×</span>
                    </div>
                  </div>
                </div>
                
                {/* Connected Status */}
                <div className="flex items-center gap-2 mb-4 px-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs text-emerald-400 font-medium">Connected</span>
                </div>
                
                {/* Form Fields Preview */}
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">NAME *</div>
                    <div className="h-9 rounded-lg bg-muted/30 border border-border/50 flex items-center px-3">
                      <span className="text-sm text-muted-foreground">Customer name</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">CONTACT 1 *</div>
                      <div className="h-9 rounded-lg bg-muted/30 border border-border/50 flex items-center px-3">
                        <span className="text-sm text-muted-foreground">Phone</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">CONTACT 2</div>
                      <div className="h-9 rounded-lg bg-muted/30 border border-border/50 flex items-center px-3">
                        <span className="text-sm text-muted-foreground">Optional</span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Product Search */}
                  <div>
                    <div className="text-xs text-orange-400 mb-1 font-medium">ADD PRODUCTS</div>
                    <div className="h-10 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center px-3">
                      <Search className="w-4 h-4 text-orange-400 mr-2" />
                      <span className="text-sm text-orange-400/70">Search products...</span>
                    </div>
                  </div>
                  
                  {/* Product chips preview */}
                  <div className="flex flex-wrap gap-1">
                    <div className="px-2 py-1 text-xs bg-muted/50 rounded border border-border/50 text-muted-foreground">Vacuum Cup</div>
                    <div className="px-2 py-1 text-xs bg-muted/50 rounded border border-border/50 text-muted-foreground">Gel Stamp</div>
                    <div className="px-2 py-1 text-xs bg-muted/50 rounded border border-border/50 text-muted-foreground">+more</div>
                  </div>
                  
                  {/* Create Order Button */}
                  <div className="h-11 rounded-lg bg-orange-500 flex items-center justify-center text-white font-medium text-sm mt-2">
                    CREATE ORDER
                  </div>
                </div>
              </div>
              
              {/* Floating badges */}
              <div className="absolute -top-4 -right-4 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-medium animate-pulse">
                Free
              </div>
              <div className="absolute -bottom-3 -left-3 px-3 py-1.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-medium">
                v4.0 Preview
              </div>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          {features.map((feature, index) => (
            <Card 
              key={index} 
              className={`group border ${feature.borderColor} bg-card/50 hover:bg-card transition-all duration-300 hover:scale-[1.02] hover:shadow-lg`}
            >
              <CardContent className="p-6">
                <div className={`w-12 h-12 rounded-xl ${feature.bgColor} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <feature.icon className={`w-6 h-6 ${feature.color}`} />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Agent Login / Working Time Section */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Agent Login Card */}
          <Card className="border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-transparent overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                  <LogIn className="w-6 h-6 text-cyan-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-lg">Agent Login</h3>
                  <p className="text-sm text-muted-foreground">Sign in to start working</p>
                </div>
              </div>
              
              {/* Mock Login Form */}
              <div className="space-y-4 p-4 rounded-xl bg-card border border-border/50">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm text-muted-foreground">Email or Username</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                      id="email"
                      placeholder="agent@akmez.com"
                      className="pl-10 bg-muted/50 border-border/50"
                      disabled
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-sm text-muted-foreground">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      className="pl-10 bg-muted/50 border-border/50"
                      disabled
                    />
                  </div>
                </div>
                <Button className="w-full bg-cyan-500 hover:bg-cyan-600 text-white" disabled>
                  <LogIn className="w-4 h-4 mr-2" />
                  Sign In to Extension
                </Button>
              </div>
              
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Agents must be logged in to use the Quick Order extension
              </p>
            </CardContent>
          </Card>
          
          {/* PIN / Working Time Card */}
          <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-transparent overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <Clock className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-lg">Working Time</h3>
                  <p className="text-sm text-muted-foreground">Starts automatically on login</p>
                </div>
              </div>
              
              {/* Mock PIN Interface */}
              <div className="space-y-4 p-4 rounded-xl bg-card border border-border/50">
                <div className="flex items-center justify-center gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm font-medium text-emerald-400">Agent Connected</span>
                </div>
                
                <div className="text-center mb-4">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/50">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm text-muted-foreground">Enter PIN to Clock In/Out</span>
                  </div>
                </div>
                
                {/* PIN Input Display */}
                <div className="flex justify-center gap-3 mb-4">
                  {[1, 2, 3, 4].map((_, i) => (
                    <div 
                      key={i}
                      className="w-12 h-14 rounded-lg bg-muted/50 border border-border/50 flex items-center justify-center text-2xl font-bold text-foreground"
                    >
                      {i < 2 ? '•' : ''}
                    </div>
                  ))}
                </div>
                
                {/* Time Display */}
                <div className="text-center p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-xs text-emerald-400 mb-1">Current Session</div>
                  <div className="text-2xl font-mono font-bold text-foreground">02:45:30</div>
                </div>
              </div>
              
              <p className="text-xs text-muted-foreground mt-3 text-center">
                Clock-in starts on login. Auto clock-out after 5 minutes of inactivity.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* What's New Section */}
        <Card className="mb-8 border-orange-500/20 bg-gradient-to-r from-orange-500/5 to-transparent">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">{"What's New in v"}{EXTENSION_VERSION}</h3>
                <p className="text-sm text-muted-foreground">Latest improvements and features</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {newFeatures.map((item, index) => (
                <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                  <item.icon className="w-4 h-4 text-orange-400 shrink-0" />
                  <span className="text-sm text-muted-foreground">{item.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Installation Steps */}
        <Card className="mb-8">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                <Chrome className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Installation Guide</h3>
                <p className="text-sm text-muted-foreground">Get started in 5 easy steps</p>
              </div>
            </div>
            
            <div className="grid gap-3">
              {installSteps.map((step, index) => (
                <div 
                  key={index}
                  className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-300 cursor-pointer ${
                    activeStep === index 
                      ? 'bg-cyan-500/10 border-cyan-500/30' 
                      : 'bg-muted/30 border-border/50 hover:border-border'
                  }`}
                  onMouseEnter={() => setActiveStep(index)}
                  onMouseLeave={() => setActiveStep(null)}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 transition-colors ${
                    activeStep === index 
                      ? 'bg-cyan-500 text-white' 
                      : 'bg-muted border border-border text-muted-foreground'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground">{step.title}</h4>
                    <p className="text-sm text-muted-foreground">{step.desc}</p>
                  </div>
                  <ArrowRight className={`w-5 h-5 transition-all ${
                    activeStep === index 
                      ? 'text-cyan-400 translate-x-1' 
                      : 'text-muted-foreground/50'
                  }`} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Usage Guide */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {/* Facebook Side */}
          <Card className="border-cyan-500/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                  <MousePointer2 className="w-5 h-5 text-cyan-400" />
                </div>
                <h3 className="font-semibold text-foreground">On Facebook Business Suite</h3>
              </div>
              <div className="space-y-3">
                {[
                  'Click the Akmez extension icon',
                  'Click "Start Selector Mode"',
                  'Click on customer name, press Ctrl+1',
                  'Click on phone number, press Ctrl+2',
                  'Press ESC to exit selector mode'
                ].map((text, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-cyan-400">{i + 1}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{text}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Akmez Side */}
          <Card className="border-orange-500/20">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
                  <Clipboard className="w-5 h-5 text-orange-400" />
                </div>
                <h3 className="font-semibold text-foreground">On Akmez Create Order</h3>
              </div>
              <div className="space-y-3">
                {[
                  'Open the extension popup',
                  'Click "Copy" next to Customer Name',
                  'Click the Paste button in Akmez form',
                  'Repeat for Contact #1 and Contact #2',
                  'Select region, products, and submit!'
                ].map((text, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-orange-400">{i + 1}</span>
                    </div>
                    <span className="text-sm text-muted-foreground">{text}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Keyboard Shortcuts */}
        <Card className="border-emerald-500/20 bg-gradient-to-r from-emerald-500/5 to-transparent">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <Keyboard className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Keyboard Shortcuts</h3>
                <p className="text-sm text-muted-foreground">Quick commands for faster workflow</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { key: 'Ctrl+1', action: 'Customer Name' },
                { key: 'Ctrl+2', action: 'Contact #1' },
                { key: 'Ctrl+3', action: 'Contact #2' },
                { key: 'ESC', action: 'Exit Selector' }
              ].map((shortcut, index) => (
                <div key={index} className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50">
                  <kbd className="px-3 py-1.5 rounded-lg bg-muted border border-border text-sm font-mono text-foreground">
                    {shortcut.key}
                  </kbd>
                  <span className="text-sm text-muted-foreground">{shortcut.action}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Footer CTA */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Works with Chrome, Edge, and other Chromium browsers</span>
          </div>
        </div>
      </div>
    </div>
  )
}
