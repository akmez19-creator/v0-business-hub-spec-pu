'use client'

import { useState, useRef } from 'react'
import { updateCompanySettings, updateStampUrl, type CompanySettings } from '@/lib/company-settings-actions'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Save, Loader2, Upload, Stamp, X } from 'lucide-react'
import { upload } from '@vercel/blob/client'
import Image from 'next/image'

export function CompanySettingsForm({ settings }: { settings: CompanySettings | null }) {
  const [saving, setSaving] = useState(false)
  const [uploadingStamp, setUploadingStamp] = useState(false)
  const [stampUrl, setStampUrl] = useState<string | null>(settings?.stamp_url || null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const stampInputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    const formData = new FormData(e.currentTarget)
    const result = await updateCompanySettings(formData)

    if (result.error) {
      setMessage({ type: 'error', text: result.error })
    } else {
      setMessage({ type: 'success', text: 'Settings saved successfully' })
    }
    setSaving(false)
    setTimeout(() => setMessage(null), 3000)
  }

  async function handleStampUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingStamp(true)
    setMessage(null)

    try {
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
      })

      const result = await updateStampUrl(blob.url)
      if (result.error) {
        setMessage({ type: 'error', text: result.error })
      } else {
        setStampUrl(blob.url)
        setMessage({ type: 'success', text: 'Official stamp uploaded successfully' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to upload stamp' })
    } finally {
      setUploadingStamp(false)
      setTimeout(() => setMessage(null), 3000)
    }
  }

  async function handleRemoveStamp() {
    setUploadingStamp(true)
    const result = await updateStampUrl('')
    if (!result.error) {
      setStampUrl(null)
      setMessage({ type: 'success', text: 'Stamp removed' })
    }
    setUploadingStamp(false)
    setTimeout(() => setMessage(null), 3000)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="company_name">Company Name</Label>
          <Input id="company_name" name="company_name" defaultValue={settings?.company_name || ''} placeholder="Your Company Ltd" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="brn">BRN (Business Registration Number)</Label>
          <Input id="brn" name="brn" defaultValue={settings?.brn || ''} placeholder="C19167358" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vat_number">VAT Number</Label>
          <Input id="vat_number" name="vat_number" defaultValue={settings?.vat_number || ''} placeholder="VAT12345678" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vat_rate">VAT Rate (%)</Label>
          <Input id="vat_rate" name="vat_rate" type="number" step="0.01" min="0" max="100" defaultValue={settings?.vat_rate ?? 15} />
          <p className="text-xs text-muted-foreground">All prices are VAT inclusive. This rate is used to calculate the VAT portion on invoices.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="company_address">Company Address</Label>
        <Input id="company_address" name="company_address" defaultValue={settings?.company_address || ''} placeholder="123 Main Street, Port Louis, Mauritius" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" defaultValue={settings?.phone || ''} placeholder="+230 5XXX XXXX" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={settings?.email || ''} placeholder="info@company.com" />
        </div>
      </div>

      {/* Official Stamp Upload */}
      <div className="border-t pt-6 mt-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Stamp className="h-5 w-5 text-muted-foreground" />
            <Label className="text-base font-semibold">Official Company Stamp</Label>
          </div>
          <p className="text-sm text-muted-foreground">
            Upload an official stamp image to be used on payslips, receipts, and other official documents.
          </p>
          
          <div className="flex items-start gap-4">
            {stampUrl ? (
              <div className="relative">
                <div className="border rounded-lg p-2 bg-muted/30">
                  <Image 
                    src={stampUrl} 
                    alt="Company Stamp" 
                    width={120} 
                    height={120} 
                    className="object-contain"
                  />
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute -top-2 -right-2 h-6 w-6"
                  onClick={handleRemoveStamp}
                  disabled={uploadingStamp}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div 
                onClick={() => stampInputRef.current?.click()}
                className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-primary/50 transition-colors"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Click to upload stamp</span>
              </div>
            )}
            
            <input
              ref={stampInputRef}
              type="file"
              accept="image/*"
              onChange={handleStampUpload}
              className="hidden"
            />
            
            {!stampUrl && (
              <Button
                type="button"
                variant="outline"
                onClick={() => stampInputRef.current?.click()}
                disabled={uploadingStamp}
              >
                {uploadingStamp ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Stamp
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Settings
        </Button>
        {message && (
          <p className={`text-sm font-medium ${message.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  )
}
