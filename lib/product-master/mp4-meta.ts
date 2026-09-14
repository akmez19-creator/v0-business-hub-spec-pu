/**
 * Minimal MP4 metadata reader: duration, width and height straight out of the
 * container headers.
 *
 * WHY THIS EXISTS
 * When a clip is downloaded in the browser, dimensions come from a <video>
 * probe (`probe.onloadedmetadata`). The background worker has no DOM, so
 * without this every server-saved clip would land with 0/0/0 - and the feed
 * uses width/height to lay tiles out and duration to seed the trim range.
 *
 * The fallback is deliberately identical to the browser's own failure path
 * (`probe.onerror = () => add(0, 1080, 1920)`), so a file this cannot parse
 * behaves exactly as it does today rather than in some new third way.
 *
 * Only the `moov` header is read - no frame data - so this is cheap even on a
 * 20MB buffer. Safe to assume MP4 because the `reels` bucket accepts video/mp4
 * and nothing else.
 */

export type Mp4Meta = { duration: number; width: number; height: number }

/** Matches the browser probe's onerror fallback exactly. */
export const MP4_META_FALLBACK: Mp4Meta = { duration: 0, width: 1080, height: 1920 }

type Box = { type: string; start: number; end: number }

/** Walk the boxes directly inside [from, to). */
function boxes(view: DataView, from: number, to: number): Box[] {
  const out: Box[] = []
  let at = from
  // 8 bytes is the smallest legal box header (size + type)
  while (at + 8 <= to) {
    const size32 = view.getUint32(at)
    const type = String.fromCharCode(
      view.getUint8(at + 4),
      view.getUint8(at + 5),
      view.getUint8(at + 6),
      view.getUint8(at + 7),
    )
    let header = 8
    let size = size32
    if (size32 === 1) {
      // 64-bit largesize follows the type
      if (at + 16 > to) break
      const hi = view.getUint32(at + 8)
      const lo = view.getUint32(at + 12)
      size = hi * 2 ** 32 + lo
      header = 16
    } else if (size32 === 0) {
      // "to the end of the file"
      size = to - at
    }
    // A size that is smaller than its own header, or runs past the parent, is a
    // corrupt or truncated file. Stop rather than loop forever.
    if (size < header || at + size > to) break
    out.push({ type, start: at + header, end: at + size })
    at += size
  }
  return out
}

function find(list: Box[], type: string): Box | undefined {
  return list.find((b) => b.type === type)
}

/** duration in seconds from the movie header */
function readMvhd(view: DataView, box: Box): number | null {
  const p = box.start
  if (p + 4 > box.end) return null
  const version = view.getUint8(p)
  let timescale: number
  let units: number
  if (version === 1) {
    if (p + 4 + 8 + 8 + 4 + 8 > box.end) return null
    timescale = view.getUint32(p + 4 + 16)
    const hi = view.getUint32(p + 4 + 20)
    const lo = view.getUint32(p + 4 + 24)
    units = hi * 2 ** 32 + lo
  } else {
    if (p + 4 + 4 + 4 + 4 + 4 > box.end) return null
    timescale = view.getUint32(p + 4 + 8)
    units = view.getUint32(p + 4 + 12)
  }
  if (!timescale || !units) return null
  return units / timescale
}

/** display width/height from a track header, honouring the rotation matrix */
function readTkhd(view: DataView, box: Box): { width: number; height: number } | null {
  const p = box.start
  if (p + 4 > box.end) return null
  const version = view.getUint8(p)
  // version 1 widens creation/modification/duration from 32 to 64 bits
  const afterDates = version === 1 ? p + 4 + 8 + 8 + 4 + 4 + 8 : p + 4 + 4 + 4 + 4 + 4 + 4
  // reserved(8) + layer(2) + altGroup(2) + volume(2) + reserved(2)
  const matrixAt = afterDates + 16
  const sizeAt = matrixAt + 36
  if (sizeAt + 8 > box.end) return null

  // 16.16 fixed point
  const w = view.getUint32(sizeAt) / 65536
  const h = view.getUint32(sizeAt + 4) / 65536
  if (w < 1 || h < 1) return null

  // The matrix's b and c terms carry rotation. A phone-shot portrait clip is
  // often stored landscape with a 90 degree rotation, so trusting width/height
  // alone would report it the wrong way round and the feed would letterbox it.
  const a = view.getInt32(matrixAt) / 65536
  const b = view.getInt32(matrixAt + 4) / 65536
  const c = view.getInt32(matrixAt + 12) / 65536
  const d = view.getInt32(matrixAt + 16) / 65536
  const quarterTurn = Math.abs(a) < 0.01 && Math.abs(d) < 0.01 && (Math.abs(b) > 0.9 || Math.abs(c) > 0.9)

  return quarterTurn
    ? { width: Math.round(h), height: Math.round(w) }
    : { width: Math.round(w), height: Math.round(h) }
}

/**
 * Reads duration/width/height from an MP4 buffer.
 * Never throws: an unparseable file returns MP4_META_FALLBACK.
 */
export function readMp4Meta(buffer: ArrayBuffer): Mp4Meta {
  try {
    const view = new DataView(buffer)
    const top = boxes(view, 0, buffer.byteLength)
    const moov = find(top, 'moov')
    if (!moov) return { ...MP4_META_FALLBACK }

    const inMoov = boxes(view, moov.start, moov.end)

    const mvhd = find(inMoov, 'mvhd')
    const duration = (mvhd && readMvhd(view, mvhd)) || 0

    // Pick the largest track: an mp4 has one trak per stream and the audio
    // track's tkhd reports 0x0, so taking the first would give no dimensions.
    let width = 0
    let height = 0
    for (const trak of inMoov.filter((b) => b.type === 'trak')) {
      const tkhd = find(boxes(view, trak.start, trak.end), 'tkhd')
      const dims = tkhd ? readTkhd(view, tkhd) : null
      if (dims && dims.width * dims.height > width * height) {
        width = dims.width
        height = dims.height
      }
    }

    if (!width || !height) {
      return { duration: duration || 0, width: MP4_META_FALLBACK.width, height: MP4_META_FALLBACK.height }
    }
    return { duration: Number(duration.toFixed(3)) || 0, width, height }
  } catch {
    // Same shape the browser probe falls back to, so nothing downstream has to
    // learn a new failure mode.
    return { ...MP4_META_FALLBACK }
  }
}
