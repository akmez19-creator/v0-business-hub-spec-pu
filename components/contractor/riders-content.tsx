'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { createRiderAsContractor, createCredentialsForRider, toggleRiderActive, updateRiderJuicePolicy } from '@/lib/delivery-actions'
import { updateRiderNicData } from '@/lib/admin-actions'
import { setRiderRate, recordRiderPayout } from '@/lib/payment-actions'
import { NicScanner, type NicData } from '@/components/nic-scanner'
import { 
  Users, 
  Phone,
  Star,
  Package,
  CheckCircle,
  XCircle,
  Clock,
  User,
  TrendingUp,
  Plus,
  Loader2,
  Mail,
  Lock,
  ChevronDown,
  ChevronUp,
  LinkIcon,
  Coins,
  Banknote,
  Wallet,
  IdCard,
  Power,
  Zap,
} from 'lucide-react'

interface RiderStats {
  id: string
  name: string
  phone?: string
  profile_id?: string | null
  photo_url?: string | null
  nic_number?: string | null
  is_active: boolean
  total: number
  delivered: number
  failed: number
  pending: number
  rate: number
  rating: number
  paymentType: string
  dailyRate: number
  perDeliveryRate: number
  walletBalance: number
  lifetimeEarnings: number
  totalPaidOut: number
  lifetimeUniqueDelivered: number
  thisMonthEarnings: number
  thisMonthDelivered: number
  lastMonthEarnings: number
  lastMonthDelivered: number
  recentPayouts: { amount: number; created_at: string; description: string }[]
  isContractor: boolean
  juicePolicy: 'rider' | 'contractor'
}

interface RidersContentProps {
  riders: RiderStats[]
  contractorAsRider: any
  totalDeliveries: number
}

export function ContractorRidersContent({ riders, contractorAsRider, totalDeliveries }: RidersContentProps) {
  // Summary stats
  const totalRiders = riders.length
  const activeRiders = riders.filter(r => r.is_active).length
  const avgDeliveryRate = totalRiders > 0 
    ? Math.round(riders.reduce((sum, r) => sum + r.rate, 0) / totalRiders)
    : 0

  // Separate contractor (if acts as rider) from team
  const teamRiders = riders.filter(r => !r.isContractor)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">My Team</h1>
          <p className="text-sm text-muted-foreground">Rider performance overview</p>
        </div>
        <AddRiderButton />
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2">
        <div className="glass-card rounded-xl p-3 text-center">
          <Users className="w-5 h-5 mx-auto mb-1 text-primary" />
          <p className="text-lg font-bold text-foreground">{totalRiders}</p>
          <p className="text-[10px] text-muted-foreground">Riders</p>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <TrendingUp className="w-5 h-5 mx-auto mb-1 text-success" />
          <p className="text-lg font-bold text-foreground">{activeRiders}</p>
          <p className="text-[10px] text-muted-foreground">Active</p>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <Package className="w-5 h-5 mx-auto mb-1 text-accent" />
          <p className="text-lg font-bold text-foreground">{totalDeliveries}</p>
          <p className="text-[10px] text-muted-foreground">Deliveries</p>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <Star className="w-5 h-5 mx-auto mb-1 text-warning" />
          <p className="text-lg font-bold text-foreground">{avgDeliveryRate}%</p>
          <p className="text-[10px] text-muted-foreground">Avg Rate</p>
        </div>
      </div>

      {/* Contractor as Rider Card (if applicable) */}
      {contractorAsRider && (
        <div className="glass-card rounded-xl p-4 border-2 border-primary/30">
          <div className="flex items-center gap-2 mb-3">
            <User className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">You (as Rider)</span>
          </div>
          {riders.filter(r => r.isContractor).map(rider => (
            <RiderCard key={rider.id} rider={rider} isHighlighted />
          ))}
        </div>
      )}

      {/* Team Riders */}
      <div>
        <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-accent" />
          Team Members ({teamRiders.length})
        </h2>
        
        {teamRiders.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="font-medium text-foreground">No team members yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-3">
              Add riders to your team to start assigning deliveries
            </p>
            <AddRiderButton />
          </div>
        ) : (
          <div className="space-y-3">
            {teamRiders.map(rider => (
              <RiderCard key={rider.id} rider={rider} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AddRiderButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showCredentials, setShowCredentials] = useState(false)
  const [showNicScanner, setShowNicScanner] = useState(false)
  const [nicData, setNicData] = useState<NicData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function resetForm() {
    setName(''); setPhone(''); setEmail(''); setPassword('')
    setShowCredentials(false); setShowNicScanner(false); setNicData(null); setError(null)
  }

  function handleNicScan(data: NicData) {
    setNicData(data)
    // Don't auto-fill name -- keep the nickname the user types
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (showCredentials && email && !password) { setError('Password is required when email is provided'); return }
    if (showCredentials && password && password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true)
    setError(null)
    const result = await createRiderAsContractor(
      name.trim(),
      phone.trim() || undefined,
      showCredentials && email ? email.trim() : undefined,
      showCredentials && password ? password : undefined,
    )
    if (result.error) { setError(result.error); setLoading(false); return }

    // Save NIC data if scanned
    if (nicData && result.riderId) {
      await updateRiderNicData(result.riderId, {
        surname: nicData.surname,
        first_name: nicData.firstName,
        surname_at_birth: nicData.surnameAtBirth || undefined,
        nic_number: nicData.idNumber,
        gender: nicData.gender,
        date_of_birth: nicData.dateOfBirth || undefined,
        photo_url: nicData.photoUrl,
        nic_photo_url: nicData.nicPhotoUrl,
      })
    }

    setLoading(false)
    resetForm(); setOpen(false); router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1" />
          Add Rider
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Rider to Team</DialogTitle>
          <DialogDescription>
            Scan NIC card to auto-fill or enter details manually.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* NIC Scanner Toggle */}
            <button
              type="button"
              onClick={() => setShowNicScanner(!showNicScanner)}
              className="w-full flex items-center justify-between p-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <IdCard className="w-5 h-5 text-primary" />
                <div className="text-left">
                  <span className="text-sm font-semibold text-primary block">Scan NIC Card</span>
                  <span className="text-[10px] text-muted-foreground">Auto-fill from National ID</span>
                </div>
              </div>
              {showNicScanner ? <ChevronUp className="w-4 h-4 text-primary" /> : <ChevronDown className="w-4 h-4 text-primary" />}
            </button>

            {showNicScanner && (
              <div className="border border-border/40 rounded-xl p-3 bg-muted/10">
                <NicScanner onScanComplete={handleNicScan} existingData={nicData ? {
                  surname: nicData.surname,
                  firstName: nicData.firstName,
                  surnameAtBirth: nicData.surnameAtBirth,
                  gender: nicData.gender,
                  dateOfBirth: nicData.dateOfBirth,
                  idNumber: nicData.idNumber,
                  photoUrl: nicData.photoUrl,
                  nicPhotoUrl: nicData.nicPhotoUrl,
                } : undefined} />
              </div>
            )}

            {nicData && !showNicScanner && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                  <IdCard className="w-4 h-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-[10px] text-emerald-500">NIC verified</p>
                  <p className="text-xs font-semibold text-emerald-600">{nicData.firstName} {nicData.surname}</p>
                  <p className="text-[9px] text-emerald-500 font-mono">{nicData.idNumber}</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="rider-name">Rider Nickname *</Label>
              <Input id="rider-name" placeholder="e.g., Tino" value={name} onChange={(e) => setName(e.target.value)} disabled={loading} />
              <p className="text-[10px] text-muted-foreground">This is the display name used in the app. Real name is stored from NIC.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rider-phone">Phone Number</Label>
              <Input id="rider-phone" placeholder="+230 5XXX XXXX" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={loading} />
            </div>

            {/* Login credentials toggle */}
            <button
              type="button"
              onClick={() => setShowCredentials(!showCredentials)}
              className="w-full flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Create Login Credentials</span>
              </div>
              {showCredentials ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {showCredentials && (
              <div className="space-y-3 pl-2 border-l-2 border-primary/20">
                <p className="text-[11px] text-muted-foreground">
                  The rider will be able to log in and manage their deliveries.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="rider-email">Email *</Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input id="rider-email" type="email" placeholder="rider@email.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={loading} className="pl-9" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rider-password">Password *</Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input id="rider-password" type="password" placeholder="Min 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} disabled={loading} className="pl-9" />
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setOpen(false); resetForm() }} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {showCredentials && email ? 'Create with Login' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RiderCard({ rider, isHighlighted = false }: { rider: RiderStats; isHighlighted?: boolean }) {
  const [toggling, setToggling] = useState(false)

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setToggling(true)
    await toggleRiderActive(rider.id, !rider.is_active)
    setToggling(false)
  }

  return (
    <div className={cn(
      "glass-card rounded-xl p-4",
      !rider.is_active && "opacity-60",
      isHighlighted && "bg-primary/5"
    )}>
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className={cn(
          "relative flex items-center justify-center w-12 h-12 rounded-full font-bold text-lg flex-shrink-0",
          rider.is_active 
            ? "bg-gradient-to-br from-primary to-accent text-primary-foreground"
            : "bg-muted text-muted-foreground"
        )}>
          {rider.photo_url ? (
            <img src={rider.photo_url} alt={rider.name} className="w-full h-full rounded-full object-cover" />
          ) : (
            rider.name?.charAt(0).toUpperCase() || 'R'
          )}
          {rider.nic_number && (
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
              <CheckCircle className="w-2.5 h-2.5 text-white" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <h3 className="font-semibold truncate">{rider.name}</h3>
              {rider.profile_id ? (
                <Badge className="bg-primary/10 text-primary text-[9px] gap-0.5">
                  <LinkIcon className="w-2.5 h-2.5" /> Linked
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground text-[9px] gap-0.5 border-dashed">
                  No Login
                </Badge>
              )}
            </div>
            {/* Active toggle */}
            {!rider.isContractor && (
              <button
                onClick={handleToggle}
                disabled={toggling}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors shrink-0 ml-2",
                  rider.is_active ? "bg-success" : "bg-muted-foreground/30"
                )}
                title={rider.is_active ? 'Tap to deactivate' : 'Tap to activate'}
              >
                <div className={cn(
                  "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
                  rider.is_active ? "translate-x-[22px]" : "translate-x-[2px]"
                )} />
              </button>
            )}
          </div>
          
          {/* Wallet + Phone row */}
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-1 text-xs">
              <Wallet className="w-3 h-3 text-primary" />
              <span className={cn("font-semibold", rider.walletBalance >= 0 ? "text-foreground" : "text-destructive")}>
                Rs {Math.abs(rider.walletBalance).toLocaleString()}
              </span>
              {rider.walletBalance < 0 && <span className="text-[9px] text-destructive">owed</span>}
            </div>
            {rider.phone && (
              <a 
                href={`tel:${rider.phone}`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
              >
                <Phone className="w-3 h-3" />
                {rider.phone}
              </a>
            )}
          </div>

          {/* Performance */}
          <div className="mt-3">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Delivery Rate</span>
              <span>{rider.rate}%</span>
            </div>
            <Progress value={rider.rate} className="h-2" />
          </div>

          {/* Rating */}
          <div className="flex items-center gap-1 mt-2">
            {[1, 2, 3, 4, 5].map(star => (
              <Star
                key={star}
                className={cn(
                  "w-3 h-3",
                  star <= rider.rating 
                    ? "text-warning fill-warning" 
                    : "text-muted"
                )}
              />
            ))}
            <span className="text-xs text-muted-foreground ml-1">
              ({rider.total} deliveries)
            </span>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-border/50">
        <div className="text-center">
          <p className="text-sm font-bold text-foreground">{rider.total}</p>
          <p className="text-[10px] text-muted-foreground">Total</p>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-success">{rider.delivered}</p>
          <div className="flex items-center justify-center gap-0.5 text-[10px] text-muted-foreground">
            <CheckCircle className="w-2.5 h-2.5" /> Done
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-warning">{rider.pending}</p>
          <div className="flex items-center justify-center gap-0.5 text-[10px] text-muted-foreground">
            <Clock className="w-2.5 h-2.5" /> Pending
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-destructive">{rider.failed}</p>
          <div className="flex items-center justify-center gap-0.5 text-[10px] text-muted-foreground">
            <XCircle className="w-2.5 h-2.5" /> Failed
          </div>
        </div>
      </div>

      {/* Juice Policy - always visible */}
      <div className="mt-3 pt-3 border-t border-border/50">
        <JuicePolicyRow rider={rider} />
      </div>

      {/* Payment & Rate Section */}
      <RiderPaymentSection rider={rider} />

      {/* Create Login for unlinked riders */}
      {!rider.profile_id && <CreateLoginSection riderId={rider.id} riderName={rider.name} />}
    </div>
  )
}

function JuicePolicyRow({ rider }: { rider: RiderStats }) {
  const [policy, setPolicy] = useState<'rider' | 'contractor'>(rider.juicePolicy || 'rider')
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function toggle() {
    const next = policy === 'rider' ? 'contractor' : 'rider'
    setSaving(true)
    const result = await updateRiderJuicePolicy(rider.id, next)
    setSaving(false)
    if (!result.error) {
      setPolicy(next)
      router.refresh()
    }
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Zap className="w-3.5 h-3.5 text-yellow-500" />
        <span className="text-[11px] font-medium text-foreground">Juice</span>
        <span className="text-[10px] text-muted-foreground">
          {policy === 'rider' ? 'to rider account' : 'to your account'}
        </span>
      </div>
      <button
        onClick={toggle}
        disabled={saving}
        className={cn(
          'relative w-11 h-6 rounded-full transition-colors shrink-0',
          policy === 'contractor' ? 'bg-primary' : 'bg-muted-foreground/30'
        )}
      >
        {saving ? (
          <Loader2 className="w-3 h-3 animate-spin absolute top-1.5 left-4 text-white" />
        ) : (
          <div className={cn(
            'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform',
            policy === 'contractor' ? 'translate-x-[22px]' : 'translate-x-[3px]'
          )} />
        )}
      </button>
    </div>
  )
}

function RiderPaymentSection({ rider }: { rider: RiderStats }) {
  const [expanded, setExpanded] = useState(false)
  const [rate, setRate] = useState(String(rider.perDeliveryRate || ''))
  const [payAmount, setPayAmount] = useState('')
  const [payDesc, setPayDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [rateSaved, setRateSaved] = useState(false)
  const [paySaved, setPaySaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSaveRate() {
    const rateNum = Number(rate)
    if (!rateNum || rateNum <= 0) { setError('Enter a valid rate'); return }
    setLoading(true); setError(null)
    const result = await setRiderRate(rider.id, rateNum)
    setLoading(false)
    if (result.error) { setError(result.error) }
    else { setRateSaved(true); setTimeout(() => { setRateSaved(false); router.refresh() }, 1000) }
  }

  async function handlePay() {
    const amount = Number(payAmount)
    if (!amount || amount <= 0) { setError('Enter a valid amount'); return }
    setLoading(true); setError(null)
    const result = await recordRiderPayout(rider.id, amount, payDesc || undefined)
    setLoading(false)
    if (result.error) { setError(result.error) }
    else { setPaySaved(true); setPayAmount(''); setPayDesc(''); setTimeout(() => { setPaySaved(false); router.refresh() }, 1000) }
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      {/* Summary row */}
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <Coins className="w-3 h-3 text-primary" />
            <span className="text-[11px] font-medium">Rs {rider.perDeliveryRate}/del</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">Last: <span className="font-medium text-foreground">Rs {(rider.lastMonthEarnings || 0).toLocaleString()}</span></span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">This: <span className="font-medium text-primary">Rs {(rider.thisMonthEarnings || 0).toLocaleString()}</span></span>
          </div>
          <span className={cn(
            'text-[11px] font-medium',
            rider.walletBalance > 0 ? 'text-amber-500' : 'text-emerald-500'
          )}>
            Owed: Rs {Math.max(0, rider.walletBalance || 0).toLocaleString()}
          </span>
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-2.5">
          {/* Rate edit */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground mb-0.5 block">Rate/Delivery (Rs)</label>
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-full h-8 px-2.5 rounded-lg border border-border bg-background text-xs focus:border-primary/50 focus:outline-none"
              />
            </div>
            <button
              onClick={handleSaveRate}
              disabled={loading}
              className={cn(
                'h-8 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-all',
                rateSaved ? 'bg-emerald-500/20 text-emerald-500' : 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {rateSaved ? 'Saved' : 'Set'}
            </button>
          </div>

          {/* Pay rider */}
          <div className="p-2.5 rounded-xl bg-muted/20 border border-border/30 space-y-2">
            <p className="text-[10px] text-muted-foreground font-medium">Pay {rider.name}</p>
            <div className="flex items-end gap-1.5">
              <input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="Amount"
                className="flex-1 h-8 px-2.5 rounded-lg border border-border bg-background text-xs focus:border-primary/50 focus:outline-none"
              />
              <input
                type="text"
                value={payDesc}
                onChange={(e) => setPayDesc(e.target.value)}
                placeholder="Note"
                className="flex-1 h-8 px-2.5 rounded-lg border border-border bg-background text-xs focus:border-primary/50 focus:outline-none"
              />
              <button
                onClick={handlePay}
                disabled={loading || !payAmount}
                className={cn(
                  'h-8 px-3 rounded-lg text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap transition-all',
                  paySaved ? 'bg-emerald-500/20 text-emerald-500' : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40'
                )}
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Banknote className="w-3 h-3" />}
                {paySaved ? 'Paid' : 'Pay'}
              </button>
            </div>
          </div>

          {error && <p className="text-[11px] text-destructive">{error}</p>}

          {/* Recent payouts */}
          {(rider.recentPayouts || []).length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium">Recent Payouts</p>
              {rider.recentPayouts.slice(0, 3).map((p, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-muted/10">
                  <span className="text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {p.description ? ` - ${p.description}` : ''}
                  </span>
                  <span className="font-medium">Rs {Number(p.amount).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CreateLoginSection({ riderId, riderName }: { riderId: string; riderName: string }) {
  const [expanded, setExpanded] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) { setError('Email is required'); return }
    if (!password || password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true)
    setError(null)
    const result = await createCredentialsForRider(riderId, email.trim(), password)
    setLoading(false)
    if (result.error) { setError(result.error) }
    else { setSuccess(true); setTimeout(() => router.refresh(), 1000) }
  }

  if (success) {
    return (
      <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-2 px-1">
        <CheckCircle className="w-4 h-4 text-emerald-500" />
        <p className="text-xs text-emerald-600 font-medium">Login created for {riderName}</p>
      </div>
    )
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 text-primary text-xs font-medium hover:bg-primary/10 transition-colors"
        >
          <Lock className="w-3 h-3" />
          Create Login
        </button>
      ) : (
        <form onSubmit={handleCreate} className="space-y-2">
          <div className="relative">
            <Mail className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              className="w-full h-8 pl-8 pr-3 rounded-lg border border-border bg-background text-xs focus:border-primary/50 focus:outline-none disabled:opacity-50"
            />
          </div>
          <div className="relative">
            <Lock className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="password"
              placeholder="Password (min 6 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="w-full h-8 pl-8 pr-3 rounded-lg border border-border bg-background text-xs focus:border-primary/50 focus:outline-none disabled:opacity-50"
            />
          </div>
          {error && <p className="text-[11px] text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <LinkIcon className="w-3 h-3" />}
              {loading ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setExpanded(false); setEmail(''); setPassword(''); setError(null) }}
              disabled={loading}
              className="h-8 px-3 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
