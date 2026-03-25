'use client'

import React, { useState, useEffect } from "react"
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AlertCircle, Loader2, ArrowRight } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
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

  const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden relative">
      {/* Subtle scan line effect */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)'
        }}
      />

      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-500/[0.02] rounded-full blur-[150px]" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-cyan-500/[0.03] rounded-full blur-[100px]" />

      {/* Content */}
      <div className="relative z-10 min-h-screen flex">
        {/* Left Panel - Status Display */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 border-r border-white/[0.03]">
          {/* Top Status Bar */}
          <div className={`transition-all duration-1000 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-[10px] tracking-[0.3em] text-white/40 font-mono uppercase">System Online</span>
            </div>
          </div>

          {/* Center Content */}
          <div className={`transition-all duration-1000 delay-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="space-y-8">
              {/* Logo Mark */}
              <div className="relative w-16 h-16">
                <div className="absolute inset-0 border border-white/10 rounded-lg" />
                <div className="absolute inset-[6px] border border-white/20 rounded-md" />
                <div className="absolute inset-3 bg-gradient-to-br from-cyan-400/20 to-transparent rounded flex items-center justify-center">
                  <span className="text-cyan-400 font-bold text-xl">B</span>
                </div>
              </div>

              {/* Title */}
              <div>
                <h1 className="text-[clamp(2.5rem,5vw,4rem)] font-light tracking-tight leading-none text-white/90">
                  Business
                </h1>
                <h1 className="text-[clamp(2.5rem,5vw,4rem)] font-light tracking-tight leading-none text-white/90">
                  Hub
                </h1>
              </div>

              {/* Tagline */}
              <p className="text-white/30 text-sm max-w-xs leading-relaxed">
                Unified logistics platform for deliveries, tracking, and real-time fleet management.
              </p>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-x-12 gap-y-6 pt-8">
                <div>
                  <p className="text-[10px] tracking-[0.2em] text-white/30 font-mono uppercase mb-1">Status</p>
                  <p className="text-sm text-cyan-400 font-mono">OPERATIONAL</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-[0.2em] text-white/30 font-mono uppercase mb-1">Uptime</p>
                  <p className="text-sm text-white/70 font-mono">99.9%</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-[0.2em] text-white/30 font-mono uppercase mb-1">Active Users</p>
                  <p className="text-sm text-white/70 font-mono">2,847</p>
                </div>
                <div>
                  <p className="text-[10px] tracking-[0.2em] text-white/30 font-mono uppercase mb-1">Local Time</p>
                  <p className="text-sm text-white/70 font-mono">{mounted ? currentTime : '00:00:00'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom */}
          <div className={`transition-all duration-1000 delay-500 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
            <div className="flex items-center gap-4 text-[10px] tracking-[0.15em] text-white/20 font-mono uppercase">
              <span>v2.4.1</span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span>Mauritius</span>
              <span className="w-1 h-1 rounded-full bg-white/20" />
              <span>Secure Connection</span>
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
                <span className="text-[10px] tracking-[0.3em] text-white/40 font-mono uppercase">System Online</span>
              </div>
              <h1 className="text-3xl font-light tracking-tight text-white/90">Business Hub</h1>
            </div>

            {/* Form Header */}
            <div className="mb-10">
              <p className="text-[10px] tracking-[0.3em] text-white/30 font-mono uppercase mb-3">Authentication</p>
              <h2 className="text-2xl font-light text-white/90">Sign in to continue</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="flex items-center gap-3 p-4 bg-red-500/5 border border-red-500/10 rounded text-red-400/80 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-mono text-xs">{error}</span>
                </div>
              )}

              {/* Email Field */}
              <div className="space-y-2">
                <label className="text-[10px] tracking-[0.2em] text-white/40 font-mono uppercase">Email Address</label>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="w-full h-14 px-4 bg-white/[0.02] border border-white/[0.06] rounded text-white placeholder:text-white/20 font-mono text-sm focus:outline-none focus:border-cyan-500/30 focus:bg-white/[0.04] transition-all"
                  />
                  <div className={`absolute bottom-0 left-0 h-[1px] bg-gradient-to-r from-cyan-400 to-transparent transition-all duration-300 ${focusedField === 'email' ? 'w-full opacity-100' : 'w-0 opacity-0'}`} />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-2">
                <label className="text-[10px] tracking-[0.2em] text-white/40 font-mono uppercase">Password</label>
                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    required
                    autoComplete="current-password"
                    placeholder="Enter password"
                    className="w-full h-14 px-4 bg-white/[0.02] border border-white/[0.06] rounded text-white placeholder:text-white/20 font-mono text-sm focus:outline-none focus:border-cyan-500/30 focus:bg-white/[0.04] transition-all"
                  />
                  <div className={`absolute bottom-0 left-0 h-[1px] bg-gradient-to-r from-cyan-400 to-transparent transition-all duration-300 ${focusedField === 'password' ? 'w-full opacity-100' : 'w-0 opacity-0'}`} />
                </div>
              </div>

              {/* Submit Button */}
              <button 
                type="submit" 
                disabled={loading}
                className="group w-full h-14 mt-4 bg-white text-black font-medium rounded flex items-center justify-center gap-2 transition-all duration-300 hover:bg-white/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm tracking-wide">Authenticating...</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm tracking-wide">Continue</span>
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>

              {/* Divider */}
              <div className="relative py-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/[0.04]" />
                </div>
              </div>

              {/* Sign Up Link */}
              <div className="text-center">
                <p className="text-white/30 text-sm mb-3">New to Business Hub?</p>
                <Link 
                  href="/auth/sign-up"
                  className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors group"
                >
                  <span>Create an account</span>
                  <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </form>

            {/* Footer */}
            <div className="mt-12 pt-8 border-t border-white/[0.04]">
              <p className="text-[10px] tracking-[0.15em] text-white/20 font-mono uppercase text-center">
                Secured with end-to-end encryption
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
