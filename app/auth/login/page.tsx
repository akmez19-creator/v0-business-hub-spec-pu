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

            {/* ULTIMATE Liquid Glass Card */}
            <div className="relative group perspective-1000">
              {/* Floating light orbs - ambient */}
              <div className="absolute -top-16 -left-16 w-32 h-32 rounded-full bg-cyan-400/20 blur-3xl float-orb" />
              <div className="absolute -bottom-12 -right-12 w-24 h-24 rounded-full bg-purple-500/15 blur-2xl float-orb" style={{ animationDelay: '2s' }} />
              <div className="absolute top-1/2 -right-20 w-20 h-20 rounded-full bg-blue-400/10 blur-2xl float-orb" style={{ animationDelay: '4s' }} />
              
              {/* Layer 1: Deep ambient glow */}
              <div className="absolute -inset-8 rounded-[48px] opacity-60">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/25 via-transparent to-purple-600/20 blur-3xl animate-pulse" style={{ animationDuration: '4s' }} />
                <div className="absolute inset-0 bg-gradient-to-tl from-blue-500/15 via-transparent to-cyan-400/15 blur-3xl animate-pulse" style={{ animationDuration: '6s', animationDelay: '2s' }} />
              </div>
              
              {/* Layer 2: Chromatic aberration ring */}
              <div className="absolute -inset-[2px] rounded-[30px] overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/50 via-transparent to-cyan-500/50 blur-[1px]" style={{ transform: 'translateX(-2px)' }} />
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500/30 via-transparent to-purple-500/30 blur-[1px]" style={{ transform: 'translateX(2px)' }} />
              </div>
              
              {/* Layer 3: Animated border - rotating conic gradient */}
              <div className="absolute -inset-[1px] rounded-[29px] overflow-hidden">
                <div 
                  className="absolute inset-[-50%] bg-[conic-gradient(from_0deg,transparent_0deg,rgba(6,182,212,0.5)_60deg,transparent_120deg,rgba(139,92,246,0.4)_180deg,transparent_240deg,rgba(6,182,212,0.3)_300deg,transparent_360deg)]"
                  style={{ animation: 'spin 6s linear infinite' }}
                />
              </div>
              
              {/* Layer 4: Main glass container */}
              <div className="relative rounded-[28px] overflow-hidden" style={{ transform: 'translateZ(0)' }}>
                {/* Glass base - multi-layer depth */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.12] via-white/[0.04] to-black/40 backdrop-blur-3xl" />
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/20 via-transparent to-purple-950/10" />
                
                {/* Frosted noise texture */}
                <div 
                  className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
                  style={{ 
                    backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 512 512\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.7\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
                    backgroundSize: '200px'
                  }}
                />
                
                {/* Top glossy reflection - curved highlight */}
                <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/[0.15] via-white/[0.05] to-transparent rounded-t-[28px]" />
                <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                <div className="absolute inset-x-16 top-[1px] h-px bg-gradient-to-r from-transparent via-white/30 to-transparent blur-[0.5px]" />
                
                {/* Side highlights */}
                <div className="absolute left-0 inset-y-8 w-px bg-gradient-to-b from-white/20 via-white/5 to-transparent" />
                <div className="absolute right-0 inset-y-8 w-px bg-gradient-to-b from-white/10 via-white/3 to-transparent" />
                
                {/* Inner glow */}
                <div className="absolute inset-4 rounded-[20px] shadow-[inset_0_0_60px_rgba(6,182,212,0.05)]" />
                
                {/* Bottom depth shadow */}
                <div className="absolute inset-0 shadow-[inset_0_-40px_60px_-30px_rgba(0,0,0,0.6)]" />
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/30 to-transparent rounded-b-[28px]" />
                
                {/* Moving light reflection - simulates environment */}
                <div 
                  className="absolute inset-0 opacity-30 pointer-events-none overflow-hidden rounded-[28px]"
                >
                  <div 
                    className="absolute w-[200%] h-32 bg-gradient-to-r from-transparent via-white/10 to-transparent -rotate-12"
                    style={{ 
                      animation: 'shimmer 8s ease-in-out infinite',
                      top: '-20%',
                      left: '-50%'
                    }}
                  />
                </div>
                
                {/* Content container */}
                <div className="relative p-8 border border-white/[0.08] rounded-[28px]">
                  {/* Inner border glow */}
                  <div className="absolute inset-0 rounded-[28px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]" />
                
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

                  {/* Email Field - Ultimate Glass Input */}
                  <div className="space-y-2">
                    <label className="text-[10px] tracking-[0.2em] text-white/50 font-mono uppercase">Email Address</label>
                    <div className="relative group/input">
                      {/* Multi-layer glow on focus */}
                      <div className={`absolute -inset-2 rounded-2xl transition-all duration-700 ${focusedField === 'email' ? 'opacity-100' : 'opacity-0'}`}>
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/30 to-blue-500/20 blur-xl" />
                        <div className="absolute inset-1 bg-gradient-to-r from-cyan-400/20 to-purple-500/15 blur-lg" />
                      </div>
                      {/* Glass container */}
                      <div className="relative overflow-hidden rounded-xl">
                        {/* Glass layers */}
                        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.1] via-white/[0.04] to-black/20 backdrop-blur-xl" />
                        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.03] to-transparent" />
                        {/* Top highlight */}
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                        <div className="absolute inset-x-4 top-[1px] h-px bg-gradient-to-r from-transparent via-white/20 to-transparent blur-[0.5px]" />
                        {/* Inner shadow */}
                        <div className="absolute inset-0 shadow-[inset_0_-8px_16px_-8px_rgba(0,0,0,0.3)]" />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          onFocus={() => setFocusedField('email')}
                          onBlur={() => setFocusedField(null)}
                          required
                          autoComplete="email"
                          placeholder="you@example.com"
                          className="relative w-full h-12 px-4 bg-transparent border border-white/[0.08] rounded-xl text-white placeholder:text-white/30 font-mono text-sm focus:outline-none focus:border-cyan-400/40 transition-all duration-300"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Password Field - Ultimate Glass Input */}
                  <div className="space-y-2">
                    <label className="text-[10px] tracking-[0.2em] text-white/50 font-mono uppercase">Password</label>
                    <div className="relative group/input">
                      {/* Multi-layer glow on focus */}
                      <div className={`absolute -inset-2 rounded-2xl transition-all duration-700 ${focusedField === 'password' ? 'opacity-100' : 'opacity-0'}`}>
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-500/25 to-cyan-500/20 blur-xl" />
                        <div className="absolute inset-1 bg-gradient-to-r from-blue-400/15 to-cyan-500/15 blur-lg" />
                      </div>
                      {/* Glass container */}
                      <div className="relative overflow-hidden rounded-xl">
                        {/* Glass layers */}
                        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.1] via-white/[0.04] to-black/20 backdrop-blur-xl" />
                        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/[0.02] to-transparent" />
                        {/* Top highlight */}
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                        <div className="absolute inset-x-4 top-[1px] h-px bg-gradient-to-r from-transparent via-white/20 to-transparent blur-[0.5px]" />
                        {/* Inner shadow */}
                        <div className="absolute inset-0 shadow-[inset_0_-8px_16px_-8px_rgba(0,0,0,0.3)]" />
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onFocus={() => setFocusedField('password')}
                          onBlur={() => setFocusedField(null)}
                          required
                          autoComplete="current-password"
                          placeholder="Enter password"
                          className="relative w-full h-12 px-4 bg-transparent border border-white/[0.08] rounded-xl text-white placeholder:text-white/30 font-mono text-sm focus:outline-none focus:border-cyan-400/40 transition-all duration-300"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Submit Button - Ultimate Glass */}
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="group relative w-full h-14 mt-3 rounded-2xl font-medium text-sm overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed transition-transform duration-300 active:scale-[0.98]"
                  >
                    {/* Button glow */}
                    <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-500 rounded-2xl blur-lg opacity-50 group-hover:opacity-75 transition-opacity duration-500" />
                    
                    {/* Glass background */}
                    <div className="absolute inset-0 rounded-2xl overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-cyan-400 to-cyan-500 transition-all duration-500" />
                      <div className="absolute inset-0 bg-gradient-to-b from-white/30 via-transparent to-black/20" />
                      {/* Top shine */}
                      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent rounded-t-2xl" />
                      {/* Moving highlight */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                      </div>
                    </div>
                    
                    {/* Border highlight */}
                    <div className="absolute inset-0 rounded-2xl border border-white/20" />
                    <div className="absolute inset-[1px] rounded-[15px] border border-black/10" />
                    
                    <span className="relative z-10 flex items-center justify-center gap-2 text-black font-bold tracking-wide">
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
            </div>

            {/* Footer */}
            <div className="mt-8 text-center">
              <p className="text-[10px] tracking-[0.15em] text-white/20 font-mono uppercase">
                akmez.tech
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
