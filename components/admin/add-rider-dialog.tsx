'use client'

import React from "react"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { createRider, updateRiderNicData } from '@/lib/admin-actions'
import { NicScanner, type NicData } from '@/components/nic-scanner'
import { Plus, Loader2, IdCard, ChevronDown, ChevronUp } from 'lucide-react'
import type { Profile, Contractor } from '@/lib/types'

interface AddRiderDialogProps {
  contractors: (Profile | Contractor)[]
  trigger?: React.ReactNode
}

export function AddRiderDialog({ contractors, trigger }: AddRiderDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [contractorId, setContractorId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [showNicScanner, setShowNicScanner] = useState(false)
  const [nicData, setNicData] = useState<NicData | null>(null)
  const router = useRouter()

  function handleNicScan(data: NicData) {
    setNicData(data)
    // Don't auto-fill name -- keep the nickname the user types
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Rider name is required')
      return
    }

    setLoading(true)
    setError(null)

    const result = await createRider(
      name.trim(),
      phone.trim() || undefined,
      contractorId && contractorId !== 'none' ? contractorId : undefined
    )

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    // Save NIC data if scanned
    if (nicData && result.riderId) {
      await updateRiderNicData(result.riderId, {
        surname: nicData.surname,
        first_name: nicData.firstName,
        surname_at_birth: nicData.surnameAtBirth || undefined,
        nic_number: nicData.idNumber,
        gender: nicData.gender,
        date_of_birth: nicData.dateOfBirth || undefined,
        photo_url: nicData.photoUrl,
        nic_photo_url: nicData.nicPhotoUrl,
      })
    }

    setLoading(false)
    setName('')
    setPhone('')
    setContractorId('')
    setNicData(null)
    setShowNicScanner(false)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Add Rider
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Rider</DialogTitle>
          <DialogDescription>
            Scan NIC card to auto-fill details, or enter manually.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* NIC Scanner Toggle */}
            <button
              type="button"
              onClick={() => setShowNicScanner(!showNicScanner)}
              className="w-full flex items-center justify-between p-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <IdCard className="w-5 h-5 text-primary" />
                <div className="text-left">
                  <span className="text-sm font-semibold text-primary block">Scan NIC Card</span>
                  <span className="text-[10px] text-muted-foreground">Auto-fill from Mauritius National ID</span>
                </div>
              </div>
              {showNicScanner ? <ChevronUp className="w-4 h-4 text-primary" /> : <ChevronDown className="w-4 h-4 text-primary" />}
            </button>

            {showNicScanner && (
              <div className="border border-border/40 rounded-xl p-3 bg-muted/10">
                <NicScanner onScanComplete={handleNicScan} existingData={nicData ? {
                  surname: nicData.surname,
                  firstName: nicData.firstName,
                  surnameAtBirth: nicData.surnameAtBirth,
                  gender: nicData.gender,
                  dateOfBirth: nicData.dateOfBirth,
                  idNumber: nicData.idNumber,
                  photoUrl: nicData.photoUrl,
                  nicPhotoUrl: nicData.nicPhotoUrl,
                } : undefined} />
              </div>
            )}

            {nicData && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                  <IdCard className="w-4 h-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-[10px] text-emerald-500">NIC verified</p>
                  <p className="text-xs font-semibold text-emerald-600">{nicData.firstName} {nicData.surname}</p>
                  <p className="text-[9px] text-emerald-500 font-mono">{nicData.idNumber}</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Rider Nickname *</Label>
              <Input
                id="name"
                placeholder="e.g., Tino"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
              <p className="text-[10px] text-muted-foreground">Display name used in the app. Real name is stored from NIC.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                placeholder="+230 5XXX XXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contractor">Assign to Contractor (Optional)</Label>
              <Select value={contractorId} onValueChange={setContractorId} disabled={loading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select contractor (or leave empty)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Contractor (Independent)</SelectItem>
                  {contractors.map((contractor) => (
                    <SelectItem key={contractor.id} value={contractor.id}>
                      {contractor.name || contractor.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Rider
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
