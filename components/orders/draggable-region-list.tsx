'use client'

import { useRef, useState, useCallback } from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DraggableRegionListProps {
  region: string
  itemCount: number
  children: React.ReactNode[]
  onReorder: (region: string, fromIndex: number, toIndex: number) => void
}

export function DraggableRegionList({ region, itemCount, children, onReorder }: DraggableRegionListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const dragStartY = useRef(0)
  const dragCurrentItem = useRef<number | null>(null)

  // ── Touch handlers ──
  const handleTouchStart = useCallback((index: number, e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY
    dragCurrentItem.current = index
    setDragIndex(index)
    setOverIndex(index)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragCurrentItem.current === null || !containerRef.current) return
    e.preventDefault()
    const touch = e.touches[0]
    const container = containerRef.current
    const children = container.querySelectorAll('[data-drag-item]')
    
    let newOver = dragCurrentItem.current
    children.forEach((child, idx) => {
      const rect = child.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      if (touch.clientY > midY) newOver = idx
    })
    
    setOverIndex(Math.max(0, Math.min(newOver, itemCount - 1)))
  }, [itemCount])

  const handleTouchEnd = useCallback(() => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      onReorder(region, dragIndex, overIndex)
    }
    setDragIndex(null)
    setOverIndex(null)
    dragCurrentItem.current = null
  }, [dragIndex, overIndex, onReorder, region])

  // ── Mouse drag (for desktop) ──
  const handleMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault()
    dragStartY.current = e.clientY
    dragCurrentItem.current = index
    setDragIndex(index)
    setOverIndex(index)

    const handleMouseMove = (ev: MouseEvent) => {
      if (!containerRef.current) return
      const container = containerRef.current
      const items = container.querySelectorAll('[data-drag-item]')
      let newOver = index
      items.forEach((child, idx) => {
        const rect = child.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        if (ev.clientY > midY) newOver = idx
      })
      setOverIndex(Math.max(0, Math.min(newOver, itemCount - 1)))
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      setDragIndex((prevDragIndex) => {
        setOverIndex((prevOverIndex) => {
          if (prevDragIndex !== null && prevOverIndex !== null && prevDragIndex !== prevOverIndex) {
            onReorder(region, prevDragIndex, prevOverIndex)
          }
          return null
        })
        return null
      })
      dragCurrentItem.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [itemCount, onReorder, region])

  // Build visual order
  const getDisplayOrder = () => {
    const indices = Array.from({ length: itemCount }, (_, i) => i)
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      const item = indices.splice(dragIndex, 1)[0]
      indices.splice(overIndex, 0, item)
    }
    return indices
  }

  const displayOrder = getDisplayOrder()

  return (
    <div
      ref={containerRef}
      className="border-t border-border divide-y divide-border/50"
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {displayOrder.map((originalIdx, visualIdx) => (
        <div
          key={originalIdx}
          data-drag-item
          className={cn(
            'flex items-stretch transition-all duration-150',
            dragIndex === originalIdx && 'opacity-60 scale-[0.98] bg-primary/5 rounded-lg',
            overIndex === visualIdx && dragIndex !== null && dragIndex !== originalIdx && 'border-t-2 border-t-primary',
          )}
        >
          {/* Drag handle + sequence number */}
          <div
            className="flex flex-col items-center justify-center gap-0.5 pl-2 pr-1 cursor-grab active:cursor-grabbing select-none touch-none"
            onTouchStart={(e) => handleTouchStart(originalIdx, e)}
            onMouseDown={(e) => handleMouseDown(originalIdx, e)}
          >
            <span className={cn(
              'w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold tabular-nums',
              'bg-primary/10 text-primary'
            )}>
              {visualIdx + 1}
            </span>
            <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50" />
          </div>
          {/* Content */}
          <div className="flex-1 min-w-0">
            {children[originalIdx]}
          </div>
        </div>
      ))}
    </div>
  )
}
