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

            {/* Clean Glass Card */}
            <div className="relative group">
              {/* Subtle static glow - cyan only */}
              <div className="absolute -inset-4 rounded-[36px] bg-cyan-500/10 blur-2xl" />
              
              {/* Subtle border glow */}
              <div className="absolute -inset-[1px] rounded-[29px] bg-gradient-to-b from-white/20 via-white/5 to-transparent" />
              
              {/* Main glass card */}
              <div className="relative rounded-[28px] overflow-hidden backdrop-blur-xl bg-white/[0.08] border border-white/10">
                {/* Top highlight line */}
                <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                
                {/* Subtle top glow */}
                <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/10 to-transparent rounded-t-[28px]" />
                
                {/* Content */}
                <div className="relative p-8">
                
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

                  {/* Email Field - World-Class Glass Input */}
                  <div className="space-y-2.5">
                    <label className="text-[11px] tracking-[0.15em] text-white/60 font-medium uppercase">Email Address</label>
                    <div className="relative group/input">
                      {/* Animated glow on focus */}
                      <div className={`absolute -inset-[2px] rounded-2xl transition-all duration-500 ${focusedField === 'email' ? 'opacity-100' : 'opacity-0'}`}>
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-blue-500 to-cyan-500 rounded-2xl blur-md animate-pulse" style={{ animationDuration: '2s' }} />
                      </div>
                      {/* Glass input container */}
                      <div className="relative rounded-xl overflow-hidden backdrop-blur-xl bg-white/[0.08] border border-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.1)]">
                        {/* Inner highlight */}
                        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          onFocus={() => setFocusedField('email')}
                          onBlur={() => setFocusedField(null)}
                          required
                          autoComplete="email"
                          placeholder="you@example.com"
                          className="relative w-full h-13 px-4 py-3.5 bg-transparent text-white placeholder:text-white/35 text-sm focus:outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Password Field - World-Class Glass Input */}
                  <div className="space-y-2.5">
                    <label className="text-[11px] tracking-[0.15em] text-white/60 font-medium uppercase">Password</label>
                    <div className="relative group/input">
                      {/* Animated glow on focus */}
                      <div className={`absolute -inset-[2px] rounded-2xl transition-all duration-500 ${focusedField === 'password' ? 'opacity-100' : 'opacity-0'}`}>
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 rounded-2xl blur-md animate-pulse" style={{ animationDuration: '2s' }} />
                      </div>
                      {/* Glass input container */}
                      <div className="relative rounded-xl overflow-hidden backdrop-blur-xl bg-white/[0.08] border border-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.1)]">
                        {/* Inner highlight */}
                        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          onFocus={() => setFocusedField('password')}
                          onBlur={() => setFocusedField(null)}
                          required
                          autoComplete="current-password"
                          placeholder="Enter password"
                          className="relative w-full h-13 px-4 py-3.5 bg-transparent text-white placeholder:text-white/35 text-sm focus:outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Submit Button - World-Class Liquid Glass */}
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="group relative w-full h-14 mt-4 rounded-2xl font-semibold text-sm overflow-hidden disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-300 active:scale-[0.97]"
                  >
                    {/* Animated outer glow */}
                    <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-cyan-400 via-emerald-400 to-cyan-400 opacity-70 blur-lg group-hover:opacity-100 group-hover:blur-xl transition-all duration-500" style={{ backgroundSize: '200% 100%', animation: 'gradient-shift 3s ease infinite' }} />
                    
                    {/* Main button surface */}
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-400 via-cyan-300 to-emerald-400" style={{ backgroundSize: '200% 100%', animation: 'gradient-shift 3s ease infinite' }} />
                    
                    {/* Glass overlay layers */}
                    <div className="absolute inset-0 rounded-2xl">
                      {/* Top highlight - curved reflection */}
                      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/50 via-white/20 to-transparent rounded-t-2xl" />
                      {/* Bottom shadow for depth */}
                      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/20 to-transparent rounded-b-2xl" />
                      {/* Moving shine on hover */}
                      <div className="absolute inset-0 overflow-hidden rounded-2xl">
                        <div className="absolute w-[200%] h-full -translate-x-full group-hover:translate-x-0 transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                      </div>
                    </div>
                    
                    {/* Inner border for depth */}
                    <div className="absolute inset-[1px] rounded-[15px] border border-white/30 pointer-events-none" />
                    
                    {/* Button text */}
                    <span className="relative z-10 flex items-center justify-center gap-2.5 text-gray-900 font-bold tracking-wide drop-shadow-sm">
                      {loading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Authenticating...</span>
                        </>
                      ) : (
                        <>
                          <span>Access System</span>
                          <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
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
