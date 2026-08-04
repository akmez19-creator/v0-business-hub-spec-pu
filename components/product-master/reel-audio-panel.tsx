'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { AlertTriangle, CheckCircle2, ExternalLink, Mic, Music, Square, Trash2, Upload, VolumeX } from 'lucide-react'

/** Where a track came from. This is the whole basis of the copyright check:
 *  no service can tell you an arbitrary file is safe to post, but the source
 *  it came from does tell you, so the app tracks that instead of guessing. */
export type AudioOrigin = 'meta' | 'owned' | 'unknown'

export type ReelAudio = {
  blob: Blob
  /** Filename with a real extension - ffmpeg picks its demuxer from this */
  name: string
  kind: 'voice' | 'track'
  origin: AudioOrigin
  volume: number
}

/** A track may only be burned in when we know where it came from. A voiceover
 *  the user recorded here is theirs by definition and never needs clearing. */
export function audioIsCleared(a: ReelAudio | null): boolean {
  if (!a) return true
  return a.kind === 'voice' || a.origin !== 'unknown'
}

const MAX_SECONDS = 180

export function ReelAudioPanel({
  audio,
  onChange,
}: {
  audio: ReelAudio | null
  onChange: (a: ReelAudio | null) => void
}) {
  const [tab, setTab] = useState<'silent' | 'voice' | 'track'>('silent')
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [micError, setMicError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

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

  const switchTab = (t: 'silent' | 'voice' | 'track') => {
    setTab(t)
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
            { key: 'voice', label: 'Record your voice', icon: Mic },
            { key: 'track', label: 'Add a track', icon: Music },
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
            Meta Sound Collection is free and cleared for business pages on Facebook and Instagram. Chart
            music from the in-app library is not: that licence is for personal posts, and using it on a
            page selling products gets the audio muted or the post pulled.
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
              {audio.kind === 'voice' ? 'Your voiceover' : audio.name}
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
