'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { mediaSrc } from '@/lib/media-url'
import { ZoomIn } from 'lucide-react'

/**
 * A thumbnail that opens full-size on tap.
 *
 * Used inside rows that are themselves tappable, so the click is stopped from
 * propagating: tapping the IMAGE zooms, tapping the ROW still does whatever the
 * row does. Without that the lightbox would swallow the row's primary action.
 */
export function ImageLightbox({
  src,
  alt,
  caption,
  className = 'h-12 w-12',
}: {
  src: string | null
  alt: string
  /** Shown under the enlarged image - typically the product name and shelf. */
  caption?: string
  /** Sizing for the thumbnail button. */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const resolved = mediaSrc(src)

  // With no image there is nothing to enlarge, so render a plain placeholder
  // rather than a button that opens an empty dialog.
  if (!resolved) {
    return (
      <div
        className={`${className} flex shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground`}
      >
        No photo
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={e => {
          // The row underneath opens the count sheet - don't trigger both.
          e.stopPropagation()
          setOpen(true)
        }}
        aria-label={`View larger image of ${alt}`}
        className={`${className} group relative shrink-0 overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
      >
        <img
          src={resolved || '/placeholder.svg'}
          alt={alt}
          className="h-full w-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-foreground/45 opacity-0 transition-opacity group-hover:opacity-100">
          <ZoomIn className="h-4 w-4 text-background" aria-hidden="true" />
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/*
          No `relative` here. DialogContent is `fixed top-[50%]
          translate-y-[-50%]`; adding `relative` wins the position conflict and
          drops the dialog halfway down the page, off the bottom of the screen.
        */}
        <DialogContent
          className="w-[94vw] max-w-[900px] gap-3 p-3 sm:max-w-[900px]"
          onClick={e => e.stopPropagation()}
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img
            src={resolved || '/placeholder.svg'}
            alt={alt}
            className="max-h-[80vh] w-full rounded-md object-contain"
          />
          {caption && (
            <p className="text-center text-sm text-muted-foreground">
              {caption}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
