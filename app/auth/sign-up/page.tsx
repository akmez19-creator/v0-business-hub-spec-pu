'use client'

export const dynamic = 'force-dynamic'

import React, { useState, useEffect } from "react"
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select' // Used for contractor selection
import { AlertCircle, Loader2, Package, Sparkles, UserPlus, Bike, Building2, Users, Briefcase, ShieldCheck, Store } from 'lucide-react'
import type { Profile, UserRole } from '@/lib/types'
import { ROLE_LABELS } from '@/lib/types'

// Role icon mappings for all user types
const roleIcons: Record<UserRole, React.ElementType> = {
  admin: ShieldCheck,
  manager: Briefcase,
  marketing_agent: Users,
  marketing_back_office: Briefcase,
  marketing_front_office: Users,
  contractor: Building2,
  rider: Bike,
  storekeeper: Store,
}

// Role color gradients for visual distinction
const roleColors: Record<UserRole, string> = {
  admin: 'from-purple-500 to-purple-600',
  manager: 'from-blue-500 to-blue-600',
  marketing_agent: 'from-green-500 to-green-600',
  marketing_back_office: 'from-violet-500 to-violet-600',
  marketing_front_office: 'from-pink-500 to-pink-600',
  contractor: 'from-orange-500 to-orange-600',
  rider: 'from-cyan-500 to-cyan-600',
  storekeeper: 'from-amber-500 to-amber-600',
}

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<UserRole>('marketing_agent')
  const [contractorId, setContractorId] = useState<string>('none')
  const [contractors, setContractors] = useState<Profile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (role === 'rider') {
      loadContractors()
    }
  }, [role])

  async function loadContractors() {
    const supabase = createClient()
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'contractor')
      .eq('approved', true)
    
    if (data) {
      setContractors(data)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    const supabase = createClient()

    // Sign up without email confirmation - admin will approve
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          name,
          role,
          phone: phone || null,
          contractor_id: role === 'rider' && contractorId !== 'none' ? contractorId : null,
        },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // If user was created, also create/update their profile
    if (data?.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: data.user.id,
          email: email,
          name: name,
          role: role,
          phone: phone || null,
          approved: false, // Needs admin approval
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id'
        })
      
      if (profileError) {
        console.log('[v0] Profile creation error:', profileError)
        // Don't fail the signup, just log the error
      }
    }

    // Show success - admin will approve them
    router.push('/auth/sign-up-success')
  }

  const RoleIcon = roleIcons[role]

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#0a0a1a]">
      {/* Animated Background */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-cyan-500/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-orange-500/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[150px]" />
        
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
            backgroundSize: '50px 50px'
          }}
        />
        
        {mounted && [...Array(15)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white/30 rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${3 + Math.random() * 4}s`
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4 py-12">
        <div className={`w-full max-w-lg transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 relative mb-4 animate-float">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl transform rotate-6" />
              <div className="absolute inset-0 bg-gradient-to-br from-orange-400 to-orange-500 rounded-2xl flex items-center justify-center">
                <Package className="w-10 h-10 text-white" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-white">
              Join <span className="bg-gradient-to-r from-orange-400 to-cyan-400 bg-clip-text text-transparent">Business Hub</span>
            </h1>
          </div>

          {/* Glass Card */}
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/20 via-transparent to-orange-500/20 rounded-3xl blur-xl" />
            
            <div className="relative bg-white/5 backdrop-blur-2xl rounded-3xl border border-white/10 p-8 shadow-2xl">
              {/* Role Indicator */}
              <div className="flex items-center justify-center mb-6">
                <div className={`px-4 py-2 rounded-full bg-gradient-to-r ${roleColors[role]} flex items-center gap-2 transition-all duration-300`}>
                  <RoleIcon className="w-4 h-4 text-white" />
                  <span className="text-white text-sm font-medium">{ROLE_LABELS[role]}</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-shake">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white/70">Full Name</Label>
                    <Input
                      type="text"
                      placeholder="John Doe"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-orange-500/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/70">Phone (optional)</Label>
                    <Input
                      type="tel"
                      placeholder="+233 XX XXX XXXX"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-orange-500/50"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-white/70">Email Address</Label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-orange-500/50"
                  />
                </div>

                <div className="space-y-3">
                  <Label className="text-white/70">Select Your Role</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(ROLE_LABELS).map(([value, label]) => {
                      const Icon = roleIcons[value as UserRole]
                      const isSelected = role === value
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setRole(value as UserRole)}
                          className={`flex items-center gap-2 p-3 rounded-xl border transition-all duration-200 ${
                            isSelected 
                              ? `bg-gradient-to-r ${roleColors[value as UserRole]} border-transparent text-white` 
                              : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span className="text-sm font-medium">{label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {role === 'rider' && (
                  <div className="space-y-2 animate-fadeIn">
                    <Label className="text-white/70">Contractor (optional)</Label>
                    <Select value={contractorId} onValueChange={setContractorId}>
                      <SelectTrigger className="h-12 bg-white/5 border-white/10 text-white rounded-xl focus:border-orange-500/50">
                        <SelectValue placeholder="Select contractor" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a2e] border-white/10">
                        <SelectItem value="none" className="text-white hover:bg-white/10">
                          Independent Rider
                        </SelectItem>
                        {contractors.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-white hover:bg-white/10">
                            {c.name || c.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-white/70">Password</Label>
                    <Input
                      type="password"
                      placeholder="Min 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-orange-500/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white/70">Confirm Password</Label>
                    <Input
                      type="password"
                      placeholder="Confirm password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="h-12 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-orange-500/50"
                    />
                  </div>
                </div>

                <Button 
                  type="submit" 
                  disabled={loading}
                  className="w-full h-14 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-semibold rounded-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-orange-500/25 active:scale-[0.98]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    <>
                      <UserPlus className="mr-2 h-5 w-5" />
                      Create Account
                    </>
                  )}
                </Button>

                <p className="text-center text-white/50 text-sm">
                  Already have an account?{' '}
                  <Link href="/auth/login" className="text-orange-400 hover:text-orange-300 font-medium transition-colors">
                    Sign in
                  </Link>
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
