'use client'

import Image from 'next/image'

// The 2030 Vision cat: a pure animated mascot for the TV wall. No wording,
// no rulebook - just the best animated cat ever: idle bob, ear-perk tilt,
// blinking visor glow, orbiting scan ring, and a soft ground shadow.
export function TvRulesCat() {
  return (
    <div className="pointer-events-none fixed bottom-14 right-5 z-[60]">
      <div className="tv-cat-float relative h-28 w-28">
        {/* Pulsing aura */}
        <div className="tv-cat-aura absolute inset-1 rounded-full bg-cyan-400/20 blur-xl" />
        {/* Orbiting scan ring */}
        <div className="tv-cat-ring absolute inset-0 rounded-full border border-cyan-400/40" />
        <div className="tv-cat-ring-2 absolute -inset-1.5 rounded-full border border-cyan-400/15" />
        {/* The cat itself: bobs, and periodically does a curious head tilt */}
        <div className="tv-cat-tilt relative h-full w-full">
          <Image
            src="/images/tv-cat-2030.png"
            alt="2030 Vision animated cat mascot"
            fill
            sizes="112px"
            className="rounded-full object-cover"
          />
          {/* Visor blink: a sweep of light across the eyes */}
          <div className="tv-cat-blink absolute inset-0 overflow-hidden rounded-full">
            <div className="tv-cat-blink-bar absolute -left-full top-1/3 h-2 w-full bg-cyan-300/30 blur-sm" />
          </div>
        </div>
      </div>
      {/* Ground shadow that breathes with the bob */}
      <div className="tv-cat-shadow mx-auto -mt-1 h-2 w-16 rounded-full bg-cyan-950/70 blur-sm" />

      <style>{`
        .tv-cat-float { animation: tv-cat-bob 3.2s ease-in-out infinite; }
        @keyframes tv-cat-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-9px); }
        }
        .tv-cat-tilt { animation: tv-cat-head 7s ease-in-out infinite; transform-origin: 50% 80%; }
        @keyframes tv-cat-head {
          0%, 78%, 100% { transform: rotate(0deg); }
          82% { transform: rotate(-6deg); }
          88% { transform: rotate(5deg); }
          93% { transform: rotate(-2deg); }
        }
        .tv-cat-aura { animation: tv-cat-pulse 3.2s ease-in-out infinite; }
        @keyframes tv-cat-pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.12); }
        }
        .tv-cat-ring { animation: tv-cat-spin 6s linear infinite; border-style: dashed; }
        .tv-cat-ring-2 { animation: tv-cat-spin 10s linear infinite reverse; }
        @keyframes tv-cat-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .tv-cat-blink-bar { animation: tv-cat-sweep 5s ease-in-out infinite; }
        @keyframes tv-cat-sweep {
          0%, 86%, 100% { left: -100%; }
          92% { left: 100%; }
        }
        .tv-cat-shadow { animation: tv-cat-shadow-breathe 3.2s ease-in-out infinite; }
        @keyframes tv-cat-shadow-breathe {
          0%, 100% { transform: scaleX(1); opacity: 0.7; }
          50% { transform: scaleX(0.72); opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
