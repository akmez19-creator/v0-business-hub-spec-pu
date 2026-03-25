'use client'

import React, { useState, useEffect } from "react"
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react'
import dynamic from 'next/dynamic'

const Futuristic3DBackground = dynamic(
  () => import('@/components/ui/futuristic-3d-background'),
  { ssr: false }
)

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState('00:00:00')
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
    const update = () => {
      setCurrentTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('profiles')
        .update({ last_login: new Date().toISOString() })
        .eq('id', user.id)
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden relative">
      {/* 3D Background */}
      <Futuristic3DBackground />

      {/* Subtle scan line effect */}
      <div 
        className="absolute inset-0 pointer-events-none z-20 opacity-[0.02]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)'
        }}
      />

      {/* Content */}
      <div className="relative z-10 min-h-screen flex">
        {/* Left Panel - Status Display */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 border-r border-white/[0.03]">
          {/* Top Status Bar */}
          <div className={`transition-all duration-1000 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-[10px] tracking-[0.3em] text-cyan-400/60 font-mono uppercase">System Online</span>
            </div>
          </div>

          {/* Center Content */}
          <div className={`transition-all duration-1000 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="space-y-8">
              {/* Logo Mark */}
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 border border-cyan-500/20 rounded-xl rotate-45" />
                <div className="absolute inset-2 border border-cyan-500/30 rounded-lg rotate-45" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-cyan-400 font-bold text-3xl">B</span>
                </div>
                <div className="absolute -inset-2 bg-cyan-500/10 rounded-xl blur-xl" />
              </div>

              {/* Title */}
              <div>
                <h1 className="text-[clamp(2.5rem,5vw,4.5rem)] font-bold tracking-tight leading-none">
                  <span className="text-white">Business</span>
                </h1>
                <h1 className="text-[clamp(2.5rem,5vw,4.5rem)] font-bold tracking-tight leading-none">
                  <span className="bg-gradient-to-r from-cyan-400 to-cyan-300 bg-clip-text text-transparent">Hub</span>
                </h1>
              </div>

              {/* Tagline */}
              <p className="text-white/40 text-sm max-w-xs leading-relaxed">
                Next-generation logistics platform for deliveries, tracking, and real-time fleet management.
              </p>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-x-12 gap-y-6 pt-8">
                <div className="space-y-1">
                  <p className="text-[10px] tracking-[0.2em] text-white/30 font-mono uppercase">Status</p>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <p className="text-sm text-emerald-400 font-mono">OPERATIONAL</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] tracking-[0.2em] text-white/30 font-mono uppercase">Uptime</p>
                  <p className="text-sm text-white/70 font-mono">99.9%</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] tracking-[0.2em] text-white/30 font-mono uppercase">Active Users</p>
                  <p className="text-sm text-white/70 font-mono">2,847</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] tracking-[0.2em] text-white/30 font-mono uppercase">Local Time</p>
                  <p className="text-sm text-cyan-400 font-mono">{currentTime}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom */}
          <div className={`transition-all duration-1000 delay-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex items-center gap-4 text-[10px] tracking-[0.15em] text-white/20 font-mono uppercase">
              <span>v2.4.1</span>
              <span className="w-1 h-1 rounded-full bg-cyan-500/50" />
              <span>Mauritius</span>
              <span className="w-1 h-1 rounded-full bg-cyan-500/50" />
              <span>256-bit Encryption</span>
            </div>
          </div>
        </div>

        {/* Right Panel - Login Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className={`w-full max-w-sm transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            {/* Mobile Header */}
            <div className="lg:hidden mb-12 text-center">
              <div className="inline-flex items-center gap-3 mb-6">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-[10px] tracking-[0.3em] text-cyan-400/60 font-mono uppercase">System Online</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight">
                <span className="text-white">Business </span>
                <span className="bg-gradient-to-r from-cyan-400 to-cyan-300 bg-clip-text text-transparent">Hub</span>
              </h1>
            </div>

            {/* Glassmorphism Card */}
            <div className="relative">
              <div className="absolute -inset-[1px] bg-gradient-to-b from-cyan-500/20 via-white/5 to-transparent rounded-2xl" />
              <div className="relative bg-black/40 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8">
                
                {/* Form Header */}
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-px flex-1 bg-gradient-to-r from-cyan-500/50 to-transparent" />
                    <p className="text-[10px] tracking-[0.3em] text-cyan-400/60 font-mono uppercase px-2">Authentication</p>
                    <div className="h-px flex-1 bg-gradient-to-l from-cyan-500/50 to-transparent" />
                  </div>
                  <h2 className="text-xl font-semibold text-white text-center">Sign in to continue</h2>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                  {error && (
                    <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400/80 text-sm">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span className="font-mono text-xs">{error}</span>
                    </div>
                  )}

                  {/* Email Field */}
                  <div className="space-y-2">
                    <label className="text-[10px] tracking-[0.2em] text-white/40 font-mono uppercase">Email Address</label>
                    <div className="relative group">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onFocus={() => setFocusedField('email')}
                        onBlur={() => setFocusedField(null)}
                        required
                        autoComplete="email"
                        placeholder="you@example.com"
                        className="w-full h-12 px-4 bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder:text-white/20 font-mono text-sm focus:outline-none focus:border-cyan-500/40 focus:bg-cyan-500/5 transition-all"
                      />
                      <div className={`absolute inset-0 rounded-xl bg-cyan-500/10 blur-xl transition-opacity duration-300 -z-10 ${focusedField === 'email' ? 'opacity-100' : 'opacity-0'}`} />
                    </div>
                  </div>

                  {/* Password Field */}
                  <div className="space-y-2">
                    <label className="text-[10px] tracking-[0.2em] text-white/40 font-mono uppercase">Password</label>
                    <div className="relative group">
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={() => setFocusedField('password')}
                        onBlur={() => setFocusedField(null)}
                        required
                        autoComplete="current-password"
                        placeholder="Enter password"
                        className="w-full h-12 px-4 bg-white/[0.03] border border-white/[0.08] rounded-xl text-white placeholder:text-white/20 font-mono text-sm focus:outline-none focus:border-cyan-500/40 focus:bg-cyan-500/5 transition-all"
                      />
                      <div className={`absolute inset-0 rounded-xl bg-cyan-500/10 blur-xl transition-opacity duration-300 -z-10 ${focusedField === 'password' ? 'opacity-100' : 'opacity-0'}`} />
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="group relative w-full h-12 mt-2 rounded-xl font-medium text-sm overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all group-hover:from-cyan-400 group-hover:to-cyan-300" />
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="absolute inset-0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                    </div>
                    <span className="relative z-10 flex items-center justify-center gap-2 text-black font-semibold">
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Authenticating...</span>
                        </>
                      ) : (
                        <>
                          <span>Access System</span>
                          <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </>
                      )}
                    </span>
                  </button>
                </form>

                {/* Divider */}
                <div className="relative py-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/[0.06]" />
                  </div>
                </div>

                {/* Sign Up Link */}
                <div className="text-center">
                  <p className="text-white/30 text-xs mb-2">New to Business Hub?</p>
                  <Link 
                    href="/auth/sign-up"
                    className="inline-flex items-center gap-2 text-sm text-cyan-400/80 hover:text-cyan-400 transition-colors group"
                  >
                    <span>Create an account</span>
                    <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-8 text-center">
              <p className="text-[10px] tracking-[0.15em] text-white/20 font-mono uppercase">
                AKMEZ Technologies Ltd.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
