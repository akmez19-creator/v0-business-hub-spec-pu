'use client'

import Image from 'next/image'
import { useCallback, useRef, useState } from 'react'

// The VISION 2030 cat: the wall's animated mascot and identity. Idle it
// bobs, tilts, blinks its visor and carries a holographic VISION 2030 tag.
// CLICK IT and it reacts: backflip pose, ring flare, energy burst and a
// bigger 2030 hologram - every click cycles a different reaction.
const REACTIONS = ['tv-cat-react-spin', 'tv-cat-react-jump', 'tv-cat-react-wiggle'] as const

export function TvRulesCat() {
  const [reaction, setReaction] = useState<string | null>(null)
  const [burst, setBurst] = useState(0)
  const clickCount = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onCatClick = useCallback(() => {
    const next = REACTIONS[clickCount.current % REACTIONS.length]
    clickCount.current += 1
    setBurst((b) => b + 1)
    setReaction(null)
    // restart the animation even when the same class repeats
    requestAnimationFrame(() => setReaction(next))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setReaction(null), 1400)
  }, [])

  return (
    <div className="fixed bottom-14 right-5 z-[60] select-none">
      <button
        type="button"
        onClick={onCatClick}
        aria-label="VISION 2030 cat - click me"
        className="tv-cat-float relative block h-28 w-28 cursor-pointer bg-transparent outline-none"
      >
        {/* Pulsing aura (flares on click) */}
        <div className={`tv-cat-aura absolute inset-1 rounded-full bg-cyan-400/20 blur-xl ${reaction ? 'tv-cat-aura-flare' : ''}`} />
        {/* Orbiting scan rings (speed up on click) */}
        <div className={`tv-cat-ring absolute inset-0 rounded-full border border-cyan-400/40 ${reaction ? 'tv-cat-ring-fast' : ''}`} />
        <div className={`tv-cat-ring-2 absolute -inset-1.5 rounded-full border border-cyan-400/15 ${reaction ? 'tv-cat-ring-fast' : ''}`} />
        {/* Energy burst particles on click */}
        {reaction && (
          <div key={burst} className="pointer-events-none absolute inset-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <span
                key={i}
                className="tv-cat-spark absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-cyan-300"
                style={{ ['--angle' as string]: `${i * 45}deg` }}
              />
            ))}
          </div>
        )}
        {/* The cat: idle bob + head tilt, click reaction overrides */}
        <div className={`relative h-full w-full ${reaction ?? 'tv-cat-tilt'}`}>
          <Image
            src="/images/tv-cat-2030.png"
            alt=""
            fill
            sizes="112px"
            className="rounded-full object-cover"
          />
          {/* Visor blink: a sweep of light across the eyes */}
          <div className="tv-cat-blink absolute inset-0 overflow-hidden rounded-full">
            <div className="tv-cat-blink-bar absolute -left-full top-1/3 h-2 w-full bg-cyan-300/30 blur-sm" />
          </div>
        </div>
        {/* Click hologram: a big 2030 flash rising from the cat */}
        {reaction && (
          <span key={`holo-${burst}`} className="tv-cat-holo pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 font-mono text-xl font-black tracking-[0.3em] text-cyan-300">
            2030
          </span>
        )}
      </button>
      {/* Ground shadow that breathes with the bob */}
      <div className="tv-cat-shadow mx-auto -mt-1 h-2 w-16 rounded-full bg-cyan-950/70 blur-sm" />
      {/* Permanent holographic identity tag */}
      <div className="tv-cat-tag mt-1.5 text-center font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-400/90">
        Vision 2030
      </div>

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
        .tv-cat-aura-flare { animation: tv-cat-flare 1.4s ease-out; }
        @keyframes tv-cat-pulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.12); }
        }
        @keyframes tv-cat-flare {
          0% { opacity: 1; transform: scale(1); }
          30% { opacity: 1; transform: scale(1.7); }
          100% { opacity: 0.5; transform: scale(1); }
        }
        .tv-cat-ring { animation: tv-cat-spin 6s linear infinite; border-style: dashed; }
        .tv-cat-ring-2 { animation: tv-cat-spin 10s linear infinite reverse; }
        .tv-cat-ring-fast { animation-duration: 0.7s !important; border-color: rgb(103 232 249 / 0.8) !important; }
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
        .tv-cat-tag { animation: tv-cat-tag-glow 3.2s ease-in-out infinite; text-shadow: 0 0 8px rgb(34 211 238 / 0.6); }
        @keyframes tv-cat-tag-glow {
          0%, 100% { opacity: 0.75; }
          50% { opacity: 1; }
        }
        /* Click reactions */
        .tv-cat-react-spin { animation: tv-cat-spin-once 1.2s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes tv-cat-spin-once {
          0% { transform: rotate(0) scale(1); }
          55% { transform: rotate(360deg) scale(1.18); }
          100% { transform: rotate(360deg) scale(1); }
        }
        .tv-cat-react-jump { animation: tv-cat-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1); transform-origin: 50% 100%; }
        @keyframes tv-cat-jump {
          0% { transform: translateY(0) scale(1); }
          30% { transform: translateY(-26px) scale(1.12, 0.94); }
          55% { transform: translateY(0) scale(0.94, 1.08); }
          72% { transform: translateY(-10px) scale(1.04); }
          100% { transform: translateY(0) scale(1); }
        }
        .tv-cat-react-wiggle { animation: tv-cat-wiggle 1.2s ease-in-out; transform-origin: 50% 80%; }
        @keyframes tv-cat-wiggle {
          0%, 100% { transform: rotate(0); }
          15% { transform: rotate(-14deg) scale(1.1); }
          35% { transform: rotate(12deg) scale(1.14); }
          55% { transform: rotate(-9deg) scale(1.1); }
          75% { transform: rotate(6deg) scale(1.05); }
        }
        .tv-cat-spark { animation: tv-cat-spark-fly 0.9s ease-out forwards; }
        @keyframes tv-cat-spark-fly {
          0% { transform: rotate(var(--angle)) translateX(0); opacity: 1; }
          100% { transform: rotate(var(--angle)) translateX(64px); opacity: 0; }
        }
        .tv-cat-holo { animation: tv-cat-holo-rise 1.3s ease-out forwards; }
        @keyframes tv-cat-holo-rise {
          0% { opacity: 0; transform: translate(-50%, 14px) scale(0.6); }
          25% { opacity: 1; transform: translate(-50%, 0) scale(1.15); }
          60% { opacity: 1; transform: translate(-50%, -6px) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -22px) scale(1.1); }
        }
      `}</style>
    </div>
  )
}
