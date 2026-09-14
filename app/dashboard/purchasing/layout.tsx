import type { ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'

export default function PurchasingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-right" closeButton />
    </>
  )
}
