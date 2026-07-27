'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Download,
  Film,
  Link2,
  Loader2,
  Merge,
  Scissors,
  Trash2,
  Upload,
} from 'lucide-react'

interface Clip {
  id: string
  name: string
  url: string
  file: File
  duration: number
}

// Reels Studio: everything runs IN the browser via ffmpeg.wasm - cut a scene
// out of a clip (trim), or merge the strip into one reel. No server cost,
// files never leave the machine until the user downloads the result.
export function ReelsStudioTab() {
  const [clips, setClips] = useState<Clip[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [range, setRange] = useState<[number, number]>([0, 0])
  const [busy, setBusy] = useState<'cut' | 'merge' | 'load' | null>(null)
  const [progress, setProgress] = useState(0)
  const [output, setOutput] = useState<{ url: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const [ffmpegReady, setFfmpegReady] = useState(false)
  const ffmpegRef = useRef<any>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ---- Fetch-by-link: paste a TikTok/Facebook/YouTube URL and the video is
  // resolved watermark-free in HD and dropped straight into the feed ----
  const [link, setLink] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [fetchInfo, setFetchInfo] = useState('')

  const fetchFromLink = async () => {
    const url = link.trim()
    if (!url || fetching) return
    setFetching(true)
    setFetchError('')
    setFetchInfo('Resolving video\u2026')
    try {
      const res = await fetch('/api/product-master/video-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const meta = await res.json()
      if (!meta.success) throw new Error(meta.error || 'Could not fetch this video')

      setFetchInfo(`Downloading ${meta.quality === 'hd' ? 'HD' : 'SD'} video\u2026`)
      const safeName = `${meta.source}-${(meta.title || 'video').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'video'}.mp4`
      const proxied = `/api/product-master/video-fetch?src=${encodeURIComponent(meta.videoUrl)}&filename=${encodeURIComponent(safeName)}`
      const fileRes = await fetch(proxied)
      if (!fileRes.ok) throw new Error('Download failed - the video link may have expired, try again')
      const blob = await fileRes.blob()
      if (blob.size < 10_000) throw new Error('Downloaded file looks empty - try again')

      const file = new File([blob], safeName, { type: 'video/mp4' })
      addFiles([file])
      setLink('')
      setFetchInfo(`Added: ${safeName}`)
      setTimeout(() => setFetchInfo(''), 4000)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Could not fetch this video')
      setFetchInfo('')
    } finally {
      setFetching(false)
    }
  }

  // Lazy-load the wasm core only when this tab mounts
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setBusy('load')
      try {
        const { FFmpeg } = await import('@ffmpeg/ffmpeg')
        const { toBlobURL } = await import('@ffmpeg/util')
        const ffmpeg = new FFmpeg()
        ffmpeg.on('progress', ({ progress: p }: { progress: number }) => {
          setProgress(Math.min(100, Math.round(p * 100)))
        })
        const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
        await ffmpeg.load({
          coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        })
        if (!cancelled) {
          ffmpegRef.current = ffmpeg
          setFfmpegReady(true)
        }
      } catch (e) {
        if (!cancelled) setError('Could not load the video engine. Check your connection and reopen this tab.')
      } finally {
        if (!cancelled) setBusy(null)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const addFiles = useCallback((files: FileList | File[]) => {
    const vids = Array.from(files).filter((f) => f.type.startsWith('video/'))
    for (const file of vids) {
      const url = URL.createObjectURL(file)
      const probe = document.createElement('video')
      probe.preload = 'metadata'
      probe.onloadedmetadata = () => {
        setClips((prev) => [
          ...prev,
          { id: `${Date.now()}-${file.name}`, name: file.name, url, file, duration: probe.duration || 0 },
        ])
      }
      probe.src = url
    }
  }, [])

  const selectedClip = clips.find((c) => c.id === selected) || null

  const selectClip = (c: Clip) => {
    setSelected(c.id)
    setRange([0, Math.floor(c.duration)])
    setOutput(null)
  }

  const move = (id: string, dir: -1 | 1) =>
    setClips((prev) => {
      const i = prev.findIndex((c) => c.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const remove = (id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id))
    if (selected === id) setSelected(null)
  }

  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  // CUT SCENE: trim the selected clip to [start, end]. Stream-copy first for
  // speed; ffmpeg falls back cleanly since we re-encode when copy fails.
  const cutScene = async () => {
    const ffmpeg = ffmpegRef.current
    if (!ffmpeg || !selectedClip) return
    setBusy('cut')
    setProgress(0)
    setError('')
    setOutput(null)
    try {
      const { fetchFile } = await import('@ffmpeg/util')
      await ffmpeg.writeFile('in.mp4', await fetchFile(selectedClip.file))
      const [start, end] = range
      let ok = true
      try {
        await ffmpeg.exec(['-ss', String(start), '-to', String(end), '-i', 'in.mp4', '-c', 'copy', 'out.mp4'])
      } catch {
        ok = false
      }
      if (!ok) {
        await ffmpeg.exec(['-ss', String(start), '-to', String(end), '-i', 'in.mp4', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'out.mp4'])
      }
      const data = await ffmpeg.readFile('out.mp4')
      const blob = new Blob([data], { type: 'video/mp4' })
      setOutput({ url: URL.createObjectURL(blob), name: `cut-${selectedClip.name.replace(/\.[^.]+$/, '')}.mp4` })
    } catch (e) {
      setError('Cut failed. Try a shorter range or a different clip.')
    } finally {
      setBusy(null)
      setProgress(0)
    }
  }

  // MERGE: concat every clip in strip order. Re-encode to normalize
  // dimensions/codecs so mixed sources merge reliably.
  const mergeClips = async () => {
    const ffmpeg = ffmpegRef.current
    if (!ffmpeg || clips.length < 2) return
    setBusy('merge')
    setProgress(0)
    setError('')
    setOutput(null)
    try {
      const { fetchFile } = await import('@ffmpeg/util')
      const names: string[] = []
      for (let i = 0; i < clips.length; i++) {
        const n = `m${i}.mp4`
        await ffmpeg.writeFile(n, await fetchFile(clips[i].file))
        names.push(n)
      }
      // Normalize each to 1080x1920-safe scale + same codec, then concat
      const args: string[] = []
      for (const n of names) args.push('-i', n)
      const filters =
        names.map((_, i) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=44100[a${i}]`).join(';') +
        ';' +
        names.map((_, i) => `[v${i}][a${i}]`).join('') +
        `concat=n=${names.length}:v=1:a=1[outv][outa]`
      await ffmpeg.exec([
        ...args,
        '-filter_complex', filters,
        '-map', '[outv]', '-map', '[outa]',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
        'merged.mp4',
      ])
      const data = await ffmpeg.readFile('merged.mp4')
      const blob = new Blob([data], { type: 'video/mp4' })
      setOutput({ url: URL.createObjectURL(blob), name: `reel-merged-${clips.length}clips.mp4` })
    } catch (e) {
      setError('Merge failed. Clips without audio tracks can cause this - try clips with sound.')
    } finally {
      setBusy(null)
      setProgress(0)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Fetch from link ---- */}
      <section className="flex flex-col gap-2 rounded-lg border border-sky-500/25 bg-sky-500/5 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4 text-sky-500" />
          Fetch a product video from a link
        </p>
        <p className="text-xs text-muted-foreground">
          Paste a TikTok or Facebook video link - the full HD, watermark-free video is downloaded and added to
          the feed automatically. No external website needed.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="https://www.tiktok.com/... or https://www.facebook.com/..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !(e.nativeEvent as KeyboardEvent).isComposing && e.keyCode !== 229) {
                e.preventDefault()
                fetchFromLink()
              }
            }}
            disabled={fetching}
            className="flex-1"
          />
          <Button onClick={fetchFromLink} disabled={fetching || !link.trim()}>
            {fetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            {fetching ? 'Fetching\u2026' : 'Fetch video'}
          </Button>
        </div>
        {fetchInfo && <p className="text-xs text-sky-400">{fetchInfo}</p>}
        {fetchError && <p className="text-xs text-destructive">{fetchError}</p>}
      </section>

      {/* ---- Step 1: feed ---- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-bold text-sky-500">1</span>
            Add clips to the feed
          </p>
          <div className="flex items-center gap-2">
            {!ffmpegReady && busy === 'load' && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading engine
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Add videos
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            addFiles(e.dataTransfer.files)
          }}
          className={`flex gap-3 overflow-x-auto rounded-lg border border-dashed p-3 ${
            clips.length === 0 ? 'min-h-28 items-center justify-center' : ''
          }`}
        >
          {clips.length === 0 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Film className="h-4 w-4" /> Drag and drop videos here, or click Add videos
            </p>
          )}
          {clips.map((c, i) => (
            <div
              key={c.id}
              className={`group relative w-36 shrink-0 cursor-pointer overflow-hidden rounded-md border transition-shadow ${
                selected === c.id ? 'ring-2 ring-sky-500' : 'hover:ring-1 hover:ring-muted-foreground/30'
              }`}
              onClick={() => selectClip(c)}
            >
              <video src={c.url} className="h-20 w-36 bg-black object-cover" muted playsInline />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <span className="absolute bottom-7 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                {fmt(c.duration)}
              </span>
              <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                <span className="truncate text-[10px]">{c.name}</span>
              </div>
              <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                <Button variant="secondary" size="icon" className="h-6 w-6" title="Move earlier" onClick={(e) => { e.stopPropagation(); move(c.id, -1) }}>
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button variant="secondary" size="icon" className="h-6 w-6" title="Move later" onClick={(e) => { e.stopPropagation(); move(c.id, 1) }}>
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button variant="destructive" size="icon" className="h-6 w-6" title="Remove" onClick={(e) => { e.stopPropagation(); remove(c.id) }}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Step 2: cut or merge ---- */}
      <section className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-bold text-sky-500">2</span>
          Cut a scene or merge the feed
        </p>

        {selectedClip ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                <Scissors className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="truncate">{selectedClip.name}</span>
              </p>
              <Button
                size="sm"
                onClick={cutScene}
                disabled={!ffmpegReady || busy !== null || range[1] <= range[0]}
              >
                {busy === 'cut' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Scissors className="mr-1.5 h-3.5 w-3.5" />}
                {busy === 'cut' ? 'Cutting\u2026' : 'Cut this scene'}
              </Button>
            </div>
            <video ref={videoRef} src={selectedClip.url} controls className="max-h-56 w-full rounded-md bg-black" />
            <div className="px-1">
              <Slider
                min={0}
                max={Math.max(1, Math.floor(selectedClip.duration))}
                step={1}
                value={range}
                onValueChange={(v) => {
                  setRange([v[0], v[1]] as [number, number])
                  if (videoRef.current) videoRef.current.currentTime = v[0]
                }}
              />
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                <span>Start {fmt(range[0])}</span>
                <span className="font-medium text-foreground">Keep {fmt(Math.max(0, range[1] - range[0]))}</span>
                <span>End {fmt(range[1])}</span>
              </div>
            </div>
          </div>
        ) : (
          clips.length > 0 && (
            <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
              <Scissors className="mr-1.5 inline h-3.5 w-3.5" />
              Click a clip above to trim it.
            </p>
          )
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Merge className="h-3.5 w-3.5 text-emerald-500" /> Merge into one reel
            </p>
            <p className="text-xs text-muted-foreground">
              {clips.length < 2
                ? 'Add at least 2 clips - they merge in feed order into a 1080x1920 reel (30fps).'
                : `${clips.length} clips will merge in feed order into a 1080x1920 reel (30fps).`}
            </p>
          </div>
          <Button size="sm" onClick={mergeClips} disabled={!ffmpegReady || busy !== null || clips.length < 2}>
            {busy === 'merge' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Merge className="mr-1.5 h-3.5 w-3.5" />}
            {busy === 'merge' ? 'Merging\u2026' : 'Merge'}
          </Button>
        </div>
      </section>

      {(busy === 'cut' || busy === 'merge') && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <Clapperboard className="h-4 w-4 shrink-0 animate-pulse text-sky-500" />
          <Progress value={progress} className="flex-1" />
          <span className="w-10 text-right text-sm tabular-nums">{progress}%</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ---- Result ---- */}
      {output && (
        <section className="overflow-hidden rounded-lg border border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center justify-between gap-2 border-b border-emerald-500/20 px-4 py-2.5">
            <span className="text-sm font-semibold">Result ready</span>
            <Button asChild size="sm">
              <a href={output.url} download={output.name}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download
              </a>
            </Button>
          </div>
          <div className="p-3">
            <video src={output.url} controls className="mx-auto max-h-72 rounded-md bg-black" />
          </div>
        </section>
      )}
    </div>
  )
}
