'use client'

import React from "react"
import { useState, useCallback } from 'react'
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
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Users } from 'lucide-react'
import { importClients } from '@/lib/client-actions'
import * as XLSX from 'xlsx'

interface ImportClientsDialogProps {
  onSuccess: () => void
}

// Column mapping for your Excel format - maps to client fields
const COLUMN_MAPPING: Record<string, string> = {
  'Customer Name': 'name',
  'customer_name': 'name',
  'name': 'name',
  'Contact #1': 'phone',
  'Contact#1': 'phone',
  'contact_1': 'phone',
  'phone': 'phone',
  'Contact #2': 'phone2',
  'Contact#2': 'phone2',
  'contact_2': 'phone2',
  'Region': 'city',
  'region': 'city',
  'city': 'city',
  'address': 'address',
  'email': 'email',
  'Notes': 'notes',
  'notes': 'notes',
}

interface ParsedClient {
  name: string
  phone?: string
  phone2?: string
  city?: string
  address?: string
  email?: string
  notes?: string
}

export function ImportClientsDialog({ onSuccess }: ImportClientsDialogProps) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [previewData, setPreviewData] = useState<ParsedClient[]>([])
  const [result, setResult] = useState<{
    success: boolean
    totalRows?: number
    successfulRows?: number
    failedRows?: number
    duplicatesSkipped?: number
    error?: string
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const parseExcelFile = async (file: File): Promise<ParsedClient[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      
      reader.onload = (e) => {
        try {
          const data = e.target?.result
          const workbook = XLSX.read(data, { type: 'binary' })
          const sheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' })
          
          // Parse and map the data
          const clients: ParsedClient[] = []
          const seenPhones = new Set<string>()
          
          for (const row of jsonData as Record<string, unknown>[]) {
            const client: ParsedClient = { name: '' }
            
            // Map columns from your Excel format
            for (const [excelCol, value] of Object.entries(row)) {
              const mappedField = COLUMN_MAPPING[excelCol] || COLUMN_MAPPING[excelCol.toLowerCase()]
              if (mappedField && value) {
                const strValue = String(value).trim()
                if (strValue) {
                  if (mappedField === 'phone' || mappedField === 'phone2') {
                    // Format phone number for Mauritius
                    let phone = strValue.replace(/\D/g, '')
                    if (phone.length === 7) {
                      phone = `+230 ${phone.slice(0, 4)} ${phone.slice(4)}`
                    } else if (phone.length === 8) {
                      phone = `+230 ${phone.slice(0, 4)} ${phone.slice(4)}`
                    }
                    if (mappedField === 'phone') {
                      client.phone = phone
                    } else {
                      client.phone2 = phone
                    }
                  } else {
                    (client as Record<string, string>)[mappedField] = strValue
                  }
                }
              }
            }
            
            // Only add if we have a name
            if (client.name) {
              // Combine notes if we have a second phone
              if (client.phone2) {
                client.notes = client.notes 
                  ? `${client.notes} | Alt Phone: ${client.phone2}`
                  : `Alt Phone: ${client.phone2}`
              }
              
              // Skip duplicates based on phone number
              const phoneKey = client.phone?.replace(/\D/g, '') || ''
              if (phoneKey && seenPhones.has(phoneKey)) {
                continue
              }
              if (phoneKey) {
                seenPhones.add(phoneKey)
              }
              
              clients.push(client)
            }
          }
          
          resolve(clients)
        } catch (error) {
          reject(error)
        }
      }
      
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsBinaryString(file)
    })
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.name.endsWith('.csv') || droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      setFile(droppedFile)
      setResult(null)
      
      // Parse and preview
      try {
        const clients = await parseExcelFile(droppedFile)
        setPreviewData(clients.slice(0, 5))
      } catch {
        setPreviewData([])
      }
    }
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setResult(null)
      
      // Parse and preview
      try {
        const clients = await parseExcelFile(selectedFile)
        setPreviewData(clients.slice(0, 5))
      } catch {
        setPreviewData([])
      }
    }
  }

  const handleImport = async () => {
    if (!file) return

    setIsLoading(true)
    setResult(null)

    try {
      const clients = await parseExcelFile(file)
      
      if (clients.length === 0) {
        setResult({
          success: false,
          error: 'No valid client data found. Make sure your file has a "Customer Name" column.'
        })
        setIsLoading(false)
        return
      }
      
      // Import clients (the action will handle duplicates on server side)
      const importResult = await importClients(clients.map(c => ({
        name: c.name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        city: c.city,
        notes: c.notes,
      })))

      if (importResult.error) {
        setResult({
          success: false,
          error: importResult.error
        })
      } else {
        setResult({
          success: true,
          totalRows: clients.length,
          successfulRows: importResult.imported,
          failedRows: clients.length - (importResult.imported || 0),
        })
        onSuccess()
      }
    } catch (error) {
      setResult({
        success: false,
        error: 'Failed to parse file. Please check the format.'
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setFile(null)
    setResult(null)
    setPreviewData([])
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Clients from Delivery Sheet</DialogTitle>
          <DialogDescription>
            Upload your delivery Excel file. Client data (Customer Name, Contact #1, Contact #2, Region) will be extracted and added to the database. Duplicates will be skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Drop Zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
                <div className="text-left">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-2">
                  Drag and drop your delivery Excel file here
                </p>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                  id="client-file-upload"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('client-file-upload')?.click()}
                >
                  Browse Files
                </Button>
              </>
            )}
          </div>

          {/* Preview */}
          {previewData.length > 0 && !result && (
            <div className="mt-4 border rounded-lg overflow-hidden">
              <div className="bg-muted px-4 py-2 flex items-center gap-2">
                <Users className="h-4 w-4" />
                <span className="text-sm font-medium">Preview (first 5 clients)</span>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2">Name</th>
                      <th className="text-left px-4 py-2">Phone</th>
                      <th className="text-left px-4 py-2">Locality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((client, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-2">{client.name}</td>
                        <td className="px-4 py-2">{client.phone || '-'}</td>
                        <td className="px-4 py-2">{client.city || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result Display */}
          {result && (
            <div className={`mt-4 p-4 rounded-lg ${
              result.success ? 'bg-green-50 dark:bg-green-950' : 'bg-red-50 dark:bg-red-950'
            }`}>
              <div className="flex items-start gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                )}
                <div>
                  {result.success ? (
                    <>
                      <p className="font-medium text-green-800 dark:text-green-200">
                        Import Successful
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        {result.successfulRows} of {result.totalRows} clients imported
                        {result.failedRows && result.failedRows > 0 && ` (${result.failedRows} duplicates skipped)`}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-red-800 dark:text-red-200">
                        Import Failed
                      </p>
                      <p className="text-sm text-red-700 dark:text-red-300">
                        {result.error}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Expected Format */}
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium mb-2">Your Excel columns will be mapped as:</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-muted-foreground">Customer Name</span> → Name</div>
              <div><span className="text-muted-foreground">Contact #1</span> → Phone</div>
              <div><span className="text-muted-foreground">Contact #2</span> → Alt Phone (in notes)</div>
              <div><span className="text-muted-foreground">Locality</span> → City</div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {result?.success ? 'Close' : 'Cancel'}
          </Button>
          {!result?.success && (
            <Button onClick={handleImport} disabled={!file || isLoading}>
              {isLoading ? 'Importing...' : `Import ${previewData.length > 0 ? 'Clients' : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
