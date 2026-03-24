'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { updateContractorNicData, saveContractorAvatar } from '@/lib/admin-actions'
import { NicScanner, type NicData } from '@/components/nic-scanner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  User,
  Mail,
  Phone,
  Shield,
  CheckCircle,
  Clock,
  Save,
  Loader2,
  IdCard,
  ShieldCheck,
  ChevronRight,
  ArrowLeft,
  Sparkles,
  Camera,
  Check,
  X,
  RefreshCw,
  Palette,
  MapPin,
  Crosshair,
} from 'lucide-react'

interface ContractorSettingsContentProps {
  profile: {
    id: string
    email: string
    name: string | null
    phone: string | null
    role: string
    approved: boolean
  }
  contractor: {
    id: string
    name: string
    nic_number?: string | null
    first_name?: string | null
    surname?: string | null
    gender?: string | null
    date_of_birth?: string | null
    nic_photo_url?: string | null
    photo_url?: string | null
    [key: string]: any
  }
}

export function ContractorSettingsContent({ profile, contractor }: ContractorSettingsContentProps) {
  const [name, setName] = useState(contractor.name || profile.name || '')
  const [phone, setPhone] = useState(profile.phone || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showNicScanner, setShowNicScanner] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [nicJustSaved, setNicJustSaved] = useState(false)
  const [generatingAvatar, setGeneratingAvatar] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(contractor.photo_url || null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [avatarStyle, setAvatarStyle] = useState('professional')
  const [showStylePicker, setShowStylePicker] = useState(false)
  const [warehouseName, setWarehouseName] = useState(contractor.warehouse_name || 'Warehouse')
  const [warehouseLat, setWarehouseLat] = useState<number | null>(contractor.warehouse_lat || null)
  const [warehouseLng, setWarehouseLng] = useState<number | null>(contractor.warehouse_lng || null)
  const [savingWarehouse, setSavingWarehouse] = useState(false)
  const [capturingGps, setCapturingGps] = useState(false)
  const [warehouseMsg, setWarehouseMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const router = useRouter()

  const hasNic = !!contractor.nic_number || nicJustSaved

  async function handleGenerateAvatar() {
    setGeneratingAvatar(true)
    setPreviewUrl(null)
    try {
      const res = await fetch('/api/generate-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: contractor.first_name && contractor.surname
            ? `${contractor.first_name} ${contractor.surname}`
            : contractor.name || 'Contractor',
          gender: contractor.gender || undefined,
          nicPhotoUrl: contractor.nic_photo_url || undefined,
          style: avatarStyle,
        }),
      })
      const result = await res.json()
      if (result.url) {
        setPreviewUrl(result.url)
      }
    } catch (err) {
      // silently fail
    } finally {
      setGeneratingAvatar(false)
    }
  }

  async function handleAcceptAvatar() {
    if (!previewUrl) return
    setSavingAvatar(true)
    const result = await saveContractorAvatar(contractor.id, previewUrl)
    if (!result.error) {
      setAvatarUrl(previewUrl)
      setPreviewUrl(null)
      router.refresh()
    }
    setSavingAvatar(false)
  }

  function handleRejectAvatar() {
    setPreviewUrl(null)
  }

  async function handleSaveProfile() {
    setSaving(true)
    setMessage(null)
    const supabase = createClient()

    // Update profiles table
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        name: name.trim() || null,
        phone: phone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id)

    // Also update contractor nickname
    const { error: contractorError } = await supabase
      .from('contractors')
      .update({
        name: name.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractor.id)

    if (profileError || contractorError) {
      setMessage({ type: 'error', text: 'Failed to save. Try again.' })
    } else {
      setMessage({ type: 'success', text: 'Profile updated.' })
      router.refresh()
    }
    setSaving(false)
  }

  function captureWarehouseGps() {
    if (!navigator.geolocation) return
    setCapturingGps(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setWarehouseLat(p.coords.latitude)
        setWarehouseLng(p.coords.longitude)
        setCapturingGps(false)
      },
      () => { setCapturingGps(false) },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    )
  }

  async function handleSaveWarehouse() {
    setSavingWarehouse(true)
    setWarehouseMsg(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('contractors')
      .update({
        warehouse_name: warehouseName.trim() || 'Warehouse',
        warehouse_lat: warehouseLat,
        warehouse_lng: warehouseLng,
      })
      .eq('id', contractor.id)
    if (error) {
      setWarehouseMsg({ type: 'error', text: 'Failed to save.' })
    } else {
      setWarehouseMsg({ type: 'success', text: 'Pickup location saved.' })
      router.refresh()
    }
    setSavingWarehouse(false)
  }

  function handleNicSave(data: NicData) {
    startTransition(async () => {
      const result = await updateContractorNicData(contractor.id, {
        surname: data.surname,
        first_name: data.firstName,
        surname_at_birth: data.surnameAtBirth || undefined,
        nic_number: data.idNumber,
        gender: data.gender,
        date_of_birth: data.dateOfBirth || undefined,
        photo_url: data.photoUrl || undefined,
        nic_photo_url: data.nicPhotoUrl,
      })
      if (!result.error) {
        setNicJustSaved(true)
        setShowNicScanner(false)
        router.refresh()
      }
    })
  }

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-xl bg-muted/50 flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-foreground">Settings</h1>
          <p className="text-xs text-muted-foreground">Manage your profile and identity</p>
        </div>
      </div>

      {/* Profile Card */}
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="p-4 border-b border-border/30">
          <div className="flex items-center gap-3">
            {/* Avatar with Generate button */}
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={contractor.name || 'Avatar'} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-7 h-7 text-primary" />
                )}
              </div>
              <button
                onClick={() => setShowStylePicker(!showStylePicker)}
                disabled={generatingAvatar}
                className={cn(
                  "absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center transition-all",
                  "bg-primary text-primary-foreground shadow-lg hover:scale-110",
                  generatingAvatar && "animate-pulse"
                )}
                title="Generate AI profile photo"
              >
                {generatingAvatar ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{contractor.name || profile.name || 'Contractor'}</p>
              <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
              {generatingAvatar && (
                <p className="text-[10px] text-primary font-medium mt-0.5 animate-pulse">Generating AI photo...</p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-semibold",
                profile.approved
                  ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-600 border border-amber-500/20"
              )}>
                {profile.approved ? 'Approved' : 'Pending'}
              </span>
            </div>
          </div>

          {/* Style Picker */}
          {showStylePicker && !generatingAvatar && !previewUrl && (
            <div className="mt-3 rounded-xl border border-border/60 bg-card p-3 space-y-2.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Choose Avatar Style</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'professional', label: 'Professional', emoji: '👔' },
                  { id: 'bleach', label: 'Bleach', emoji: '⚔️' },
                  { id: 'one-piece', label: 'One Piece', emoji: '🏴‍☠️' },
                  { id: 'ghibli', label: 'Ghibli', emoji: '🌿' },
                  { id: 'naruto', label: 'Naruto', emoji: '🍥' },
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setAvatarStyle(s.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs font-medium transition-all",
                      avatarStyle === s.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/60"
                    )}
                  >
                    <span className="text-lg">{s.emoji}</span>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setShowStylePicker(false); handleGenerateAvatar() }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generate {avatarStyle === 'professional' ? 'Photo' : `${avatarStyle.charAt(0).toUpperCase() + avatarStyle.slice(1)} Avatar`}
              </button>
            </div>
          )}

          {/* Avatar Preview */}
          {(previewUrl || generatingAvatar) && (
            <div className="mt-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-2">
                {generatingAvatar ? 'Generating your photo...' : 'Preview - Does this look like you?'}
              </p>
              {generatingAvatar ? (
                <div className="flex items-center justify-center h-48 rounded-lg bg-muted/30">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-xs text-muted-foreground">Analyzing your ID and generating portrait...</p>
                  </div>
                </div>
              ) : previewUrl ? (
                <div className="space-y-2.5">
                  <div className="relative rounded-lg overflow-hidden mx-auto w-40 h-40">
                    <img
                      src={previewUrl}
                      alt="Generated avatar preview"
                      className="w-full h-full object-cover rounded-lg"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAcceptAvatar}
                      disabled={savingAvatar}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:bg-emerald-600 transition-colors disabled:opacity-50"
                    >
                      {savingAvatar ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      {savingAvatar ? 'Saving...' : 'Use This Photo'}
                    </button>
                    <button
                      onClick={handleGenerateAvatar}
                      disabled={generatingAvatar}
                      className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-muted text-muted-foreground text-xs font-semibold hover:bg-muted/80 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Retry
                    </button>
                    <button
                      onClick={handleRejectAvatar}
                      className="flex items-center justify-center px-3 py-2.5 rounded-lg bg-muted text-muted-foreground text-xs hover:bg-destructive/10 hover:text-destructive transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="p-4 space-y-3">
          {message && (
            <div className={cn(
              "p-2.5 rounded-xl text-xs font-medium",
              message.type === 'success'
                ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
            )}>
              {message.text}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="settings-name" className="text-xs text-muted-foreground">Nickname</Label>
            <div className="relative">
              <User className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your display name"
                className="pl-9 h-10 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="settings-email" className="text-xs text-muted-foreground">Email</Label>
            <div className="relative">
              <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="settings-email"
                value={profile.email}
                disabled
                className="pl-9 h-10 text-sm bg-muted/30"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="settings-phone" className="text-xs text-muted-foreground">Phone</Label>
            <div className="relative">
              <Phone className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="settings-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+230 5XXX XXXX"
                className="pl-9 h-10 text-sm"
              />
            </div>
          </div>

          <Button
            onClick={handleSaveProfile}
            disabled={saving}
            className="w-full h-10 text-sm"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 mr-1.5" />
                Save Profile
              </>
            )}
          </Button>
        </div>
      </div>

      {/* NIC / Identity Section */}
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="p-4 border-b border-border/30">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              hasNic ? "bg-emerald-500/10" : "bg-amber-500/10"
            )}>
              {hasNic ? (
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
              ) : (
                <IdCard className="w-5 h-5 text-amber-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">Identity Verification</p>
              <p className="text-[11px] text-muted-foreground">
                {hasNic ? 'Your NIC has been verified' : 'Scan your National ID Card'}
              </p>
            </div>
          </div>
        </div>

        {/* NIC Verified State */}
        {hasNic && !showNicScanner && (
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">First Name</p>
                <p className="text-sm font-semibold text-foreground">{contractor.first_name || '-'}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Surname</p>
                <p className="text-sm font-semibold text-foreground">{contractor.surname || '-'}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">NIC Number</p>
                <p className="text-sm font-mono font-semibold text-foreground">{contractor.nic_number || '-'}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Gender</p>
                <p className="text-sm font-semibold text-foreground capitalize">{contractor.gender || '-'}</p>
              </div>
              {contractor.date_of_birth && (
                <div className="space-y-0.5 col-span-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Date of Birth</p>
                  <p className="text-sm font-semibold text-foreground">
                    {new Date(contractor.date_of_birth).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric'
                    })}
                  </p>
                </div>
              )}
            </div>

            {contractor.nic_photo_url && (
              <div className="rounded-xl overflow-hidden border border-border/40">
                <img
                  src={contractor.nic_photo_url}
                  alt="NIC Card"
                  className="w-full h-32 object-cover"
                />
              </div>
            )}

            <button
              onClick={() => setShowNicScanner(true)}
              className="w-full flex items-center justify-between p-2.5 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <span className="text-xs text-muted-foreground">Re-scan NIC Card</span>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* NIC Not Verified / Scanner */}
        {!hasNic && !showNicScanner && (
          <div className="p-4">
            <div className="text-center py-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 flex items-center justify-center mb-3">
                <IdCard className="w-7 h-7 text-amber-500" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">NIC Not Verified</p>
              <p className="text-xs text-muted-foreground mb-4 max-w-[240px] mx-auto">
                Scan your Mauritius National ID Card to verify your identity. Your real name will be stored for official records.
              </p>
              <Button
                onClick={() => setShowNicScanner(true)}
                className="mx-auto"
                variant="default"
              >
                <IdCard className="w-4 h-4 mr-1.5" />
                Scan NIC Card
              </Button>
            </div>
          </div>
        )}

        {/* Scanner Active */}
        {showNicScanner && (
          <div className="p-3">
            <NicScanner onScanComplete={handleNicSave} existingData={
              contractor.nic_number ? {
                surname: contractor.surname || '',
                firstName: contractor.first_name || '',
                surnameAtBirth: '',
                gender: contractor.gender || '',
                dateOfBirth: contractor.date_of_birth || '',
                idNumber: contractor.nic_number || '',
                photoUrl: '',
                nicPhotoUrl: contractor.nic_photo_url || '',
              } : undefined
            } />
            <button
              onClick={() => setShowNicScanner(false)}
              className="w-full mt-2 text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Pickup Location (read-only — managed by admin) */}
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground">Pickup Location</p>
              {warehouseLat && warehouseLng ? (
                <div className="mt-1">
                  {warehouseName && <p className="text-xs text-foreground/80">{warehouseName}</p>}
                  <p className="text-[10px] font-mono text-muted-foreground">{warehouseLat.toFixed(6)}, {warehouseLng.toFixed(6)}</p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">Not set yet — contact admin</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Account Info */}
      <div className="rounded-2xl border border-border/40 bg-card overflow-hidden">
        <div className="p-4 border-b border-border/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Shield className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Account</p>
              <p className="text-[11px] text-muted-foreground">Status and details</p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-border/30">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-muted-foreground">Role</span>
            <span className="text-xs font-semibold text-foreground capitalize">{profile.role.replace('_', ' ')}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-muted-foreground">Status</span>
            <span className={cn(
              "text-xs font-semibold",
              profile.approved ? "text-emerald-600" : "text-amber-600"
            )}>
              {profile.approved ? 'Active' : 'Pending Approval'}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-muted-foreground">Identity</span>
            <span className={cn(
              "text-xs font-semibold",
              hasNic ? "text-emerald-600" : "text-amber-600"
            )}>
              {hasNic ? 'NIC Verified' : 'Not Verified'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
