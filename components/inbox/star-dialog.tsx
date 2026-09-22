'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Loader2, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ThreadStar } from '@/lib/inbox/thread-stars'

const MIN_NOTE = 12

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing: ThreadStar | null
  customerName: string
  onSave: (note: string | null) => Promise<boolean>
}

/**
 * A star is an escalation, so it cannot be silent: the agent has to write what
 * the problem is and what they have already tried, in enough words for the
 * person picking it up to act without re-reading the whole chat.
 */
export function StarDialog({ open, onOpenChange, existing, customerName, onSave }: Props) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)

  useEffect(() => {
    if (open) setNote(existing?.note ?? '')
  }, [open, existing?.note])

  const trimmed = note.replace(/\s+/g, ' ').trim()
  const tooShort = trimmed.length < MIN_NOTE

  const save = async () => {
    if (tooShort) return
    setBusy('save')
    const ok = await onSave(trimmed)
    setBusy(null)
    if (ok) onOpenChange(false)
  }

  const remove = async () => {
    setBusy('remove')
    const ok = await onSave(null)
    setBusy(null)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-4 w-4 fill-amber-500 text-amber-500" aria-hidden="true" />
            {existing ? 'Update the star' : `Star ${customerName}`}
          </DialogTitle>
          <DialogDescription>
            Starring puts this conversation in the Starred list for the whole team. Explain the issue fully:
            what the customer wants, what went wrong, and what you already did.
          </DialogDescription>
        </DialogHeader>

        {existing ? (
          <p className="text-xs text-muted-foreground">
            Starred by {existing.starredByName ?? 'a teammate'} · {format(new Date(existing.starredAt), 'd MMM HH:mm')}
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="star-note">What is the issue?</Label>
          <Textarea
            id="star-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={5}
            autoFocus
            placeholder="e.g. Paid Rs 1,200 by Juice on 14 Sep for a Foot Massager, never delivered. Rider says address not found; customer says nobody called. Needs a manager to confirm the payment and reschedule."
            aria-describedby="star-note-hint"
          />
          <p id="star-note-hint" className={`text-xs ${tooShort && trimmed.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {tooShort ? `At least ${MIN_NOTE} characters - a full sentence, not a word.` : `${trimmed.length} characters`}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {existing ? (
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={busy !== null}>
              {busy === 'remove' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Remove star
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>Cancel</Button>
            <Button type="button" onClick={save} disabled={tooShort || busy !== null}>
              {busy === 'save' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Star className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
              {existing ? 'Save' : 'Star it'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
