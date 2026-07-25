'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import Image from 'next/image'

// The 2030 Vision rulebook: every rule the TV wall enforces, presented by
// the cat anchor. Each rule = title + plain-language explanation + the exact
// visual indicator it maps to on screen.
interface CatRule {
  tag: string
  tagClass: string
  title: string
  lines: string[]
}

const RULES: CatRule[] = [
  {
    tag: 'League',
    tagClass: 'bg-emerald-500/20 text-emerald-400',
    title: 'Cost/client zones',
    lines: [
      'Green Rs 0\u201350: winning ad, feed it.',
      'Yellow Rs 51\u201375: acceptable, watch it.',
      'Red above Rs 75: burning money, act on it.',
      'Rows rank the whole league best \u2192 worst.',
    ],
  },
  {
    tag: 'Arrows',
    tagClass: 'bg-blue-500/20 text-blue-400',
    title: 'Action arrows on each row',
    lines: [
      '\u2191 green: recommendation to INCREASE budget.',
      '\u2193 red: recommendation to DECREASE budget.',
      'Pulsing arrow: already actioned today \u2014 done.',
      '\u25cf dot: WATCH, no action needed yet.',
    ],
  },
  {
    tag: 'Edited',
    tagClass: 'bg-violet-500/20 text-violet-400',
    title: 'Edit improvement chip',
    lines: [
      'Edited ads show cost vs the moment of the edit.',
      '\u25bc green %: cost dropping since the edit \u2014 improving.',
      '\u25b2 red %: cost got WORSE since the edit.',
      '= gray: no change yet, give it time.',
    ],
  },
  {
    tag: 'Breaking',
    tagClass: 'bg-red-600 text-white',
    title: 'Breaking news priority',
    lines: [
      '1. Stalled edits lead: 2h+ after an edit with no improvement.',
      '2. NO CLIENTS: spend wasted with zero clients.',
      '3. DECREASE calls, then INCREASE calls.',
      'Actioned or switched-off ads leave the ticker.',
    ],
  },
  {
    tag: 'Escalate',
    tagClass: 'bg-orange-500/25 text-orange-400',
    title: 'The 2-hour rule',
    lines: [
      'Every edit gets 2\u20133 hours to prove itself.',
      'Still red and not improving? \u2193 DECREASE MORE.',
      'Cost above Rs 150/client? \u23fb TURN OFF \u2014 pulsing red.',
      'Turning OFF counts as the strongest decrease action.',
    ],
  },
  {
    tag: 'On/Off',
    tagClass: 'bg-red-500/20 text-red-400',
    title: 'Status flips',
    lines: [
      'OFF badge: all campaigns of the product are off.',
      'Turn-OFF shows red in Recent Edits and counts as an action.',
      'Turn-ON is neutral gray \u2014 never a green arrow,',
      'because re-activating is not a performance action.',
    ],
  },
  {
    tag: 'Drill in',
    tagClass: 'bg-blue-500/20 text-blue-400',
    title: 'Click any product row',
    lines: [
      'See exactly which ad campaigns it concerns.',
      '\u00d7N chip = product runs N campaigns.',
      'Expanded view lists every edit those campaigns got today,',
      'timed and colored: green up, red down.',
    ],
  },
  {
    tag: 'Riders',
    tagClass: 'bg-blue-500/15 text-blue-400',
    title: 'Riders panel',
    lines: [
      'Badge = distinct clients on the active delivery batch.',
      'REGIONS toggle expands each rider\u2019s zone coverage.',
      'NO REGIONS amber badge: rider has clients but no localities.',
      'Unassigned row lists localities nobody covers.',
    ],
  },
]

const ROTATE_MS = 9000

export function TvRulesCat({ onClose }: { onClose: () => void }) {
  const [idx, setIdx] = useState(0)

  // Auto-advance through the rulebook like a news segment
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % RULES.length), ROTATE_MS)
    return () => clearInterval(t)
  }, [])

  const rule = RULES[idx]

  return (
    <div className="pointer-events-auto fixed bottom-16 right-6 z-[60] flex items-end gap-2">
      {/* Speech bubble: the current rule, restarting its entrance animation
          on every rotation via the key */}
      <div
        key={idx}
        className="tv-cat-bubble relative mb-10 w-[340px] rounded-2xl border border-cyan-400/30 bg-card/95 p-3 shadow-[0_0_30px_rgba(34,211,238,0.15)] backdrop-blur"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${rule.tagClass}`}>
              {rule.tag}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400/80">2030 Vision</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close rules"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-sm font-bold text-foreground">{rule.title}</p>
        <ul className="mt-1 space-y-0.5">
          {rule.lines.map((line, i) => (
            <li
              key={i}
              className="tv-cat-line text-[12px] leading-snug text-muted-foreground"
              style={{ animationDelay: `${i * 350}ms` }}
            >
              {line}
            </li>
          ))}
        </ul>
        {/* Progress dots + manual navigation */}
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {RULES.map((r, i) => (
            <button
              key={r.tag}
              onClick={() => setIdx(i)}
              aria-label={`Rule: ${r.title}`}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? 'w-5 bg-cyan-400' : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60'
              }`}
            />
          ))}
        </div>
        {/* Bubble tail pointing to the cat */}
        <div className="absolute -right-1.5 bottom-6 h-3 w-3 rotate-45 border-b border-r border-cyan-400/30 bg-card/95" />
      </div>

      {/* The cat anchor: floating idle animation + cyan glow pulse */}
      <div className="tv-cat-float relative h-28 w-28 shrink-0">
        <div className="absolute inset-2 rounded-full bg-cyan-400/20 blur-xl" />
        <Image
          src="/images/tv-cat-2030.png"
          alt="2030 Vision cat anchor presenting the TV mode rules"
          fill
          sizes="112px"
          className="rounded-full object-cover"
        />
      </div>

      <style>{`
        .tv-cat-float { animation: tv-cat-bob 3.2s ease-in-out infinite; }
        @keyframes tv-cat-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        .tv-cat-bubble { animation: tv-cat-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1); }
        @keyframes tv-cat-pop {
          from { opacity: 0; transform: translateY(10px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .tv-cat-line { opacity: 0; animation: tv-cat-fade 0.5s ease forwards; }
        @keyframes tv-cat-fade {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
