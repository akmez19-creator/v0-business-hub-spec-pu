'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Package, RefreshCw, ArrowLeft } from 'lucide-react'

export default function AuthErrorPage() {
  const [mounted, setMounted] = useState(false)
  const searchParams = useSearchParams()
  const message = searchParams.get('message')
  const error = searchParams.get('error')
  const errorMessage = message || error

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#0a0a1a]">
      {/* Animated Background */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-red-500/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-orange-500/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
        
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
            backgroundSize: '50px 50px'
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className={`w-full max-w-md transition-all duration-700 ${mounted ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
          {/* Error Animation */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              {/* Pulsing ring */}
              <div className="w-32 h-32 rounded-full border-4 border-red-500/30 animate-ping absolute inset-0" style={{ animationDuration: '2s' }} />
              
              {/* Main circle */}
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center relative shadow-2xl shadow-red-500/30 animate-shake">
                <AlertTriangle className="w-14 h-14 text-white" />
              </div>
            </div>
          </div>

          {/* Glass Card */}
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-red-500/20 via-transparent to-orange-500/20 rounded-3xl blur-xl" />
            
            <div className="relative bg-white/5 backdrop-blur-2xl rounded-3xl border border-white/10 p-8 shadow-2xl text-center">
              <h1 className="text-2xl font-bold text-white mb-2">Authentication Error</h1>
              <p className="text-white/60 mb-6">
                Something went wrong during sign in
              </p>

              {/* Error Message */}
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-6">
                <p className="text-red-400 text-sm">
                  {errorMessage || 'An unexpected error occurred. Please try again.'}
                </p>
              </div>

              <div className="space-y-3">
                <Button asChild className="w-full h-12 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-medium rounded-xl transition-all duration-300 hover:scale-[1.02]">
                  <Link href="/auth/login">
                    <RefreshCw className="mr-2 h-5 w-5" />
                    Try Again
                  </Link>
                </Button>
                
                <Button asChild variant="outline" className="w-full h-12 bg-transparent hover:bg-white/10 text-white font-medium rounded-xl border border-white/10 hover:border-white/20 transition-all duration-300">
                  <Link href="/">
                    <ArrowLeft className="mr-2 h-5 w-5" />
                    Go Home
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Logo */}
          <div className="flex justify-center mt-8">
            <div className="flex items-center gap-2 text-white/40">
              <Package className="w-5 h-5" />
              <span className="font-medium">Business Hub</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
