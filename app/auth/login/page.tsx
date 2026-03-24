'use client'

import React, { useState, useEffect } from "react"
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, Loader2, Package, Sparkles, Zap, Shield, Truck } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
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

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#0a0a1a]">
      {/* Animated Background */}
      <div className="absolute inset-0">
        {/* Gradient Orbs */}
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-orange-500/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-cyan-500/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[150px]" />
        
        {/* Grid Pattern */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
            backgroundSize: '50px 50px'
          }}
        />
        
        {/* Floating Particles */}
        {mounted && [...Array(20)].map((_, i) => (
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
      <div className="relative z-10 min-h-screen flex flex-col lg:flex-row">
        {/* Left Side - Branding */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center items-center p-12">
          <div className={`transition-all duration-1000 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
            {/* 3D Logo */}
            <div className="relative mb-8">
              <div className="w-32 h-32 relative animate-float">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-orange-600 rounded-3xl transform rotate-6 animate-pulse" />
                <div className="absolute inset-0 bg-gradient-to-br from-orange-400 to-orange-500 rounded-3xl flex items-center justify-center shadow-2xl shadow-orange-500/30">
                  <Package className="w-16 h-16 text-white" />
                </div>
                {/* Glow Ring */}
                <div className="absolute -inset-4 border-2 border-orange-500/30 rounded-[2rem] animate-spin-slow" />
              </div>
            </div>

            <h1 className="text-5xl font-bold text-white mb-4 text-center">
              Business
              <span className="bg-gradient-to-r from-orange-400 to-cyan-400 bg-clip-text text-transparent"> Hub</span>
            </h1>
            <p className="text-white/60 text-lg text-center max-w-md mb-12">
              Your all-in-one delivery management platform with real-time tracking and analytics
            </p>

            {/* Feature Cards */}
            <div className="grid grid-cols-2 gap-4 max-w-lg">
              {[
                { icon: Truck, label: 'Track Deliveries', color: 'from-orange-500 to-orange-600' },
                { icon: Zap, label: 'Real-time Updates', color: 'from-cyan-500 to-cyan-600' },
                { icon: Shield, label: 'Secure Platform', color: 'from-purple-500 to-purple-600' },
                { icon: Sparkles, label: 'Smart Analytics', color: 'from-pink-500 to-pink-600' },
              ].map((feature, i) => (
                <div
                  key={feature.label}
                  className={`p-4 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 hover:border-white/20 transition-all duration-500 hover:scale-105 hover:bg-white/10 cursor-default group ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
                  style={{ transitionDelay: `${300 + i * 100}ms` }}
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                    <feature.icon className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-white/80 font-medium">{feature.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side - Login Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className={`w-full max-w-md transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}>
            {/* Mobile Logo */}
            <div className="lg:hidden flex flex-col items-center mb-8">
              <div className="w-20 h-20 relative mb-4 animate-float">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl transform rotate-6" />
                <div className="absolute inset-0 bg-gradient-to-br from-orange-400 to-orange-500 rounded-2xl flex items-center justify-center">
                  <Package className="w-10 h-10 text-white" />
                </div>
              </div>
              <h1 className="text-3xl font-bold text-white">
                Business <span className="text-orange-400">Hub</span>
              </h1>
            </div>

            {/* Glass Card */}
            <div className="relative">
              {/* Card Glow */}
              <div className="absolute -inset-1 bg-gradient-to-r from-orange-500/20 via-transparent to-cyan-500/20 rounded-3xl blur-xl" />
              
              <div className="relative bg-white/5 backdrop-blur-2xl rounded-3xl border border-white/10 p-8 shadow-2xl">
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold text-white mb-2">Welcome Back</h2>
                  <p className="text-white/50">Sign in to continue your journey</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  {error && (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-shake">
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-white/70">Email Address</Label>
                    <div className="relative group">
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        className="w-full h-14 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-orange-500/50 focus:ring-orange-500/20 transition-all"
                      />
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-orange-500/20 to-cyan-500/20 opacity-0 group-focus-within:opacity-100 -z-10 blur transition-opacity" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-white/70">Password</Label>
                    <div className="relative group">
                      <Input
                        id="password"
                        type="password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        className="w-full h-14 bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-xl focus:border-orange-500/50 focus:ring-orange-500/20 transition-all"
                      />
                      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-orange-500/20 to-cyan-500/20 opacity-0 group-focus-within:opacity-100 -z-10 blur transition-opacity" />
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    disabled={loading}
                    className="w-full h-14 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-semibold rounded-xl transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-orange-500/25 active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Signing In...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-5 w-5" />
                        Sign In
                      </>
                    )}
                  </Button>

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-white/10" />
                    </div>
                    <div className="relative flex justify-center text-sm">
                      <span className="px-4 bg-transparent text-white/40">New to Business Hub?</span>
                    </div>
                  </div>

                  <Link 
                    href="/auth/sign-up"
                    className="block w-full h-14 flex items-center justify-center bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl border border-white/10 hover:border-white/20 transition-all duration-300 hover:scale-[1.02]"
                  >
                    Create an Account
                  </Link>
                </form>
              </div>
            </div>

            {/* Footer */}
            <p className="text-center text-white/30 text-sm mt-6">
              Secure login powered by advanced encryption
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
