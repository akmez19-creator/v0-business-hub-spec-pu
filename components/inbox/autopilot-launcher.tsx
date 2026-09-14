'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
const AutopilotPanel=dynamic(()=>import('./autopilot-panel').then(m=>m.AutopilotPanel))

export function AutopilotLauncher() {
  const [open,setOpen]=useState(false)
  return <>
    <Button type="button" variant={open?'default':'outline'} aria-expanded={open} aria-controls="inbox-autopilot-controls" onClick={()=>setOpen(v=>!v)}>
      <Bot className="mr-2 h-4 w-4" aria-hidden="true"/>Autopilot
    </Button>
    {open&&<div id="inbox-autopilot-controls" className="basis-full w-full pt-4"><AutopilotPanel onClose={()=>setOpen(false)}/></div>}
  </>
}
