'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { User, Mail, Phone, Camera, Sparkles, Loader2, Check, ArrowLeft, LogOut, RotateCcw, AlertTriangle } from 'lucide-react'
import Image from 'next/image'

interface Profile {
  id: string
  name: string | null
  email: string
  phone: string | null
  role: string
  avatar_url: string | null
  created_at: string
}

export function SettingsPage({ profile }: { profile: Profile }) {
  const router = useRouter()
  const [name, setName] = useState(profile.name || '')
  const [phone, setPhone] = useState(profile.phone || '')
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [generatingAvatar, setGeneratingAvatar] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const supabase = createClient()
    await supabase.from('profiles').update({
      name,
      phone,
      avatar_url: avatarUrl || null,
    }).eq('id', profile.id)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    router.refresh()
  }

  const [avatarError, setAvatarError] = useState<string | null>(null)

  const generateAvatar = async () => {
    setGeneratingAvatar(true)
    setAvatarError(null)
    try {
      console.log('[v0] Generating avatar for:', name || 'Store Keeper')
      const res = await fetch('/api/generate-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'Store Keeper', style: 'professional' })
      })
      console.log('[v0] Response status:', res.status)
      const data = await res.json()
      console.log('[v0] Response data:', data)
      if (data.url) {
        setAvatarUrl(data.url)
        setAvatarError(null)
      } else if (data.error) {
        console.error('Avatar generation failed:', data.error, data.detail)
        setAvatarError(data.error + (data.detail ? `: ${data.detail}` : ''))
      }
    } catch (e) {
      console.error('Failed to generate avatar:', e)
      setAvatarError(`Exception: ${e}`)
    }
    setGeneratingAvatar(false)
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleResetOperations = async () => {
    setResetting(true)
    try {
      const supabase = createClient()
      const userId = profile.id
      
      // Reset stock_out flags ONLY for deliveries processed by this user
      await supabase
        .from('deliveries')
        .update({
          stock_out: false,
          stock_out_at: null,
          stock_out_by: null,
        })
        .eq('stock_out', true)
        .eq('stock_out_by', userId)

      // Reset cash_collected flags ONLY for deliveries collected by this user
      await supabase
        .from('deliveries')
        .update({
          cash_collected: false,
          cash_collected_at: null,
          cash_collected_by: null,
        })
        .eq('cash_collected', true)
        .eq('cash_collected_by', userId)

      // Delete dispatch sessions created by this user
      await supabase
        .from('stock_dispatch_sessions')
        .delete()
        .eq('dispatched_by', userId)

      // Delete cash collection sessions collected by this user
      await supabase
        .from('cash_collection_sessions')
        .delete()
        .eq('collected_by', userId)

      // Reset stock_verified flags on deliveries (returns) verified by this user
      await supabase
        .from('deliveries')
        .update({
          stock_verified: false,
          stock_verified_at: null,
          stock_verified_by: null,
        })
        .eq('stock_verified', true)
        .eq('stock_verified_by', userId)

      // Delete all return collections (both pending and verified by this user)
      // First delete ones verified by this user
      await supabase
        .from('return_collections')
        .delete()
        .eq('verified_by', userId)
      
      // Also delete pending returns (not yet verified) - these are created during stock-in
      await supabase
        .from('return_collections')
        .delete()
        .eq('verified', false)

      setResetDone(true)
      setShowResetConfirm(false)
      setTimeout(() => setResetDone(false), 3000)
      router.refresh()
    } catch (error) {
      console.error('Error resetting operations:', error)
    }
    setResetting(false)
  }

  return (
    <div className="px-4 py-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      {/* Avatar Section */}
      <div className="flex flex-col items-center mb-8">
        <div className="relative mb-4">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={name || 'Avatar'}
              width={96}
              height={96}
              className="w-24 h-24 rounded-2xl object-cover border-2 border-border"
            />
          ) : (
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white font-bold text-3xl">
              {name?.charAt(0) || 'S'}
            </div>
          )}
          <button
            type="button"
            onClick={generateAvatar}
            disabled={generatingAvatar}
            className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center shadow-lg disabled:opacity-50"
          >
            {generatingAvatar ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Sparkles className="w-5 h-5" />
            )}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">Tap sparkle to generate AI avatar</p>
        {avatarError && (
          <div className="mt-2 p-2 rounded-lg bg-red-500/20 text-red-400 text-xs max-w-xs text-center">
            {avatarError}
          </div>
        )}
      </div>

      {/* Form */}
      <div className="space-y-4 mb-8">
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <User className="w-4 h-4" /> Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="h-12 rounded-xl bg-muted/30 border-border/50"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Mail className="w-4 h-4" /> Email
          </label>
          <Input
            value={profile.email}
            disabled
            className="h-12 rounded-xl bg-muted/30 border-border/50 opacity-60"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Phone className="w-4 h-4" /> Phone
          </label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Your phone number"
            className="h-12 rounded-xl bg-muted/30 border-border/50"
          />
        </div>
      </div>

      {/* Save Button */}
      <Button
        onClick={handleSave}
        disabled={saving}
        className={cn(
          "w-full h-14 rounded-2xl text-lg font-bold mb-4",
          saved ? "bg-emerald-500" : "bg-accent"
        )}
      >
        {saving ? (
          <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Saving...</>
        ) : saved ? (
          <><Check className="w-5 h-5 mr-2" /> Saved!</>
        ) : (
          'Save Changes'
        )}
      </Button>

      {/* Logout */}
      <Button
        onClick={handleLogout}
        variant="outline"
        className="w-full h-12 rounded-xl text-red-500 border-red-500/30 hover:bg-red-500/10"
      >
        <LogOut className="w-5 h-5 mr-2" /> Sign Out
      </Button>

      {/* Info */}
      <div className="mt-8 p-4 rounded-xl bg-muted/20 text-sm text-muted-foreground">
        <p><strong>Role:</strong> {profile.role}</p>
        <p><strong>Member since:</strong> {new Date(profile.created_at).toLocaleDateString()}</p>
      </div>

      {/* Reset Operations Section */}
      <div className="mt-8 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
            <RotateCcw className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Reset Store Operations</h3>
            <p className="text-xs text-muted-foreground">Clear all stock out and cash collection data</p>
          </div>
        </div>
        
        {resetDone ? (
          <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-500 text-sm font-medium flex items-center gap-2">
            <Check className="w-4 h-4" />
            All operations have been reset successfully
          </div>
        ) : showResetConfirm ? (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-red-500/20 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="text-sm text-red-400">
                <p className="font-semibold mb-1">This will reset YOUR operations:</p>
                <ul className="text-xs space-y-0.5 list-disc list-inside">
                  <li>Stock Out validations you processed</li>
                  <li>Cash Collections you recorded</li>
                  <li>Dispatch sessions you created</li>
                  <li>Returns you verified</li>
                </ul>
                <p className="mt-2 font-medium">This action cannot be undone!</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowResetConfirm(false)}
                variant="outline"
                className="flex-1 h-11 rounded-xl"
                disabled={resetting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleResetOperations}
                disabled={resetting}
                className="flex-1 h-11 rounded-xl bg-red-500 hover:bg-red-600 text-white"
              >
                {resetting ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Resetting...</>
                ) : (
                  'Confirm Reset'
                )}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={() => setShowResetConfirm(true)}
            variant="outline"
            className="w-full h-11 rounded-xl text-red-500 border-red-500/30 hover:bg-red-500/10"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset All Operations
          </Button>
        )}
      </div>
    </div>
  )
}
