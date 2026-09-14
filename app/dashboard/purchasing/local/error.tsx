'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export default function LocalPurchasingError({ reset }: { reset: () => void }) {
  return <section className="flex flex-col gap-4"><Alert variant="destructive"><AlertTitle>Local purchasing could not be loaded</AlertTitle><AlertDescription>Try loading this page again. Supplier prices and receipts are available only to signed-in admins and managers; no placeholder records are shown.</AlertDescription></Alert><div className="flex flex-wrap gap-2"><Button onClick={reset}>Try again</Button><Button asChild variant="outline"><Link href="/dashboard">Back to dashboard</Link></Button></div></section>
}
