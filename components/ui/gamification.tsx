'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { 
  Trophy, 
  Star, 
  Zap, 
  Target, 
  Flame, 
  Award,
  Medal,
  Crown,
  Rocket,
  Shield
} from 'lucide-react'

// Progress Ring Component
interface ProgressRingProps {
  progress: number
  size?: number
  strokeWidth?: number
  className?: string
  children?: React.ReactNode
  gradientId?: string
  gradientColors?: [string, string]
}

export function ProgressRing({
  progress,
  size = 100,
  strokeWidth = 8,
  className,
  children,
  gradientId = 'progressGradient',
  gradientColors = ['var(--primary)', 'var(--accent)']
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const strokeDashoffset = circumference - (progress / 100) * circumference

  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }}>
      <svg className="w-full h-full progress-ring" viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/30"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="progress-ring-circle"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
        />
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={gradientColors[0]} />
            <stop offset="100%" stopColor={gradientColors[1]} />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  )
}

// XP Bar Component
interface XPBarProps {
  current: number
  max: number
  level: number
  className?: string
  showLabel?: boolean
}

export function XPBar({ current, max, level, className, showLabel = true }: XPBarProps) {
  const progress = (current / max) * 100

  return (
    <div className={cn("space-y-1", className)}>
      {showLabel && (
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-primary" />
            <span className="text-muted-foreground">Level {level}</span>
          </div>
          <span className="text-muted-foreground">
            {current}/{max} XP
          </span>
        </div>
      )}
      <div className="xp-bar h-2">
        <div className="xp-bar-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

// Level Badge Component
interface LevelBadgeProps {
  level: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function LevelBadge({ level, size = 'md', className }: LevelBadgeProps) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-12 h-12 text-lg',
    lg: 'w-16 h-16 text-2xl'
  }

  return (
    <div className={cn(
      "level-badge rounded-xl flex items-center justify-center font-bold text-primary-foreground",
      sizeClasses[size],
      className
    )}>
      {level}
    </div>
  )
}

// Achievement Card Component
interface AchievementProps {
  name: string
  description?: string
  icon: React.ElementType
  unlocked: boolean
  progress?: number
  rarity?: 'common' | 'rare' | 'epic' | 'legendary'
  className?: string
}

const rarityColors = {
  common: 'from-slate-400 to-slate-500',
  rare: 'from-blue-400 to-blue-600',
  epic: 'from-purple-400 to-purple-600',
  legendary: 'from-amber-400 to-orange-500'
}

const rarityGlow = {
  common: '',
  rare: 'glow-accent',
  epic: '',
  legendary: 'glow-primary'
}

export function Achievement({ 
  name, 
  description, 
  icon: Icon, 
  unlocked, 
  progress,
  rarity = 'common',
  className 
}: AchievementProps) {
  return (
    <div className={cn(
      "achievement-card rounded-xl p-4 transition-all",
      unlocked && rarityGlow[rarity],
      !unlocked && "opacity-50",
      className
    )}>
      <div className="flex items-start gap-3">
        <div className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center",
          unlocked 
            ? `bg-gradient-to-br ${rarityColors[rarity]}` 
            : "bg-muted"
        )}>
          <Icon className={cn(
            "w-6 h-6",
            unlocked ? "text-white" : "text-muted-foreground"
          )} />
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-foreground">{name}</h4>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
          {!unlocked && progress !== undefined && (
            <div className="mt-2">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{progress}% complete</p>
            </div>
          )}
        </div>
        {unlocked && (
          <div className="badge-bounce">
            <Star className="w-5 h-5 text-warning fill-warning" />
          </div>
        )}
      </div>
    </div>
  )
}

// Streak Counter Component
interface StreakCounterProps {
  days: number
  className?: string
}

export function StreakCounter({ days, className }: StreakCounterProps) {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30",
      className
    )}>
      <Flame className="w-4 h-4 text-primary" />
      <span className="text-sm font-semibold text-foreground">{days} day streak</span>
    </div>
  )
}

// Stats Card Component
interface StatsCardProps {
  icon: React.ElementType
  label: string
  value: string | number
  trend?: {
    value: number
    positive: boolean
  }
  color?: 'primary' | 'accent' | 'success' | 'warning'
  className?: string
}

const colorClasses = {
  primary: 'bg-primary/20 text-primary',
  accent: 'bg-accent/20 text-accent',
  success: 'bg-success/20 text-success',
  warning: 'bg-warning/20 text-warning'
}

export function StatsCard({ 
  icon: Icon, 
  label, 
  value, 
  trend, 
  color = 'primary',
  className 
}: StatsCardProps) {
  return (
    <div className={cn("stats-card-3d rounded-xl p-4", className)}>
      <div className="flex items-center justify-between mb-2">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", colorClasses[color])}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <div className={cn(
            "flex items-center gap-1 text-xs font-medium",
            trend.positive ? "text-success" : "text-destructive"
          )}>
            {trend.positive ? '+' : ''}{trend.value}%
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

// Leaderboard Entry Component
interface LeaderboardEntryProps {
  rank: number
  name: string
  avatar?: string
  score: number
  isCurrentUser?: boolean
  className?: string
}

export function LeaderboardEntry({ 
  rank, 
  name, 
  avatar, 
  score, 
  isCurrentUser,
  className 
}: LeaderboardEntryProps) {
  const getRankIcon = () => {
    if (rank === 1) return <Crown className="w-5 h-5 text-yellow-500" />
    if (rank === 2) return <Medal className="w-5 h-5 text-slate-400" />
    if (rank === 3) return <Medal className="w-5 h-5 text-amber-600" />
    return <span className="text-sm font-bold text-muted-foreground">#{rank}</span>
  }

  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-xl transition-all",
      isCurrentUser ? "glass-card glow-primary" : "bg-muted/20",
      className
    )}>
      <div className="w-8 flex justify-center">
        {getRankIcon()}
      </div>
      <div className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center font-bold",
        rank === 1 
          ? "bg-gradient-to-br from-yellow-400 to-amber-500 text-white" 
          : rank === 2
          ? "bg-gradient-to-br from-slate-300 to-slate-400 text-white"
          : rank === 3
          ? "bg-gradient-to-br from-amber-500 to-amber-600 text-white"
          : "bg-muted text-muted-foreground"
      )}>
        {avatar || name.charAt(0)}
      </div>
      <div className="flex-1">
        <p className={cn(
          "font-medium",
          isCurrentUser && "text-primary"
        )}>
          {name}
          {isCurrentUser && <span className="text-xs text-muted-foreground ml-2">(You)</span>}
        </p>
      </div>
      <div className="text-right">
        <p className="font-bold">{score}</p>
        <p className="text-[10px] text-muted-foreground">deliveries</p>
      </div>
    </div>
  )
}

// Reward Card Component
interface RewardCardProps {
  title: string
  description: string
  icon: React.ElementType
  points: number
  claimed?: boolean
  onClaim?: () => void
  className?: string
}

export function RewardCard({ 
  title, 
  description, 
  icon: Icon, 
  points, 
  claimed,
  onClaim,
  className 
}: RewardCardProps) {
  return (
    <div className={cn(
      "glass-card rounded-xl p-4",
      claimed && "opacity-60",
      className
    )}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-1">
          <Star className="w-4 h-4 text-warning fill-warning" />
          <span className="text-sm font-semibold">{points} points</span>
        </div>
        {claimed ? (
          <span className="text-xs text-success font-medium">Claimed</span>
        ) : (
          <button 
            onClick={onClaim}
            className="neon-button px-4 py-1.5 rounded-full text-xs font-medium text-primary-foreground"
          >
            Claim
          </button>
        )}
      </div>
    </div>
  )
}

// Export achievement icons for use elsewhere
export const achievementIcons = {
  Trophy,
  Star,
  Zap,
  Target,
  Flame,
  Award,
  Medal,
  Crown,
  Rocket,
  Shield
}
