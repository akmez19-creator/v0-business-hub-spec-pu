'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function OrderPrintButton() {
  return <Button type="button" onClick={() => window.print()}><Printer data-icon="inline-start" />Print / Save as PDF</Button>
}
