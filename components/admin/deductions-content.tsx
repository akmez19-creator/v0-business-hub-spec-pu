'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingDown, AlertCircle } from 'lucide-react'

interface AdminDeductionsContentProps {
  contractors: Array<{
    id: string
    name: string
  }>
}

export function AdminDeductionsContent({ contractors }: AdminDeductionsContentProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Deductions Management</h1>
        <p className="text-muted-foreground">Manage deductions for contractors and riders</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5" />
            Deductions
          </CardTitle>
          <CardDescription>
            Create and manage deductions for stock missing, cash short, damages, etc.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <AlertCircle className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-center font-medium">Coming Soon</p>
            <p className="text-sm text-center mt-2">
              Deductions management will be available in a future update
            </p>
            <p className="text-xs text-center mt-4 text-muted-foreground">
              {contractors.length} contractors available
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
