'use client'

/**
 * Imports a purchase document - receipt, invoice, WhatsApp screenshot, or an
 * Excel/CSV price list - and turns it into draft lines in one go.
 *
 * TWO ROUTES, DELIBERATELY DIFFERENT:
 *  - Spreadsheets are PARSED (exact values, no model involved). Asking a model
 *    to retype numbers it can already read exactly can only add error.
 *  - Photos and PDFs go to the vision model, which reads WHAT IS PRINTED and is
 *    never asked to guess which catalogue product a line refers to.
 *
 * Nothing here saves anything. Every line lands in the grid needing product
 * confirmation, because the matcher provably ranks a decoy duplicate as an
 * "exact" match - so auto-linking an imported document would silently attach
 * purchases to the wrong product.
 *
 * GALLERY FIRST, not the camera: the owner's own documents arrive as WhatsApp
 * screenshots and emailed PDFs far more often than as fresh photos, so there is
 * no `capture` attribute forcing the camera on mobile.
 */

import { useRef, useState, useTransition } from 'react'
import { AlertTriangle, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { importPurchaseDocumentAction, type ImportedDoc } from '@/app/dashboard/purchasing/local/actions'

const ACCEPT = 'image/*,application/pdf,.xlsx,.xlsm,.xls,.csv'

export function DocumentImport({
  onImported,
  disabled,
  order,
  onBusyChange,
}: {
  onImported: (doc: ImportedDoc) => void
  disabled?: boolean
  order?: { id: string; revision: number }
  onBusyChange?: (busy: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const handleFile = (file: File) => {
    if (disabled || pending) return
    setError(null)
    setFileName(file.name)
    onBusyChange?.(true)
    const form = new FormData()
    form.set('file', file)
    if (order) { form.set('orderId', order.id); form.set('orderRevision', String(order.revision)) }
    startTransition(async () => {
      try {
        const doc = await importPurchaseDocumentAction(form)
        if (!doc.lines.length) {
          // An empty read is NOT the same as a broken one, and saying "failed"
          // would send the owner looking for a fault that is not there.
          setError(
            'The document was read, but no priced lines were found on it. Check it is the page with the items table.',
          )
          return
        }
        onImported(doc)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read that document')
      } finally { onBusyChange?.(false) }
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Import the document</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {/*
              * Was "every line still needs its product confirmed" - untrue now
              * that linking is automatic, and it promised the buyer work that
              * no longer exists.
              */}
            Photo of a receipt, a supplier PDF, a WhatsApp screenshot, or an Excel/CSV price list.
            Products are matched automatically; anything unclear is asked about rather than guessed.
          </p>
        </div>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files?.[0]
          if (f) handleFile(f)
        }}
        className={cn(
          'mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
          (disabled || pending) && 'pointer-events-none opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled || pending}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            // Reset so choosing the SAME file twice still fires a change event.
            e.target.value = ''
          }}
        />
        {pending ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            <span className="text-sm text-foreground">Reading {fileName}…</span>
            <span className="text-xs text-muted-foreground">
              A photo of a full invoice usually takes a few seconds.
            </span>
          </>
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-foreground">Choose a file or drop it here</span>
            <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="h-3 w-3" aria-hidden="true" /> Photo or screenshot
              </span>
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3" aria-hidden="true" /> PDF
              </span>
              <span className="inline-flex items-center gap-1">
                <FileSpreadsheet className="h-3 w-3" aria-hidden="true" /> Excel or CSV
              </span>
            </span>
          </>
        )}
      </label>

      {error ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}
