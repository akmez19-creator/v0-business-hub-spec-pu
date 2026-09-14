'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
const ToolsCustomerReplyPrompt = dynamic(() => import('@/components/tools/tools-customer-reply-prompt').then(m => m.ToolsCustomerReplyPrompt))

/** Header button that reveals the customer-reply instruction editor in place, mirroring AutopilotLauncher. */
export function ReplyPromptLauncher() {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" variant={open ? 'default' : 'outline'} aria-expanded={open} aria-controls="inbox-reply-prompt" onClick={() => setOpen(v => !v)}>
      <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />AI instructions
    </Button>
    {open && <div id="inbox-reply-prompt" className="basis-full w-full pt-4"><ToolsCustomerReplyPrompt /></div>}
  </>
}
