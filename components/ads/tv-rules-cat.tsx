'use client'

import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'

// ============================================================================
// VISION 2030 cat: free-standing mascot (no circle), always playing.
// It cycles through 10 idle animations - batting a ball, juggling, chasing
// its tail, pouncing, snoozing... Click it to open the full-screen VISION
// 2030 guide where the cat explains every rule of the wall, navigable with
// arrows, dots, keyboard (left/right/Esc).
// ============================================================================

// The idle playlist: each entry = cat animation class + which props to show
type IdleMode = {
  cat: string
  balls?: ('cyan' | 'orange' | 'violet')[]
  zzz?: boolean
}
const IDLE_MODES: IdleMode[] = [
  { cat: 'cat-anim-bob' }, // 1. gentle breathing sway
  { cat: 'cat-anim-slowblink' }, // 2. contented slow blink (real cat trust signal)
  { cat: 'cat-anim-bat', balls: ['cyan'] }, // 3. batting a rolling ball
  { cat: 'cat-anim-groom' }, // 4. grooming - rhythmic head-down licks
  { cat: 'cat-anim-tilt' }, // 5. curious head tilt
  { cat: 'cat-anim-earflick' }, // 6. quick ear-flick shiver
  { cat: 'cat-anim-bounce', balls: ['orange'] }, // 7. hopping with a bouncing ball
  { cat: 'cat-anim-tailchase' }, // 8. chasing its tail
  { cat: 'cat-anim-stalk' }, // 9. low crouch-stalk creep
  { cat: 'cat-anim-juggle', balls: ['cyan', 'orange', 'violet'] }, // 10. juggling three balls
  { cat: 'cat-anim-stretch' }, // 11. big cat stretch
  { cat: 'cat-anim-knead' }, // 12. happy kneading (making biscuits)
  { cat: 'cat-anim-pounce', balls: ['violet'] }, // 13. pouncing on a ball
  { cat: 'cat-anim-wiggle' }, // 14. happy wiggle
  { cat: 'cat-anim-snooze', zzz: true }, // 15. quick snooze
]

// ON-DUTY playlist: while ACTION NEEDED has items the cat stops playing and
// works the news line - pacing, pointing at the ticker below, sounding the
// alarm. Same rotation logic as the idle playlist, different energy.
const ALERT_MODES: IdleMode[] = [
  { cat: 'cat-anim-alarm' }, // 1. urgent alarm hop
  { cat: 'cat-anim-pointdown' }, // 2. dipping toward the ticker below
  { cat: 'cat-anim-pace' }, // 3. anxious quick pacing
  { cat: 'cat-anim-crouch' }, // 4. tense low crouch, ready to strike
  { cat: 'cat-anim-headshake' }, // 5. disapproving head shake
  { cat: 'cat-anim-alarm' }, // 6. alarm again - it IS urgent
  { cat: 'cat-anim-pointdown' }, // 7. back to pointing at the queue
]

const BALL_COLORS: Record<string, string> = {
  cyan: 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]',
  orange: 'bg-orange-400 shadow-[0_0_10px_rgba(251,146,60,0.9)]',
  violet: 'bg-violet-400 shadow-[0_0_10px_rgba(167,139,250,0.9)]',
}

// The guide slides: the cat explains every rule and indicator on the wall
const GUIDE_SLIDES: { title: string; icon: string; lines: string[] }[] = [
  {
    title: 'Cost / Client Zones',
    icon: '\u25cf',
    lines: [
      'GREEN Rs 0-50: winning ads. Feed them more budget.',
      'YELLOW Rs 51-75: healthy. Watch them, no panic.',
      'RED above Rs 75: burning money. Act today.',
      'Every product row carries its zone color bar on the left.',
    ],
  },
  {
    title: 'Action Arrows',
    icon: '\u2191\u2193',
    lines: [
      'Green \u2191 = recommendation to INCREASE budget.',
      'Red \u2193 = recommendation to DECREASE budget.',
      'Pulsing arrow = already actioned today - the edit was detected.',
      'A dot \u00b7 means watch: no action needed yet.',
    ],
  },
  {
    title: 'Edit Improvement Chip',
    icon: '\u25bc%',
    lines: [
      'Products edited today show a chip next to their cost.',
      'Green \u25bc = cost per client DROPPED since the edit. It is working.',
      'Red \u25b2 = cost got WORSE since the edit.',
      'Gray = means no change yet. Hover for the full Rs journey.',
    ],
  },
  {
    title: 'Breaking News Ticker',
    icon: '\u25a0',
    lines: [
      'The red band at the bottom is the action queue.',
      'Priority order: stalled edits first, then NO CLIENTS spenders,',
      'then DECREASE candidates, then INCREASE winners.',
      'When a product is actioned it leaves the ticker automatically.',
    ],
  },
  {
    title: 'The 2-Hour Rule',
    icon: '\u23f1',
    lines: [
      'An edit gets 2 hours to prove itself.',
      'Still not improving after 2h and in the red zone?',
      'It re-enters breaking news: \u2193 DECREASE MORE.',
      'Above Rs 150/client: pulsing \u23fb TURN OFF. No mercy.',
    ],
  },
  {
    title: 'ON / OFF Logic',
    icon: '\u23fb',
    lines: [
      'Turning an ad OFF counts as a real action - spend cut to zero.',
      'OFF products show a red OFF badge and dim out.',
      'Turning ON is neutral: visible in Recent Edits, gray, never',
      'counted as an action and never flashes green.',
    ],
  },
  {
    title: 'Product Drill-Down',
    icon: '\u25b8',
    lines: [
      'Click any product row to expand it.',
      'You see every ad campaign it concerns: status, name, spend.',
      'Below: every edit those campaigns received today, timed.',
      '\u00d7N chip = the product runs N campaigns.',
    ],
  },
  {
    title: 'Riders & Targets',
    icon: '\u2691',
    lines: [
      'Each rider shows clients/target: blue on track, amber at 80%,',
      'green when the target is met.',
      'Toggle REGIONS for locality coverage and \u2212/+ target controls.',
      'Targets sync live with the Regions admin module.',
    ],
  },
]

// Parse the AI briefing plain-text protocol ("[emoji] TITLE" header lines
// followed by body lines, blank line between sections) into cards. Falls
// back to a single untitled section for free-form text, and strips any
// stray markdown so asterisks never reach the screen.
function parseBriefing(text: string): { icon: string; title: string; lines: string[] }[] {
  const cleaned = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,4}\s*/gm, '')
  const blocks = cleaned.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const sections: { icon: string; title: string; lines: string[] }[] = []
  // Header = optional emoji(s) + a SHORT mostly-uppercase title on its own line
  const headerRe = /^(\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*)?\s*([A-Z][A-Z0-9 /&'!-]{1,28})$/u
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const m = lines[0]?.match(headerRe)
    if (m && lines.length > 0) {
      sections.push({ icon: m[1] || '', title: m[2].trim(), lines: lines.slice(1) })
    } else if (sections.length > 0 && sections[sections.length - 1].lines.length === 0) {
      sections[sections.length - 1].lines = lines
    } else {
      sections.push({ icon: '', title: '', lines })
    }
  }
  return sections.length > 0 ? sections : [{ icon: '', title: '', lines: [cleaned] }]
}

export function TvRulesCat({
  getSnapshot,
  alertCount = 0,
}: {
  getSnapshot?: () => unknown
  // Live ACTION NEEDED count from the breaking-news ticker. > 0 flips the
  // cat into on-duty mode: red glow, urgent animations, count badge, and it
  // rides the ticker's top edge. 0 = playtime.
  alertCount?: number
}) {
  const [modeIdx, setModeIdx] = useState(0)
  const [guideOpen, setGuideOpen] = useState(false)
  const [slide, setSlide] = useState(0)
  const onDuty = alertCount > 0
  // Overlay view: the AI briefing is the default, rules guide one tab away
  const [view, setView] = useState<'briefing' | 'guide'>('briefing')

  // ---- The cat's AI briefing: a ChatGPT-written paragraph (with emojis)
  // covering everything on the wall. Refreshed on click and every 30 min.
  const [briefing, setBriefing] = useState<string | null>(null)
  const [briefingAt, setBriefingAt] = useState<Date | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [hasFresh, setHasFresh] = useState(false)

  const fetchBriefing = useCallback(async () => {
    if (!getSnapshot) return
    setBriefingLoading(true)
    try {
      const res = await fetch('/api/ads/ai-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getSnapshot()),
      })
      const json = await res.json()
      if (json.success && json.briefing) {
        setBriefing(json.briefing)
        setBriefingAt(new Date())
        setHasFresh(true)
      }
    } catch {
      // keep the previous briefing on failure
    } finally {
      setBriefingLoading(false)
    }
  }, [getSnapshot])

  // Auto-brief: first one shortly after mount (lets wall data load), then
  // every 30 minutes so the wall always carries a current AI read
  useEffect(() => {
    if (!getSnapshot) return
    const first = setTimeout(fetchBriefing, 20_000)
    const loop = setInterval(fetchBriefing, 30 * 60 * 1000)
    return () => {
      clearTimeout(first)
      clearInterval(loop)
    }
  }, [fetchBriefing, getSnapshot])

  // ---- Live agent comms: who is logging entries right now (last 10 min),
  // on which products, how many entries. Polled every 60s.
  const [agentFeed, setAgentFeed] = useState<{
    totalEntries: number
    agents: { agent: string; entries: number; products: string[]; lastEntryAt: string }[]
  } | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch('/api/ads/agent-activity')
        const json = await res.json()
        if (alive && json.success) {
          setAgentFeed({ totalEntries: json.totalEntries, agents: json.agents })
        }
      } catch {
        // keep last feed on failure
      }
    }
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  // Rotate the active playlist (idle when clear, alert when on duty) -
  // urgent moves rotate faster. Paused while the overlay is open.
  useEffect(() => {
    if (guideOpen) return
    const playlist = onDuty ? ALERT_MODES : IDLE_MODES
    const t = setInterval(() => setModeIdx((i) => (i + 1) % playlist.length), onDuty ? 3200 : 4500)
    return () => clearInterval(t)
  }, [guideOpen, onDuty])

  // Restart the rotation cleanly whenever duty state flips
  useEffect(() => {
    setModeIdx(0)
  }, [onDuty])

  // Keyboard navigation for the guide: left/right arrows + Escape
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!guideOpen) return
      if (e.key === 'Escape') setGuideOpen(false)
      if (view !== 'guide') return // arrows only page the rules slides
      if (e.key === 'ArrowRight') setSlide((s) => (s + 1) % GUIDE_SLIDES.length)
      if (e.key === 'ArrowLeft') setSlide((s) => (s - 1 + GUIDE_SLIDES.length) % GUIDE_SLIDES.length)
    },
    [guideOpen, view],
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  const playlist = onDuty ? ALERT_MODES : IDLE_MODES
  const mode = playlist[modeIdx % playlist.length]
  const current = GUIDE_SLIDES[slide]

  // ---- The cat's VOICE: every animation mode has a matching status line,
  // so the comms box always narrates exactly what the cat is doing. The
  // typewriter re-runs on each mode change (keyed by modeIdx).
  const CAT_LINES: Record<string, string> = {
    // on-duty narration - tied to the ACTION NEEDED queue
    'cat-anim-alarm': `SOUNDING ALARM \u2014 ${alertCount} NEED ACTION`,
    'cat-anim-pointdown': 'LOOK DOWN \u2014 THE TICKER HAS THEM',
    'cat-anim-pace': 'PACING UNTIL THESE GET FIXED\u2026',
    'cat-anim-crouch': 'LOCKED ON \u2014 READY TO STRIKE',
    'cat-anim-headshake': 'THESE NUMBERS? UNACCEPTABLE.',
    // playtime narration - wall is clean
    'cat-anim-bob': 'ALL CLEAR \u2014 WALL IS PURRING',
    'cat-anim-slowblink': 'SLOW BLINK \u2014 I TRUST THESE NUMBERS',
    'cat-anim-bat': 'BATTING PRACTICE \u2014 ZERO ALERTS',
    'cat-anim-groom': 'GROOMING BREAK \u2014 ALL TIDY',
    'cat-anim-earflick': 'EAR FLICK \u2014 JUST STATIC, NO ALERTS',
    'cat-anim-stalk': 'STALKING MODE \u2014 WATCHING THE SPEND',
    'cat-anim-knead': 'MAKING BISCUITS \u2014 PROFITS RISING',
    'cat-anim-tilt': 'SCANNING\u2026 NOTHING SUSPICIOUS',
    'cat-anim-bounce': 'BOUNCE CHECK \u2014 ALL GREEN',
    'cat-anim-tailchase': 'CHASING TAIL, NOT PROBLEMS',
    'cat-anim-juggle': 'JUGGLING BALLS, NOT BUDGETS',
    'cat-anim-stretch': 'BIG STRETCH \u2014 SYSTEMS NOMINAL',
    'cat-anim-pounce': 'POUNCE DRILL \u2014 STAYING SHARP',
    'cat-anim-wiggle': 'HAPPY WIGGLE \u2014 NUMBERS LOOK GOOD',
    'cat-anim-snooze': 'POWER NAP \u2014 WAKE ME IF IT GOES RED',
  }
  const catLine = CAT_LINES[mode.cat] ?? (onDuty ? 'ON DUTY' : 'ON PATROL')
  const isSnoozing = mode.cat === 'cat-anim-snooze'
  const isAlarming = mode.cat === 'cat-anim-alarm'

  return (
    <>
      {/* ================= The cat, one system with breaking news =========
          CLEAR wall: playtime - slow stroll, balls, cyan glow.
          ACTION NEEDED: on duty - it rides the ticker's top edge, glows the
          ticker's red, paces faster, points at the queue, and wears the same
          alert count the red bar shows. The rail is click-through; only the
          cat is interactive. Clicking it opens the AI briefing. */}
      <div
        className={`${onDuty ? 'cat-wander-duty bottom-9' : 'cat-wander bottom-2'} pointer-events-none fixed left-0 z-[60] select-none transition-[bottom] duration-700`}
      >
        <div className={`${onDuty ? 'cat-face-duty' : 'cat-face'} pointer-events-auto`}>
        <button
          type="button"
          onClick={() => {
            setView('briefing')
            setHasFresh(false)
            setGuideOpen(true)
            // Refresh if we have nothing yet or the last brief is >10 min old
            if (!briefing || (briefingAt && Date.now() - briefingAt.getTime() > 10 * 60 * 1000)) {
              fetchBriefing()
            }
          }}
          aria-label="Open the AI wall briefing"
          className="relative block h-28 w-28 cursor-pointer bg-transparent outline-none"
          title="Click me - AI update on the whole wall"
        >
          {/* Fresh-briefing ping: a soft pulse until the update is read */}
          {hasFresh && !onDuty && (
            <span className="absolute -top-1 right-3 z-10 flex h-3.5 w-3.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-cyan-400" />
            </span>
          )}
          {/* On duty: the cat wears the SAME count as the ACTION NEEDED bar,
              in the same red, flip-proof so it never mirrors while walking */}
          {onDuty && (
            <span className="cat-badge-upright absolute -top-1.5 right-1 z-10 flex min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-white shadow-[0_0_12px_rgba(220,38,38,0.8)]">
              {alertCount}
            </span>
          )}
          {/* The cat itself: free, no circle, glow via drop-shadow - cyan at
              play, breaking-news red while on duty */}
          <div key={`${onDuty}-${modeIdx}`} className={`relative h-full w-full ${mode.cat}`}>
            <Image
              src="/images/tv-cat-realistic.png"
              alt=""
              fill
              sizes="128px"
              className={`object-contain transition-[filter] duration-700 ${
                onDuty
                  ? '[filter:drop-shadow(0_0_16px_rgba(239,68,68,0.65))]'
                  : '[filter:drop-shadow(0_0_14px_rgba(34,211,238,0.45))]'
              }`}
            />
            {/* Visor light sweep - red and twice as frequent on duty */}
            <div className="pointer-events-none absolute inset-x-3 top-1/3 h-2 overflow-hidden">
              <div
                className={`absolute -left-full h-full w-full blur-sm ${
                  onDuty ? 'cat-blink-bar-duty bg-red-400/50' : 'cat-blink-bar bg-cyan-300/40'
                }`}
              />
            </div>
            {/* Duty siren: a soft red pulse ring off the visor */}
            {onDuty && (
              <span className="cat-siren pointer-events-none absolute left-1/2 top-1/4 h-8 w-8 -translate-x-1/2 rounded-full border-2 border-red-500/70" />
            )}
          </div>

          {/* Play balls, per mode */}
          {mode.balls?.map((color, i) => (
            <span
              key={`${modeIdx}-${color}`}
              className={`cat-ball absolute h-3.5 w-3.5 rounded-full ${BALL_COLORS[color]} ${
                mode.cat === 'cat-anim-bat'
                  ? 'cat-ball-roll bottom-0 left-0'
                  : mode.cat === 'cat-anim-bounce'
                    ? 'cat-ball-bounce bottom-0 right-1'
                    : mode.cat === 'cat-anim-pounce'
                      ? 'cat-ball-flee bottom-0 left-2'
                      : 'cat-ball-juggle bottom-8 left-1/2'
              }`}
              style={{ ['--i' as string]: i, animationDelay: mode.cat === 'cat-anim-juggle' ? `${i * 0.33}s` : undefined }}
            />
          ))}

          {/* Snooze Zzz */}
          {mode.zzz && (
            <span className="pointer-events-none absolute -top-2 right-2 font-mono text-base font-bold text-cyan-300/90">
              <span className="cat-zzz inline-block">z</span>
              <span className="cat-zzz inline-block text-lg" style={{ animationDelay: '0.4s' }}>z</span>
              <span className="cat-zzz inline-block text-xl" style={{ animationDelay: '0.8s' }}>Z</span>
            </span>
          )}
        </button>

        {/* Breathing ground shadow - matches the mood */}
        <div
          className={`cat-shadow mx-auto -mt-2 h-2 w-20 rounded-full blur-sm transition-colors duration-700 ${
            onDuty ? 'bg-red-950/80' : 'bg-cyan-950/70'
          }`}
        />
        </div>

        {/* ===== CAT COMMS: the cat's voice terminal. Anchored to the cat's
            BODY (vertically centered on it, tail meeting its shoulder), it
            sits outside the flipping wrapper so text never mirrors. Fully
            synchronized with the cat's state machine:
            - narrates the exact animation playing (typewriter per mode)
            - mirrors the mood (cyan play / red duty, 700ms cross-fade)
            - shakes WITH the alarm hop, dims WITH the snooze
            - lists live agents + their products + 10-min entry counts */}
        <div
          className={`absolute left-full top-1/2 ml-3 w-60 -translate-y-1/2 rounded-lg border shadow-lg backdrop-blur-md transition-colors duration-700 ${
            onDuty
              ? 'border-red-500/30 bg-red-950/70 shadow-red-950/50'
              : 'border-cyan-400/30 bg-cyan-950/60 shadow-cyan-950/50'
          } ${isAlarming ? 'comms-shake' : ''} ${isSnoozing ? 'opacity-60' : 'opacity-100'} transition-opacity`}
        >
          {/* speech tail - vertically centered, meets the cat's shoulder */}
          <span
            className={`absolute -left-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rotate-45 border-b border-l transition-colors duration-700 ${
              onDuty ? 'border-red-500/30 bg-red-950/70' : 'border-cyan-400/30 bg-cyan-950/60'
            }`}
          />
          {/* header: unit name + live entry rate */}
          <div
            className={`flex items-center justify-between gap-2 border-b px-2.5 py-1 transition-colors duration-700 ${
              onDuty ? 'border-red-500/20' : 'border-cyan-400/20'
            }`}
          >
            <span
              className={`font-mono text-[9px] font-black uppercase tracking-[0.25em] transition-colors duration-700 ${
                onDuty ? 'text-red-400' : 'text-cyan-400'
              }`}
            >
              Cat comms
            </span>
            <span className="flex items-center gap-1">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isSnoozing
                    ? 'bg-slate-500'
                    : isAlarming
                      ? 'animate-ping bg-red-400 shadow-[0_0_5px_rgba(248,113,113,0.9)]'
                      : 'animate-pulse bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.9)]'
                }`}
              />
              <span className="font-mono text-[9px] font-bold tabular-nums text-emerald-400">
                {agentFeed ? `${agentFeed.totalEntries} / 10min` : '\u2014'}
              </span>
            </span>
          </div>
          {/* the cat SPEAKS: narration of the exact animation playing right
              now, retyped on every mode change */}
          <div className={`border-b px-2.5 py-1.5 transition-colors duration-700 ${onDuty ? 'border-red-500/20' : 'border-cyan-400/20'}`}>
            <p
              key={`${onDuty}-${modeIdx}`}
              className={`comms-type overflow-hidden whitespace-nowrap font-mono text-[10px] font-black tracking-wider transition-colors duration-700 ${
                onDuty ? 'text-red-300' : 'text-cyan-300'
              }`}
            >
              {'> '}
              {catLine}
            </p>
          </div>
          {/* live agents on the line */}
          <div className="space-y-1 px-2.5 py-1.5">
            {agentFeed && agentFeed.agents.length > 0 ? (
              agentFeed.agents.slice(0, 3).map((a) => (
                <div key={a.agent} className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-bold uppercase tracking-wide text-foreground">
                      {a.agent}
                    </span>
                    <span
                      className={`shrink-0 font-mono text-[10px] font-black tabular-nums transition-colors duration-700 ${
                        onDuty ? 'text-red-300' : 'text-cyan-300'
                      }`}
                    >
                      {a.entries} {a.entries === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>
                  <p className="truncate text-[9px] leading-tight text-muted-foreground" title={a.products.join(', ')}>
                    {a.products.join(' \u00b7 ') || 'logging\u2026'}
                  </p>
                </div>
              ))
            ) : (
              <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                No agents on the line
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ================= Full-screen VISION 2030 guide ================= */}
      {guideOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 backdrop-blur-md"
          onClick={() => setGuideOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Vision guide"
        >
          {/* Grid backdrop for the 2030 feel */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(34,211,238,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.6)_1px,transparent_1px)] [background-size:48px_48px]" />

          <div
            className="guide-enter relative mx-4 flex w-full max-w-5xl items-stretch gap-0 overflow-hidden rounded-2xl border border-cyan-400/30 bg-[#070b16] shadow-[0_0_80px_rgba(34,211,238,0.15)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left: the cat presenting */}
            <div className="relative hidden w-72 shrink-0 flex-col items-center justify-end overflow-hidden border-r border-cyan-400/15 pb-6 sm:flex">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_70%,rgba(34,211,238,0.14),transparent_65%)]" />
              <div className="guide-cat relative h-52 w-52">
                <Image
                  src="/images/tv-cat-realistic.png"
                  alt="The Vision cat presenter"
                  fill
                  sizes="208px"
                  className="object-contain [filter:drop-shadow(0_0_20px_rgba(34,211,238,0.5))]"
                />
              </div>
              <div className="cat-shadow mx-auto h-2.5 w-28 rounded-full bg-cyan-950 blur-sm" />
              <p className="mt-3 text-[11px] text-cyan-100/50">
                {view === 'briefing' ? 'Your AI wall update' : 'The wall, explained'}
              </p>
            </div>

            {/* Right: AI briefing (default) or the rules guide */}
            <div className="flex min-h-[380px] flex-1 flex-col p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                {/* View tabs */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setView('briefing')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                      view === 'briefing'
                        ? 'bg-cyan-400 text-cyan-950'
                        : 'border border-cyan-400/25 text-cyan-200/70 hover:bg-cyan-400/10'
                    }`}
                  >
                    AI Update
                  </button>
                  <button
                    onClick={() => setView('guide')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                      view === 'guide'
                        ? 'bg-cyan-400 text-cyan-950'
                        : 'border border-cyan-400/25 text-cyan-200/70 hover:bg-cyan-400/10'
                    }`}
                  >
                    The Rules
                  </button>
                </div>
                <button
                  onClick={() => setGuideOpen(false)}
                  aria-label="Close"
                  className="rounded-lg border border-cyan-400/20 p-2 text-cyan-200/70 transition-colors hover:bg-cyan-400/10 hover:text-cyan-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {view === 'briefing' ? (
                <>
                  {/* ---- The AI paragraph, refreshed on demand / every 30 min ---- */}
                  <div className="mt-5 flex-1 overflow-y-auto">
                    {briefingLoading && !briefing ? (
                      <div className="flex h-full flex-col items-center justify-center gap-3 text-cyan-200/70">
                        <span className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400" />
                        <p className="text-sm">Reading the whole wall{'\u2026'}</p>
                      </div>
                    ) : briefing ? (
                      /* Structured section cards: emoji + title header, short
                         lines beneath - scannable from across the room */
                      <div key={briefingAt?.getTime()} className="space-y-3">
                        {parseBriefing(briefing).map((section, i) => (
                          <div
                            key={i}
                            className="guide-line rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4"
                            style={{ animationDelay: `${0.08 + i * 0.12}s` }}
                          >
                            {section.title && (
                              <p className="mb-2 flex items-center gap-2 font-mono text-xs font-black uppercase tracking-[0.25em] text-cyan-400">
                                {section.icon && <span className="text-base tracking-normal">{section.icon}</span>}
                                {section.title}
                              </p>
                            )}
                            <div className="space-y-1.5">
                              {section.lines.map((line, j) => (
                                <p key={j} className="text-base leading-relaxed text-cyan-50/95">
                                  {line}
                                </p>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <p className="text-sm text-cyan-200/60">
                          No update yet {'\u2014'} hit Refresh and I{'\u2019'}ll read the wall for you.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <p className="text-[11px] text-cyan-100/40">
                      {briefingAt
                        ? `Updated ${briefingAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} \u00b7 auto every 30 min`
                        : 'Auto-updates every 30 min'}
                    </p>
                    <button
                      onClick={fetchBriefing}
                      disabled={briefingLoading}
                      className="flex h-10 items-center gap-2 rounded-lg bg-cyan-400 px-4 text-sm font-bold text-cyan-950 transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {briefingLoading && (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-950/30 border-t-cyan-950" />
                      )}
                      Refresh
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-5">
                    <p className="font-mono text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-400/70">
                      Rule {slide + 1} / {GUIDE_SLIDES.length}
                    </p>
                    <h2 key={`t-${slide}`} className="guide-line mt-1 text-balance text-2xl font-black text-cyan-50 sm:text-3xl">
                      <span className="mr-2 text-cyan-400">{current.icon}</span>
                      {current.title}
                    </h2>
                  </div>

                  {/* The cat's speech: lines animate in one after the other */}
                  <div key={`s-${slide}`} className="mt-6 flex-1 space-y-3">
                    {current.lines.map((line, i) => (
                      <p
                        key={i}
                        className="guide-line flex items-start gap-2.5 text-base leading-relaxed text-cyan-100/90 sm:text-lg"
                        style={{ animationDelay: `${0.12 + i * 0.14}s` }}
                      >
                        <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                        {line}
                      </p>
                    ))}
                  </div>

                  {/* Navigation: prev / dots / next - plus arrow keys and Esc */}
                  <div className="mt-6 flex items-center justify-between gap-3">
                    <button
                      onClick={() => setSlide((s) => (s - 1 + GUIDE_SLIDES.length) % GUIDE_SLIDES.length)}
                      aria-label="Previous rule"
                      className="flex h-10 items-center gap-1 rounded-lg border border-cyan-400/25 px-3 text-sm font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/10"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Prev
                    </button>
                    <div className="flex items-center gap-1.5">
                      {GUIDE_SLIDES.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setSlide(i)}
                          aria-label={`Go to rule ${i + 1}`}
                          className={`h-2 rounded-full transition-all ${
                            i === slide ? 'w-6 bg-cyan-400' : 'w-2 bg-cyan-400/25 hover:bg-cyan-400/50'
                          }`}
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => setSlide((s) => (s + 1) % GUIDE_SLIDES.length)}
                      aria-label="Next rule"
                      className="flex h-10 items-center gap-1 rounded-lg bg-cyan-400 px-3 text-sm font-bold text-cyan-950 transition-opacity hover:opacity-90"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-3 text-center text-[10px] uppercase tracking-widest text-cyan-100/30">
                    {'\u2190'} {'\u2192'} arrow keys {'\u00b7'} Esc to close
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* ---------- the wall stroll ----------
           The cat owns the full width of the TV: it slowly walks from the
           left edge to the right edge and back (90s round trip), flipping
           to face its walking direction exactly at the turnaround points. */
        .cat-wander { animation: catWander 90s linear infinite; }
        @keyframes catWander {
          0% { transform: translateX(0); }
          50% { transform: translateX(calc(100vw - 24rem)); }
          100% { transform: translateX(0); }
        }
        .cat-face { animation: catFace 90s step-end infinite; }
        @keyframes catFace {
          0%, 49.999% { transform: scaleX(1); }
          50%, 100% { transform: scaleX(-1); }
        }

        /* ---------- ON DUTY: riding the breaking-news line ----------
           The ticker scrolls its stories leftward; the on-duty cat patrols
           the same line on a faster 40s beat, facing its walking direction,
           like an anchor pacing the newsroom. */
        .cat-wander-duty { animation: catWanderDuty 40s linear infinite; }
        @keyframes catWanderDuty {
          0% { transform: translateX(calc(100vw - 24rem)); }
          50% { transform: translateX(0); }
          100% { transform: translateX(calc(100vw - 24rem)); }
        }
        .cat-face-duty { animation: catFaceDuty 40s step-end infinite; }
        @keyframes catFaceDuty {
          0%, 49.999% { transform: scaleX(-1); }
          50%, 100% { transform: scaleX(1); }
        }
        /* Counter-flip so the count badge reads correctly in both directions */
        .cat-face-duty .cat-badge-upright { animation: catBadgeFlip 40s step-end infinite; }
        @keyframes catBadgeFlip {
          0%, 49.999% { transform: scaleX(-1); }
          50%, 100% { transform: scaleX(1); }
        }

        /* ---------- on-duty playlist ---------- */
        .cat-anim-alarm { animation: catAlarm 0.55s cubic-bezier(0.36,0.07,0.19,0.97) infinite; transform-origin: 50% 100%; }
        @keyframes catAlarm {
          0%, 100% { transform: translateY(0) rotate(0); }
          20% { transform: translateY(-7px) rotate(-4deg); }
          40% { transform: translateY(0) rotate(3deg); }
          60% { transform: translateY(-5px) rotate(-2deg); }
          80% { transform: translateY(0) rotate(1deg); }
        }
        .cat-anim-pointdown { animation: catPointDown 1.6s ease-in-out infinite; transform-origin: 50% 100%; }
        @keyframes catPointDown {
          0%, 100% { transform: translateY(0) rotate(0) scale(1); }
          35% { transform: translateY(5px) rotate(10deg) scale(1.04, 0.94); }
          55% { transform: translateY(6px) rotate(12deg) scale(1.05, 0.93); }
          75% { transform: translateY(2px) rotate(4deg) scale(1.01, 0.99); }
        }
        .cat-anim-pace { animation: catPace 0.9s ease-in-out infinite; transform-origin: 50% 100%; }
        @keyframes catPace {
          0%, 100% { transform: translateX(-10px) skewX(2deg); }
          50% { transform: translateX(10px) skewX(-2deg); }
        }
        .cat-anim-headshake { animation: catHeadshake 1.3s ease-in-out infinite; transform-origin: 50% 85%; }
        @keyframes catHeadshake {
          0%, 100% { transform: rotate(0); }
          20% { transform: rotate(-9deg); }
          40% { transform: rotate(8deg); }
          60% { transform: rotate(-6deg); }
          80% { transform: rotate(4deg); }
        }
        .cat-blink-bar-duty { animation: catBlinkSweepDuty 2.2s ease-in-out infinite; }
        @keyframes catBlinkSweepDuty { 0%, 70%, 100% { left: -100%; } 85% { left: 100%; } }
        .cat-siren { animation: catSiren 1.4s ease-out infinite; }
        @keyframes catSiren {
          0% { opacity: 0.8; transform: translateX(-50%) scale(0.5); }
          100% { opacity: 0; transform: translateX(-50%) scale(2.2); }
        }

        /* ---------- realistic cat motions ---------- */
        /* Slow blink: a real cat's trust signal - long, lazy eyelid squash */
        .cat-anim-slowblink { animation: catSlowBlink 4.5s ease-in-out infinite; transform-origin: 50% 85%; }
        @keyframes catSlowBlink {
          0%, 38%, 62%, 100% { transform: scaleY(1); }
          46%, 54% { transform: scaleY(0.94) translateY(2px); }
          50% { transform: scaleY(0.90) translateY(3px); }
        }
        /* Grooming: rhythmic head-dip licks toward a raised paw */
        .cat-anim-groom { animation: catGroom 1.6s ease-in-out infinite; transform-origin: 50% 90%; }
        @keyframes catGroom {
          0%, 100% { transform: rotate(0deg) translateY(0); }
          20% { transform: rotate(-7deg) translateY(3px) scaleY(0.96); }
          35% { transform: rotate(-4deg) translateY(1px); }
          55% { transform: rotate(-8deg) translateY(3px) scaleY(0.95); }
          70% { transform: rotate(-3deg) translateY(1px); }
        }
        /* Ear flick: sudden tiny shiver from the head, body barely moves */
        .cat-anim-earflick { animation: catEarflick 2.8s ease-in-out infinite; transform-origin: 55% 20%; }
        @keyframes catEarflick {
          0%, 74%, 100% { transform: rotate(0deg); }
          76% { transform: rotate(2.5deg); }
          79% { transform: rotate(-2deg); }
          82% { transform: rotate(1.2deg); }
          85% { transform: rotate(0deg); }
        }
        /* Crouch-stalk: dropped low, slow forward creep with frozen pauses */
        .cat-anim-stalk { animation: catStalk 3.6s ease-in-out infinite; transform-origin: 50% 100%; }
        @keyframes catStalk {
          0%, 100% { transform: translateX(0) scaleY(1); }
          20% { transform: translateX(3px) scaleY(0.86) translateY(5px); }
          40% { transform: translateX(7px) scaleY(0.86) translateY(5px); }
          55% { transform: translateX(7px) scaleY(0.85) translateY(6px); } /* freeze */
          75% { transform: translateX(12px) scaleY(0.88) translateY(4px); }
          90% { transform: translateX(4px) scaleY(0.97) translateY(1px); }
        }
        /* Kneading: alternating gentle left-right press, "making biscuits" */
        .cat-anim-knead { animation: catKnead 1.1s ease-in-out infinite; transform-origin: 50% 95%; }
        @keyframes catKnead {
          0%, 100% { transform: rotate(-1.5deg) translateY(1px) scaleY(0.985); }
          50% { transform: rotate(1.5deg) translateY(1px) scaleY(0.985); }
        }
        /* Tense crouch (on duty): low, coiled, micro-trembling with intent */
        .cat-anim-crouch { animation: catCrouch 2.4s ease-in-out infinite; transform-origin: 50% 100%; }
        @keyframes catCrouch {
          0%, 100% { transform: scaleY(0.88) translateY(5px); }
          10% { transform: scaleY(0.87) translateY(5px) translateX(-1px); }
          20% { transform: scaleY(0.88) translateY(5px) translateX(1px); }
          30% { transform: scaleY(0.87) translateY(5px) translateX(-1px); }
          40% { transform: scaleY(0.88) translateY(5px); }
          70% { transform: scaleY(0.86) translateY(6px); } /* deepest coil */
          85% { transform: scaleY(0.90) translateY(4px); }
        }

        /* ---------- comms box, synced to the cat ---------- */
        /* Typewriter: retypes the status line on every mode change */
        .comms-type { animation: commsType 0.9s steps(30, end); }
        @keyframes commsType { 0% { max-width: 0; } 100% { max-width: 100%; } }
        /* Alarm shake: SAME 0.55s beat as the cat's alarm hop, so the box
           rattles in step with the cat jumping */
        .comms-shake { animation: commsShake 0.55s cubic-bezier(0.36,0.07,0.19,0.97) infinite; }
        @keyframes commsShake {
          0%, 100% { transform: translateY(-50%) translateX(0); }
          20% { transform: translateY(calc(-50% - 2px)) translateX(-1px); }
          40% { transform: translateY(-50%) translateX(1px); }
          60% { transform: translateY(calc(-50% - 1px)) translateX(-1px); }
          80% { transform: translateY(-50%) translateX(1px); }
        }

        /* ---------- idle playlist (10 animations) ---------- */
        .cat-anim-bob { animation: catBob 3.2s ease-in-out infinite; }
        @keyframes catBob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }

        .cat-anim-tilt { animation: catTilt 4.4s ease-in-out infinite; transform-origin: 50% 85%; }
        @keyframes catTilt {
          0%, 55%, 100% { transform: rotate(0); }
          65% { transform: rotate(-8deg); } 78% { transform: rotate(6deg); } 88% { transform: rotate(-3deg); }
        }

        .cat-anim-bat { animation: catBat 1.5s ease-in-out infinite; transform-origin: 50% 100%; }
        @keyframes catBat {
          0%, 100% { transform: rotate(0); }
          25% { transform: rotate(-7deg) translateX(-4px); }
          75% { transform: rotate(7deg) translateX(4px); }
        }
        .cat-ball-roll { animation: ballRoll 1.5s ease-in-out infinite; }
        @keyframes ballRoll {
          0%, 100% { transform: translateX(0) rotate(0); }
          50% { transform: translateX(104px) rotate(360deg); }
        }

        .cat-anim-bounce { animation: catHop 0.8s cubic-bezier(0.34,1.2,0.64,1) infinite; transform-origin: 50% 100%; }
        @keyframes catHop {
          0%, 100% { transform: translateY(0) scale(1); }
          40% { transform: translateY(-8px) scale(1.03,0.97); }
          70% { transform: translateY(0) scale(0.97,1.03); }
        }
        .cat-ball-bounce { animation: ballBounce 0.8s cubic-bezier(0.5,0,0.7,0.3) infinite alternate; }
        @keyframes ballBounce {
          0% { transform: translateY(-56px) scale(1); }
          90% { transform: translateY(0) scale(1); }
          100% { transform: translateY(0) scale(1.3,0.7); }
        }

        .cat-anim-tailchase { animation: catTailChase 1.6s cubic-bezier(0.45,0,0.55,1) infinite; }
        @keyframes catTailChase {
          0% { transform: rotate(0) scale(1); }
          50% { transform: rotate(180deg) scale(0.92); }
          100% { transform: rotate(360deg) scale(1); }
        }

        .cat-anim-juggle { animation: catJuggleSway 1s ease-in-out infinite; transform-origin: 50% 100%; }
        @keyframes catJuggleSway {
          0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); }
        }
        .cat-ball-juggle { animation: ballJuggle 1s ease-in-out infinite; }
        @keyframes ballJuggle {
          0%, 100% { transform: translate(-28px, 0); }
          25% { transform: translate(0, -46px) scale(1.1); }
          50% { transform: translate(24px, 0); }
          75% { transform: translate(0, -46px) scale(1.1); }
        }

        .cat-anim-stretch { animation: catStretch 4.4s ease-in-out infinite; transform-origin: 50% 100%; }
        @keyframes catStretch {
          0%, 20%, 80%, 100% { transform: scale(1,1); }
          35% { transform: scale(1.08, 0.82); }
          55% { transform: scale(0.92, 1.14) translateY(-6px); }
        }

        .cat-anim-pounce { animation: catPounce 2.2s cubic-bezier(0.34,1.4,0.64,1) infinite; transform-origin: 50% 100%; }
        @keyframes catPounce {
          0%, 100% { transform: translate(14px, 0) scale(1); }
          30% { transform: translate(14px, 0) scale(1.04, 0.88); }
          50% { transform: translate(-18px, -18px) scale(0.96, 1.1) rotate(-6deg); }
          65% { transform: translate(-24px, 0) scale(1.06, 0.94); }
          85% { transform: translate(-6px, 0) scale(1); }
        }
        .cat-ball-flee { animation: ballFlee 2.2s ease-in-out infinite; }
        @keyframes ballFlee {
          0%, 40% { transform: translateX(0); opacity: 1; }
          60% { transform: translateX(-34px); opacity: 1; }
          75%, 100% { transform: translateX(-60px); opacity: 0; }
        }

        .cat-anim-wiggle { animation: catWiggle 1.1s ease-in-out infinite; transform-origin: 50% 85%; }
        @keyframes catWiggle {
          0%, 100% { transform: rotate(0); }
          20% { transform: rotate(-10deg) scale(1.05); }
          45% { transform: rotate(9deg) scale(1.08); }
          70% { transform: rotate(-6deg) scale(1.04); }
        }

        .cat-anim-snooze { animation: catSnooze 3.6s ease-in-out infinite; transform-origin: 50% 100%; }
        @keyframes catSnooze {
          0%, 100% { transform: scale(1, 1) rotate(2deg); }
          50% { transform: scale(1.03, 0.96) rotate(2deg); }
        }
        .cat-zzz { animation: zzzFloat 1.8s ease-out infinite; }
        @keyframes zzzFloat {
          0% { opacity: 0; transform: translate(0, 4px) scale(0.7); }
          30% { opacity: 1; }
          100% { opacity: 0; transform: translate(10px, -16px) scale(1.15); }
        }

        /* ---------- shared bits ---------- */
        .cat-blink-bar { animation: catBlinkSweep 5s ease-in-out infinite; }
        @keyframes catBlinkSweep { 0%, 86%, 100% { left: -100%; } 92% { left: 100%; } }
        .cat-shadow { animation: catShadow 3.2s ease-in-out infinite; }
        @keyframes catShadow { 0%,100% { transform: scaleX(1); opacity: 0.7; } 50% { transform: scaleX(0.72); opacity: 0.4; } }
        .cat-tag { animation: catTagGlow 3.2s ease-in-out infinite; text-shadow: 0 0 8px rgb(34 211 238 / 0.6); }
        @keyframes catTagGlow { 0%,100% { opacity: 0.75; } 50% { opacity: 1; } }

        /* ---------- guide ---------- */
        .guide-enter { animation: guideIn 0.35s cubic-bezier(0.16,1,0.3,1); }
        @keyframes guideIn { from { opacity: 0; transform: translateY(24px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .guide-cat { animation: catBob 3.2s ease-in-out infinite; }
        .guide-line { animation: lineIn 0.5s cubic-bezier(0.16,1,0.3,1) both; }
        @keyframes lineIn { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>
    </>
  )
}
