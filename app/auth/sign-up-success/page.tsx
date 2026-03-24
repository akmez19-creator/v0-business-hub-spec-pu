'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Package, CheckCircle2, Sparkles, Clock, UserCheck, LogIn } from 'lucide-react'

export default function SignUpSuccessPage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#0a0a1a]">
      {/* Animated Background */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-green-500/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-cyan-500/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
        
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
            backgroundSize: '50px 50px'
          }}
        />

        {/* Celebration particles */}
        {mounted && [...Array(30)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`,
              backgroundColor: ['#22c55e', '#06b6d4', '#f97316', '#a855f7'][Math.floor(Math.random() * 4)],
              opacity: 0.6
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className={`w-full max-w-md transition-all duration-700 ${mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
          {/* Success Animation */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              {/* Outer ring */}
              <div className="w-32 h-32 rounded-full border-4 border-green-500/30 animate-ping absolute inset-0" />
              
              {/* Main circle */}
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center relative shadow-2xl shadow-green-500/30">
                <CheckCircle2 className="w-14 h-14 text-white" />
              </div>
              
              {/* Clock badge */}
              <div className="absolute -right-2 -bottom-2 w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center shadow-lg animate-float">
                <Clock className="w-7 h-7 text-white" />
              </div>
            </div>
          </div>

          {/* Glass Card */}
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-green-500/20 via-transparent to-cyan-500/20 rounded-3xl blur-xl" />
            
            <div className="relative bg-white/5 backdrop-blur-2xl rounded-3xl border border-white/10 p-8 shadow-2xl text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-green-400 animate-pulse" />
                <h1 className="text-2xl font-bold text-white">Account Created!</h1>
                <Sparkles className="w-5 h-5 text-green-400 animate-pulse" />
              </div>
              
              <p className="text-white/60 mb-6">
                Your account has been created successfully
              </p>

              {/* Steps */}
              <div className="space-y-4 mb-8">
                {[
                  { icon: CheckCircle2, text: 'Account created successfully', done: true },
                  { icon: Clock, text: 'Waiting for admin approval', done: false },
                  { icon: UserCheck, text: 'You will be notified when approved', done: false },
                ].map((item, i) => (
                  <div 
                    key={i}
                    className={`flex items-center gap-4 p-4 rounded-xl transition-all duration-500 ${item.done ? 'bg-green-500/10 border border-green-500/20' : 'bg-white/5 border border-white/10'} ${mounted ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'}`}
                    style={{ transitionDelay: `${400 + i * 150}ms` }}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${item.done ? 'bg-green-500 text-white' : 'bg-amber-500/20 text-amber-400'}`}>
                      <item.icon className="w-5 h-5" />
                    </div>
                    <span className={item.done ? 'text-green-400' : 'text-white/60'}>{item.text}</span>
                  </div>
                ))}
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
                <p className="text-amber-400 text-sm">
                  An administrator will review and approve your account. You can try logging in - if not yet approved, you will see a pending message.
                </p>
              </div>

              <Button asChild className="w-full h-12 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-medium rounded-xl transition-all duration-300">
                <Link href="/auth/login">
                  <LogIn className="mr-2 h-5 w-5" />
                  Go to Sign In
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
