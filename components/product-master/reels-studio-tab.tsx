'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Download,
  Film,
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
    <div className="flex flex-col gap-4">
      {/* Feed / upload strip */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Film className="h-4 w-4 text-cyan-500" /> Reels feed
          </CardTitle>
          <div className="flex items-center gap-2">
            {!ffmpegReady && busy === 'load' && (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading engine
              </Badge>
            )}
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="mr-1.5 h-4 w-4" /> Add videos
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
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              addFiles(e.dataTransfer.files)
            }}
            className={`flex min-h-24 flex-wrap gap-3 rounded-lg border border-dashed p-3 ${clips.length === 0 ? 'items-center justify-center' : ''}`}
          >
            {clips.length === 0 && (
              <p className="text-sm text-muted-foreground">Drag and drop videos here, or click Add videos</p>
            )}
            {clips.map((c, i) => (
              <div
                key={c.id}
                className={`group relative w-40 cursor-pointer overflow-hidden rounded-md border ${selected === c.id ? 'ring-2 ring-cyan-500' : ''}`}
                onClick={() => selectClip(c)}
              >
                <video src={c.url} className="h-24 w-40 bg-black object-cover" muted playsInline />
                <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                  <span className="truncate text-[10px]">{i + 1}. {c.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{fmt(c.duration)}</span>
                </div>
                <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
                  <Button variant="secondary" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); move(c.id, -1) }}>
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button variant="secondary" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); move(c.id, 1) }}>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button variant="destructive" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); remove(c.id) }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Cut scene */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scissors className="h-4 w-4 text-amber-500" /> Cut scene
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!selectedClip ? (
              <p className="text-sm text-muted-foreground">Select a clip in the feed to trim it.</p>
            ) : (
              <>
                <video ref={videoRef} src={selectedClip.url} controls className="max-h-64 w-full rounded-md bg-black" />
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
                  <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                    <span>Start {fmt(range[0])}</span>
                    <span>Keep {fmt(Math.max(0, range[1] - range[0]))}</span>
                    <span>End {fmt(range[1])}</span>
                  </div>
                </div>
                <Button onClick={cutScene} disabled={!ffmpegReady || busy !== null || range[1] <= range[0]}>
                  {busy === 'cut' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Scissors className="mr-2 h-4 w-4" />}
                  {busy === 'cut' ? 'Cutting\u2026' : 'Cut this scene'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Merge */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Merge className="h-4 w-4 text-emerald-500" /> Merge into one reel
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Merges every clip in the feed, in order, into a single 1080x1920 reel (30fps). Reorder with the arrows on each thumbnail.
            </p>
            <Button onClick={mergeClips} disabled={!ffmpegReady || busy !== null || clips.length < 2}>
              {busy === 'merge' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Merge className="mr-2 h-4 w-4" />}
              {busy === 'merge' ? 'Merging\u2026' : `Merge ${clips.length} clips`}
            </Button>
            {clips.length < 2 && <p className="text-xs text-muted-foreground">Add at least 2 clips to merge.</p>}
          </CardContent>
        </Card>
      </div>

      {(busy === 'cut' || busy === 'merge') && (
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Clapperboard className="h-5 w-5 shrink-0 text-cyan-500" />
            <Progress value={progress} className="flex-1" />
            <span className="w-10 text-right text-sm tabular-nums">{progress}%</span>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {output && (
        <Card className="border-emerald-500/30">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Result</CardTitle>
            <Button asChild size="sm">
              <a href={output.url} download={output.name}>
                <Download className="mr-1.5 h-4 w-4" /> Download {output.name}
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            <video src={output.url} controls className="max-h-80 w-full rounded-md bg-black" />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
