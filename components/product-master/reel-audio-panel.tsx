'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Mic, Music, Square, Trash2, Upload, VolumeX } from 'lucide-react'

/** Where a track came from. This is the whole basis of the copyright check:
 *  no service can tell you an arbitrary file is safe to post, but the source
 *  it came from does tell you, so the app tracks that instead of guessing. */
export type AudioOrigin = 'meta' | 'owned' | 'unknown'

export type ReelAudio = {
  blob: Blob
  /** Filename with a real extension - ffmpeg picks its demuxer from this */
  name: string
  kind: 'voice' | 'track' | 'music'
  origin: AudioOrigin
  volume: number
  /** Style label, shown instead of a meaningless generated filename */
  label?: string
}

/** A track may only be burned in when we know where it came from. A voiceover
 *  and a track generated here are both clear by definition: one is the user's
 *  own voice, the other is a brand new recording that never existed before. */
export function audioIsCleared(a: ReelAudio | null): boolean {
  if (!a) return true
  return a.kind === 'voice' || a.kind === 'music' || a.origin !== 'unknown'
}

const MAX_SECONDS = 180

/** Styles that suit a product reel. The prompts ask for instrumentals on
 *  purpose: vocals fight with a voiceover and date the video quickly. */
const MUSIC_STYLES: { key: string; label: string; prompt: string }[] = [
  {
    key: 'upbeat',
    label: 'Upbeat pop',
    prompt:
      'Bright upbeat pop instrumental, catchy plucked synth, punchy drums, positive and energetic, seamless loop, no vocals',
  },
  {
    key: 'tropical',
    label: 'Tropical',
    prompt:
      'Sunny tropical house instrumental, marimba and steel drums, relaxed island groove, warm and inviting, no vocals',
  },
  {
    key: 'lofi',
    label: 'Chill lo-fi',
    prompt:
      'Calm lo-fi hip hop instrumental, soft piano, mellow beat, warm vinyl texture, relaxed and unhurried, no vocals',
  },
  {
    key: 'afro',
    label: 'Afrobeat',
    prompt:
      'Modern afrobeats instrumental, log drums, syncopated percussion, confident and danceable groove, no vocals',
  },
  {
    key: 'clean',
    label: 'Clean corporate',
    prompt:
      'Clean minimal corporate instrumental, light marimba and soft synth pads, neutral and professional, unobtrusive background bed, no vocals',
  },
  {
    key: 'cinematic',
    label: 'Cinematic',
    prompt:
      'Cinematic instrumental with a slow confident build, warm strings and subtle percussion, premium and aspirational, no vocals',
  },
]

export function ReelAudioPanel({
  audio,
  onChange,
}: {
  audio: ReelAudio | null
  onChange: (a: ReelAudio | null) => void
}) {
  const [tab, setTab] = useState<'silent' | 'music' | 'voice' | 'track'>('silent')
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [micError, setMicError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // Which style is currently rendering, so only that chip shows a spinner
  const [making, setMaking] = useState<string | null>(null)
  const [musicError, setMusicError] = useState('')

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // A preview needs an object URL, and every one of them has to be released or
  // the blob stays in memory for the life of the page
  useEffect(() => {
    if (!audio) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(audio.blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [audio])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  // The mic must be released if this unmounts mid-recording, otherwise the
  // browser keeps showing the recording indicator
  useEffect(() => stopTracks, [stopTracks])

  const startRecording = useCallback(async () => {
    setMicError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      recorderRef.current = rec
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        stopTracks()
        setRecording(false)
        if (blob.size > 0) {
          onChange({ blob, name: 'voice.webm', kind: 'voice', origin: 'owned', volume: audio?.volume ?? 100 })
        }
      }
      rec.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          // Hard stop rather than letting a forgotten recording run forever
          if (s + 1 >= MAX_SECONDS) recorderRef.current?.stop()
          return s + 1
        })
      }, 1000)
    } catch {
      setMicError('Could not reach the microphone. Check the browser has permission.')
      stopTracks()
      setRecording(false)
    }
  }, [onChange, stopTracks, audio?.volume])

  const makeMusic = useCallback(
    async (style: (typeof MUSIC_STYLES)[number]) => {
      setMusicError('')
      setMaking(style.key)
      try {
        const res = await fetch('/api/product-master/generate-music', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: style.prompt, duration: 30 }),
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error || 'Could not make the track')
        // The route hands back a data URI, which fetch turns into a real Blob
        // for ffmpeg without any cross-origin request
        const blob = await (await fetch(json.audio)).blob()
        onChange({
          blob,
          name: 'music.mp3',
          kind: 'music',
          origin: 'owned',
          // Music is the only sound once the original is muted, so it starts
          // near full rather than at a background-bed level
          volume: audio?.volume ?? 85,
          label: style.label,
        })
      } catch (e) {
        setMusicError(e instanceof Error ? e.message : 'Could not make the track')
      } finally {
        setMaking(null)
      }
    },
    [onChange, audio?.volume],
  )

  const pickFile = useCallback(
    (f: File | undefined) => {
      if (!f) return
      const ext = f.name.split('.').pop()?.toLowerCase() || 'mp3'
      onChange({
        blob: f,
        name: `track.${ext}`,
        kind: 'track',
        // Deliberately starts unknown: the user has to say where it came from
        origin: 'unknown',
        volume: audio?.volume ?? 100,
      })
    },
    [onChange, audio?.volume],
  )

  const clear = useCallback(() => {
    onChange(null)
    setElapsed(0)
    if (fileRef.current) fileRef.current.value = ''
  }, [onChange])

  const switchTab = (t: 'silent' | 'music' | 'voice' | 'track') => {
    setTab(t)
    setMusicError('')
    if (t === 'silent') clear()
  }

  const cleared = audioIsCleared(audio)
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border bg-background/40 p-2.5">
      <div className="flex items-center gap-2">
        <Music className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-semibold text-foreground">Sound for this video</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { key: 'silent', label: 'No sound', icon: VolumeX },
            { key: 'music', label: 'Pick music', icon: Music },
            { key: 'voice', label: 'Record your voice', icon: Mic },
            { key: 'track', label: 'Upload a track', icon: Upload },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              tab === t.key
                ? 'bg-amber-500 text-black'
                : 'border border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="h-3 w-3" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'silent' && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The video posts with no sound at all. Safe, but a silent reel usually holds attention less well
          than one with a voice over it.
        </p>
      )}

      {tab === 'music' && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Pick a style and a brand new instrumental is made for this video. Nobody else has it, so there
            is nothing to clear and nothing to credit. Try a style again for a different take.
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {MUSIC_STYLES.map((s) => {
              const active = audio?.kind === 'music' && audio.label === s.label
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={making !== null}
                  onClick={() => makeMusic(s)}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                    active
                      ? 'border-amber-500 bg-amber-500/15 text-amber-500'
                      : 'border-border text-muted-foreground hover:border-amber-500/40 hover:text-foreground'
                  }`}
                >
                  {making === s.key ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Making
                    </>
                  ) : (
                    <>
                      {active && <CheckCircle2 className="h-3 w-3" />}
                      {s.label}
                    </>
                  )}
                </button>
              )
            })}
          </div>
          {making && (
            <p className="text-[11px] text-muted-foreground" aria-live="polite">
              Writing a 30 second track. This takes a moment.
            </p>
          )}
          {musicError && <p className="text-[11px] text-red-400">{musicError}</p>}
        </div>
      )}

      {tab === 'voice' && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Talk over the clip in your own words. This is the best option: nobody can claim your own voice,
            and it speaks to your customers directly.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!recording ? (
              <Button size="sm" variant="outline" onClick={startRecording}>
                <Mic className="mr-1.5 h-3.5 w-3.5" />
                {audio?.kind === 'voice' ? 'Record again' : 'Start recording'}
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={() => recorderRef.current?.stop()}>
                <Square className="mr-1.5 h-3 w-3" />
                Stop
              </Button>
            )}
            {recording && (
              <span className="flex items-center gap-1.5 text-xs text-red-400" aria-live="polite">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                {mmss}
              </span>
            )}
          </div>
          {micError && <p className="text-[11px] text-red-400">{micError}</p>}
        </div>
      )}

      {tab === 'track' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {audio?.kind === 'track' ? 'Choose another' : 'Choose an audio file'}
            </Button>
            <a
              href="https://business.facebook.com/sound_collection"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-500 hover:underline"
            >
              Free tracks from Meta Sound Collection
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Meta Sound Collection tracks cannot be listed inside this app: Meta publishes no API for them,
            the library sits behind your business login, and the licence only covers use on Facebook and
            Instagram. Open it in the tab above, download a track, then upload it here.
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Chart music from the in-app library is a different thing and is not cleared for you: that
            licence is for personal posts, and using it on a page selling products gets the audio muted or
            the post pulled.
          </p>

          {audio?.kind === 'track' && (
            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background/60 p-2">
              <span className="text-[11px] font-semibold text-foreground">Where is this track from?</span>
              {(
                [
                  { key: 'meta', label: 'Meta Sound Collection' },
                  { key: 'owned', label: 'My own recording, or music I hold a commercial licence for' },
                  { key: 'unknown', label: "I'm not sure" },
                ] as const
              ).map((o) => (
                <label key={o.key} className="flex cursor-pointer items-start gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="radio"
                    name="audio-origin"
                    checked={audio.origin === o.key}
                    onChange={() => onChange({ ...audio, origin: o.key })}
                    className="mt-0.5 h-3 w-3 accent-amber-500"
                  />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {audio && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] font-semibold text-foreground">
              {audio.kind === 'voice'
                ? 'Your voiceover'
                : audio.kind === 'music'
                  ? `${audio.label} - made for this video`
                  : audio.name}
            </span>
            <button
              type="button"
              onClick={clear}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Remove this sound"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {previewUrl && <audio src={previewUrl} controls className="h-8 w-full" />}
          <div className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-[11px] text-muted-foreground">Volume {audio.volume}%</span>
            <Slider
              min={0}
              max={150}
              step={5}
              value={[audio.volume]}
              onValueChange={(v) => onChange({ ...audio, volume: v[0] })}
              aria-label="Sound volume"
              className="flex-1"
            />
          </div>

          {cleared ? (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-emerald-400">
              <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
              {audio.kind === 'voice'
                ? 'Your own recording. Nothing to clear.'
                : audio.kind === 'music'
                  ? 'Made for this video and cleared for commercial use. Yours to keep.'
                  : audio.origin === 'meta'
                    ? 'Cleared for Facebook and Instagram. Not for other platforms.'
                    : 'You confirmed you hold the rights to this.'}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-500">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Tell us where this came from before it can be added. Music of unknown origin is the single
              most common reason a product video gets muted or taken down.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
