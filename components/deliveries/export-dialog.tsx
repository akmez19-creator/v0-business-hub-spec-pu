'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Download, Loader2, FileSpreadsheet, CheckCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'

type ExportScope = 'current_filters' | 'all' | 'today' | 'this_week' | 'this_month'

export function ExportDeliveriesDialog() {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [done, setDone] = useState(false)
  const [scope, setScope] = useState<ExportScope>('current_filters')
  const [exportCount, setExportCount] = useState(0)

  const handleExport = async () => {
    setExporting(true)
    setDone(false)

    try {
      // Build query params based on scope
      const params = new URLSearchParams()
      params.set('scope', scope)

      // If scope is current_filters, pass along the current URL search params
      if (scope === 'current_filters') {
        const urlParams = new URLSearchParams(window.location.search)
        urlParams.forEach((value, key) => {
          if (key !== 'page' && key !== 'pageSize') {
            params.set(key, value)
          }
        })
      }

      const res = await fetch(`/api/export-deliveries?${params.toString()}`)
      if (!res.ok) throw new Error('Export failed')

      const { deliveries, riders, contractors } = await res.json()
      setExportCount(deliveries.length)

      // Build rider/contractor name maps
      const riderMap: Record<string, string> = {}
      for (const r of riders || []) { riderMap[r.id] = r.name }
      const contractorMap: Record<string, string> = {}
      for (const c of contractors || []) { contractorMap[c.id] = c.name }

      // Dynamically import xlsx to avoid bundler issues
      const XLSX = await import('xlsx')

      // Column headers: exact order as requested
      const headers: string[] = [
        'RTE', 'Entry Date', 'Delivery Date', 'INDEX',
        'Customer Name', 'Contact #1', 'Contact #2', 'Region',
        'Qty', 'Products', 'Amt', 'Payment Method',
        'SalesType', 'Notes', 'MEDIUM', 'Rider', 'Status', 'Contractor',
      ]

      // Build Excel rows
      const rows = deliveries.map((d: Record<string, unknown>) => ({
        'RTE': d.rte || '',
        'Entry Date': d.entry_date || '',
        'Delivery Date': d.delivery_date || '',
        'INDEX': d.index_no || '',
        'Customer Name': d.customer_name || '',
        'Contact #1': d.contact_1 || '',
        'Contact #2': d.contact_2 || '',
        'Region': d.locality || '',
        'Qty': d.qty || 0,
        'Products': d.products || '',
        'Amt': d.amount || 0,
        'Payment Method': d.payment_method || '',
        'SalesType': d.sales_type || '',
        'Notes': d.notes || '',
        'MEDIUM': d.medium || '',
        'Rider': d.rider_id ? riderMap[d.rider_id as string] || '' : '',
        'Status': d.status || '',
        'Contractor': d.contractor_id ? contractorMap[d.contractor_id as string] || '' : '',
      }))

      // Create workbook — always include headers even with 0 rows
      const ws = XLSX.utils.json_to_sheet(rows, { header: headers })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Deliveries')

      // Auto-size columns
      const colWidths = headers.map(key => ({
        wch: Math.max(key.length + 2, 14)
      }))
      ws['!cols'] = colWidths

      // Generate filename with date
      const today = new Date().toISOString().split('T')[0]
      const scopeLabel = scope === 'current_filters' ? 'filtered' : scope === 'all' ? 'all' : scope.replace('_', '-')
      XLSX.writeFile(wb, `deliveries-${scopeLabel}-${today}.xlsx`)

      setDone(true)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setDone(false) } }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Export Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Export Deliveries
          </DialogTitle>
          <DialogDescription>
            Export delivery records to an Excel file.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-emerald-500" />
            </div>
            <p className="text-sm font-semibold text-foreground">Export Complete</p>
            <p className="text-xs text-muted-foreground">{exportCount.toLocaleString()} deliveries exported</p>
            <Button variant="outline" onClick={() => setOpen(false)} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {/* Scope */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Export Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as ExportScope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current_filters">Current Filters (what you see)</SelectItem>
                    <SelectItem value="all">All Deliveries</SelectItem>
                    <SelectItem value="today">Today Only</SelectItem>
                    <SelectItem value="this_week">This Week</SelectItem>
                    <SelectItem value="this_month">This Month</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Columns info */}
              <p className="text-xs text-muted-foreground">
                Columns: RTE, Entry Date, Delivery Date, INDEX, Customer Name, Contact, Region, Qty, Products, Amt, Payment Method, SalesType, Notes, MEDIUM, Rider, Status, Contractor
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleExport} disabled={exporting} className="gap-2">
                {exporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Export
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
