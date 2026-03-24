'use client'

import { useState, useRef, useTransition } from 'react'
import { Camera, Upload, Loader2, CheckCircle2, AlertCircle, User, Calendar, Hash, IdCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface NicData {
  surname: string
  firstName: string
  surnameAtBirth: string
  gender: string
  dateOfBirth: string
  idNumber: string
  photoUrl: string      // Profile photo (empty -- we don't extract face from card)
  nicPhotoUrl: string   // The full NIC card scan image
}

interface NicScannerProps {
  onScanComplete: (data: NicData) => void
  existingData?: Partial<NicData>
  compact?: boolean
}

type ScanStep = 'upload' | 'scanning' | 'review'

export function NicScanner({ onScanComplete, existingData, compact }: NicScannerProps) {
  const [step, setStep] = useState<ScanStep>(existingData?.idNumber ? 'review' : 'upload')
  const [imageUrl, setImageUrl] = useState<string>(existingData?.nicPhotoUrl || '')
  const [imagePreview, setImagePreview] = useState<string>(existingData?.nicPhotoUrl || '')
  const [isUploading, setIsUploading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState<NicData>({
    surname: existingData?.surname || '',
    firstName: existingData?.firstName || '',
    surnameAtBirth: existingData?.surnameAtBirth || '',
    gender: existingData?.gender || '',
    dateOfBirth: existingData?.dateOfBirth || '',
    idNumber: existingData?.idNumber || '',
    photoUrl: existingData?.photoUrl || '',
    nicPhotoUrl: existingData?.nicPhotoUrl || '',
  })

  async function handleFileSelect(file: File) {
    setError(null)

    // Show preview
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)

    // Upload to Vercel Blob
    setIsUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload-nic', { method: 'POST', body: fd })
      const result = await res.json()

      if (!res.ok) throw new Error(result.error || 'Upload failed')

      setImageUrl(result.url)
      setIsUploading(false)

      // Auto-scan after upload
      await scanNic(result.url)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
      setIsUploading(false)
    }
  }

  async function scanNic(url: string) {
    setIsScanning(true)
    setStep('scanning')
    setError(null)

    try {
      const res = await fetch('/api/scan-nic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      })
      const result = await res.json()

      if (!res.ok) throw new Error(result.error || 'Scan failed')

      const scanned = result.data
      setFormData({
        surname: scanned?.surname || '',
        firstName: scanned?.firstName || '',
        surnameAtBirth: scanned?.surnameAtBirth || '',
        gender: scanned?.gender || '',
        dateOfBirth: scanned?.dateOfBirth || '',
        idNumber: scanned?.idNumber || '',
        photoUrl: '',        // No profile photo from card scan
        nicPhotoUrl: url,    // Store the NIC card image separately
      })

      setStep('review')
    } catch (err: any) {
      setError(err.message || 'Scan failed. Try again.')
      setStep('upload')
    } finally {
      setIsScanning(false)
    }
  }

  function handleConfirm() {
    onScanComplete(formData)
  }

  function updateField(key: keyof NicData, value: string) {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  // Upload step
  if (step === 'upload') {
    return (
      <div className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFileSelect(file)
          }}
        />

        {imagePreview && (
          <div className="relative rounded-xl overflow-hidden border border-border/40">
            <img src={imagePreview} alt="NIC preview" className="w-full h-40 object-cover" />
          </div>
        )}

        <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-2")}>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="h-20 flex flex-col items-center justify-center gap-2 border-dashed border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
          >
            {isUploading ? (
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            ) : (
              <Camera className="w-6 h-6 text-primary" />
            )}
            <span className="text-xs font-medium">
              {isUploading ? 'Uploading...' : 'Take Photo'}
            </span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (file) handleFileSelect(file)
              }
              input.click()
            }}
            disabled={isUploading}
            className={cn(
              "h-20 flex flex-col items-center justify-center gap-2 border-dashed border-2 hover:border-primary/50 hover:bg-primary/5 transition-all",
              compact && "hidden"
            )}
          >
            <Upload className="w-6 h-6 text-muted-foreground" />
            <span className="text-xs font-medium">Upload File</span>
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-500 text-xs p-2 bg-red-500/10 rounded-lg">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground text-center">
          Upload a clear photo of the front of the Mauritius National ID Card
        </p>
      </div>
    )
  }

  // Scanning step
  if (step === 'scanning') {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-4">
        <div className="relative">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <IdCard className="w-10 h-10 text-primary" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-primary-foreground" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold">Scanning NIC Card...</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            AI is reading the card details
          </p>
        </div>
        {/* Animated scan lines */}
        <div className="w-full max-w-[200px] h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: '70%' }} />
        </div>
      </div>
    )
  }

  // Review step
  return (
    <div className="space-y-3">
      {/* NIC Card Preview */}
      {imagePreview && (
        <div className="relative rounded-xl overflow-hidden border border-border/40">
          <img src={imagePreview} alt="NIC card" className="w-full h-32 object-cover" />
          <div className="absolute top-1.5 right-1.5">
            <div className="px-2 py-0.5 rounded-full bg-emerald-500/90 flex items-center gap-1">
              <CheckCircle2 className="w-2.5 h-2.5 text-white" />
              <span className="text-[8px] font-semibold text-white">Scanned</span>
            </div>
          </div>
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2">
            <p className="text-[10px] text-white/80 font-medium">National Identity Card</p>
          </div>
        </div>
      )}

      {/* Extracted fields */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">Surname</label>
            <Input
              value={formData.surname}
              onChange={(e) => updateField('surname', e.target.value)}
              className="h-8 text-xs"
              placeholder="Surname"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">First Name</label>
            <Input
              value={formData.firstName}
              onChange={(e) => updateField('firstName', e.target.value)}
              className="h-8 text-xs"
              placeholder="First Name"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block">Surname at Birth</label>
          <Input
            value={formData.surnameAtBirth}
            onChange={(e) => updateField('surnameAtBirth', e.target.value)}
            className="h-8 text-xs"
            placeholder="Surname at birth (if applicable)"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground mb-0.5 block">Gender</label>
            <select
              value={formData.gender}
              onChange={(e) => updateField('gender', e.target.value)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">--</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-[10px] text-muted-foreground mb-0.5 block">Date of Birth</label>
            <Input
              value={formData.dateOfBirth}
              onChange={(e) => updateField('dateOfBirth', e.target.value)}
              className="h-8 text-xs"
              placeholder="03 Aug 2001"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] text-muted-foreground mb-0.5 block flex items-center gap-1">
            <Hash className="w-3 h-3" /> NIC Number
          </label>
          <Input
            value={formData.idNumber}
            onChange={(e) => updateField('idNumber', e.target.value)}
            className="h-8 text-xs font-mono tracking-wide"
            placeholder="S0308012908207"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-500 text-xs p-2 bg-red-500/10 rounded-lg">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => {
            setStep('upload')
            setImagePreview('')
            setImageUrl('')
          }}
        >
          Re-scan
        </Button>
        <Button
          type="button"
          size="sm"
          className="flex-1"
          onClick={handleConfirm}
          disabled={!formData.firstName || !formData.surname || !formData.idNumber}
        >
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
          Confirm & Save
        </Button>
      </div>
    </div>
  )
}
