'use client'

import React, { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react'

interface ImportHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type FileStatus = 'queued' | 'uploading' | 'done' | 'error'

interface QueuedFile {
  file: File
  status: FileStatus
  result?: {
    totalRows: number
    newOrders: number
    duplicatesSkipped: number
    clientsUpserted: number
  }
  error?: string
}

export function ImportHistoryDialog({ open, onOpenChange, onSuccess }: ImportHistoryDialogProps) {
  const [files, setFiles] = useState<QueuedFile[]>([])
  const [running, setRunning] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((list: FileList | File[]) => {
    const next: QueuedFile[] = []
    for (const f of Array.from(list)) {
      if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) {
        next.push({ file: f, status: 'queued' })
      }
    }
    setFiles(prev => [...prev, ...next])
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const runImport = async () => {
    setRunning(true)
    // Upload files one by one so huge batches never overload a single request
    for (let i = 0; i < files.length; i++) {
      if (files[i].status === 'done') continue
      setFiles(prev => prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading', error: undefined } : f)))
      try {
        const fd = new FormData()
        fd.append('file', files[i].file)
        const res = await fetch('/api/clients/import-history', { method: 'POST', body: fd })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        setFiles(prev => prev.map((f, idx) => (idx === i ? { ...f, status: 'done', result: json } : f)))
      } catch (err) {
        setFiles(prev => prev.map((f, idx) => (idx === i
          ? { ...f, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
          : f)))
      }
    }
    setRunning(false)
    onSuccess()
  }

  const handleClose = (o: boolean) => {
    if (running) return
    if (!o) setFiles([])
    onOpenChange(o)
  }

  const doneCount = files.filter(f => f.status === 'done').length
  const totals = files.reduce(
    (acc, f) => {
      if (f.result) {
        acc.newOrders += f.result.newOrders
        acc.duplicates += f.result.duplicatesSkipped
        acc.clients += f.result.clientsUpserted
      }
      return acc
    },
    { newOrders: 0, duplicates: 0, clients: 0 }
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Import Past Order History</DialogTitle>
          <DialogDescription>
            Upload one or many Excel files (MAIN_DEL format). Orders are matched by their INDEX so
            re-uploading the same file never double-counts. Client ratings are recalculated automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div
            className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
              isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }`}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={e => { e.preventDefault(); setIsDragging(false) }}
            onDrop={handleDrop}
          >
            <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="mb-2 text-sm text-muted-foreground">
              Drag and drop Excel files here (you can select many at once)
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
            />
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={running}>
              Browse Files
            </Button>
          </div>

          {files.length > 0 && (
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
              {files.map((f, idx) => (
                <div key={`${f.file.name}-${idx}`} className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.file.name}</p>
                    {f.status === 'done' && f.result && (
                      <p className="text-xs text-muted-foreground">
                        {f.result.newOrders.toLocaleString()} new orders · {f.result.duplicatesSkipped.toLocaleString()} duplicates skipped · {f.result.clientsUpserted.toLocaleString()} clients updated
                      </p>
                    )}
                    {f.status === 'error' && (
                      <p className="text-xs text-destructive">{f.error}</p>
                    )}
                    {f.status === 'queued' && (
                      <p className="text-xs text-muted-foreground">{(f.file.size / 1024).toFixed(0)} KB · queued</p>
                    )}
                    {f.status === 'uploading' && (
                      <p className="text-xs text-muted-foreground">Processing…</p>
                    )}
                  </div>
                  {f.status === 'uploading' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
                  {f.status === 'done' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
                  {f.status === 'error' && <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />}
                  {f.status === 'queued' && !running && (
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${f.file.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {doneCount > 0 && (
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{doneCount}/{files.length} files done</Badge>
              <Badge variant="secondary">{totals.newOrders.toLocaleString()} new orders</Badge>
              <Badge variant="secondary">{totals.duplicates.toLocaleString()} duplicates skipped</Badge>
              <Badge variant="secondary">{totals.clients.toLocaleString()} clients updated</Badge>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={running}>
            Close
          </Button>
          <Button onClick={runImport} disabled={running || files.every(f => f.status === 'done') || files.length === 0}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing {doneCount + 1}/{files.length}…
              </>
            ) : (
              `Import ${files.filter(f => f.status !== 'done').length} file(s)`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
