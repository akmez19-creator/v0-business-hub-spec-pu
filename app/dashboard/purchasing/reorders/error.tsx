'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export default function ReordersError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <AlertTitle>Reorders could not be loaded</AlertTitle>
        <AlertDescription>
          Your saved purchasing records have not been changed. Check that you are signed in as a buyer and retry.
        </AlertDescription>
      </Alert>
      <div className="flex items-center gap-2">
        <Button onClick={reset}>Retry</Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard/purchasing">Back to Imports</Link>
        </Button>
      </div>
    </div>
  )
}
