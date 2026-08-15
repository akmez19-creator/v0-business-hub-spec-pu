'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { format } from 'date-fns'
import { AlertTriangle, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import type { Conversation } from './messenger-channel'

type Message = {
  id: string
  text: string
  createdTime: string
  fromPage: boolean
  fromName: string
  attachments: { type: string; url: string | null }[]
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function InboxThread({
  conversation,
  pageId,
  showPageName = false,
  onSent,
}: {
  conversation: Conversation
  pageId?: string
  /** In the merged view, make it obvious which business you are replying as. */
  showPageName?: boolean
  onSent: () => void
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const { toast } = useToast()

  const { data, isLoading, mutate } = useSWR<{ success: boolean; messages?: Message[]; error?: string }>(
    `/api/inbox/messages?id=${encodeURIComponent(conversation.id)}` +
      (pageId ? `&pageId=${encodeURIComponent(pageId)}` : ''),
    fetcher,
    { refreshInterval: 30_000 },
  )

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    const recipientId = conversation.customer?.id
    if (!recipientId) {
      toast({ title: 'No recipient', description: 'This conversation has no customer attached.', variant: 'destructive' })
      return
    }

    setSending(true)
    try {
      const res = await fetch('/api/inbox/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientId, text, pageId }),
      })
      const json = (await res.json()) as { success: boolean; error?: string; usedHumanAgentTag?: boolean }
      if (!json.success) {
        toast({ title: 'Message not sent', description: json.error ?? 'Unknown error', variant: 'destructive' })
        return
      }
      setDraft('')
      mutate()
      onSent()
      if (json.usedHumanAgentTag) {
        toast({
          title: 'Sent outside the 24h window',
          description: 'Delivered using the human agent tag.',
        })
      }
    } catch (e) {
      toast({
        title: 'Message not sent',
        description: e instanceof Error ? e.message : 'Network error',
        variant: 'destructive',
      })
    } finally {
      setSending(false)
    }
  }

  const messages = data?.messages ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-semibold">{conversation.customer?.name ?? 'Unknown customer'}</h3>
          <p className="text-xs text-muted-foreground">
            <span className="tabular-nums">{conversation.messageCount} messages</span>
            {showPageName ? <span> · via {conversation.pageName}</span> : null}
          </p>
        </div>
        {conversation.outsideWindow ? (
          <Badge variant="outline" className="gap-1.5 border-amber-500/40 text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            24h window closed
          </Badge>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-2/3" />
            ))}
          </div>
        ) : data && !data.success ? (
          <p className="text-sm text-destructive">{data.error}</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages in this conversation.</p>
        ) : (
          <ul
            // Centre the conversation column: bubbles stranded at the edge of
            // a 2000px pane are much harder to scan.
            className="mx-auto flex w-full max-w-[1100px] flex-col gap-3"
          >
            {messages.map((m) => (
              <li key={m.id} className={`flex ${m.fromPage ? 'justify-end' : 'justify-start'}`}>
                <div
                  // 70% of a 2000px-wide pane is an unreadable 1400px line, so
                  // cap on measure (ch) as well as on the percentage.
                  className={`flex max-w-[70%] flex-col gap-1 rounded-xl px-4 py-2.5 lg:max-w-[68ch] ${
                    m.fromPage ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  }`}
                >
                  {m.text ? <p className="text-pretty text-sm leading-relaxed">{m.text}</p> : null}
                  {m.attachments.map((a, i) =>
                    a.url ? (
                      // Customer-sent photos are hosted by Facebook, which does
                      // not hotlink-block, so these render directly.
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline underline-offset-2 opacity-80"
                      >
                        Attachment ({a.type})
                      </a>
                    ) : null,
                  )}
                  <span className="text-[11px] opacity-60 tabular-nums">
                    {m.createdTime ? format(new Date(m.createdTime), 'd MMM HH:mm') : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-4">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes a newline. isComposing guards CJK
            // IME confirmation, which also fires Enter.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="Write a reply..."
          rows={3}
          className="resize-none"
          aria-label="Reply message"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {showPageName ? `Replying as ${conversation.pageName} · ` : ''}
            Enter to send, Shift+Enter for a new line
          </p>
          <Button onClick={send} disabled={!draft.trim() || sending} size="sm">
            <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  )
}
