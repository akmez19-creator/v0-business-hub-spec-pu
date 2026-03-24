'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// Legacy map for the 13 delivery zone names that don't match slug convention
const LEGACY_MAP: Record<string, string> = {
  'EAST - 1': 'east-1',
  'EAST - 2': 'east-2',
  'EAST - 3': 'east-3',
  'PORT LOUIS': 'port-louis',
  'PW': 'pw',
  'REMPART': 'rempart',
  'SOUTH': 'south',
  'WEST': 'west',
}

export function getRegionImage(region: string): string | null {
  if (!region) return null
  const upper = region.toUpperCase().trim()
  const legacySlug = LEGACY_MAP[upper]
  if (legacySlug) return `/images/regions/${legacySlug}.jpg`
  const slug = toSlug(region)
  if (slug) return `/images/regions/${slug}.jpg`
  return null
}

const REGION_COLORS = [
  { bg: 'bg-blue-500/15', text: 'text-blue-500', border: 'border-blue-500/25' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-500', border: 'border-emerald-500/25' },
  { bg: 'bg-violet-500/15', text: 'text-violet-500', border: 'border-violet-500/25' },
  { bg: 'bg-amber-500/15', text: 'text-amber-500', border: 'border-amber-500/25' },
  { bg: 'bg-rose-500/15', text: 'text-rose-500', border: 'border-rose-500/25' },
  { bg: 'bg-cyan-500/15', text: 'text-cyan-500', border: 'border-cyan-500/25' },
  { bg: 'bg-orange-500/15', text: 'text-orange-500', border: 'border-orange-500/25' },
  { bg: 'bg-pink-500/15', text: 'text-pink-500', border: 'border-pink-500/25' },
]

function getRegionColor(region: string) {
  let hash = 0
  const normalized = region.toLowerCase().trim()
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash)
  }
  return REGION_COLORS[Math.abs(hash) % REGION_COLORS.length]
}

function getRegionInitials(region: string) {
  const words = region.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

interface RegionAvatarProps {
  region: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function RegionAvatar({ region, size = 'md', className }: RegionAvatarProps) {
  const rc = getRegionColor(region)
  const imageUrl = getRegionImage(region)
  const [imgFailed, setImgFailed] = useState(false)

  const sizeClasses = {
    sm: 'w-7 h-7 rounded-md text-[9px]',
    md: 'w-8 h-8 rounded-lg text-xs',
    lg: 'w-10 h-10 rounded-xl text-xs',
  }

  const showImage = imageUrl && !imgFailed

  return (
    <div
      className={cn(
        'flex items-center justify-center shrink-0 border overflow-hidden font-bold',
        sizeClasses[size],
        showImage ? 'border-border/40' : `${rc.bg} ${rc.border}`,
        className
      )}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={region}
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span className={rc.text}>{getRegionInitials(region)}</span>
      )}
    </div>
  )
}
