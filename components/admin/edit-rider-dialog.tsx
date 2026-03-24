'use client'

import React from "react"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Pencil, Loader2, Link2, User, Trash2, Unlink } from 'lucide-react'
import { updateRider, deleteRider, unlinkRider } from '@/lib/admin-actions'
import type { Rider, Contractor } from '@/lib/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface Props {
  rider: Rider & { profile_id?: string | null }
  contractors: Contractor[]
  trigger?: React.ReactNode
}

export function EditRiderDialog({ rider, contractors, trigger }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({
    name: rider.name,
    phone: rider.phone || '',
    contractorId: rider.contractor_id || 'none',
  })

  const isLinked = !!rider.profile_id

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const updateData = {
      name: formData.name,
      phone: formData.phone || null,
      contractor_id: formData.contractorId === 'none' ? null : formData.contractorId,
    }

    try {
      const result = await updateRider(rider.id, updateData)

      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }

      setLoading(false)
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError('An unexpected error occurred')
      setLoading(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    const result = await deleteRider(rider.id)
    
    if (result.error) {
      setError(result.error)
      setDeleting(false)
      return
    }

    setDeleting(false)
    setOpen(false)
    router.refresh()
  }

  async function handleUnlink() {
    setUnlinking(true)
    setError(null)
    const result = await unlinkRider(rider.id)
    
    if (result.error) {
      setError(result.error)
      setUnlinking(false)
      return
    }

    setUnlinking(false)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Rider
            {isLinked && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <Link2 className="w-3 h-3 mr-1" />
                Linked
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Update rider information. {isLinked ? 'This rider is linked to a user account.' : 'This rider is not linked to any user account yet.'}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Rider name"
                required
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="Phone number"
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="contractor">Assigned Contractor</Label>
              <Select 
                value={formData.contractorId} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, contractorId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a contractor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Contractor (Independent)</SelectItem>
                  {contractors.map(contractor => (
                    <SelectItem key={contractor.id} value={contractor.id}>
                      {contractor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Link Status Info */}
            <div className="p-3 rounded-lg bg-muted/50 border">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">User Account Status:</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {isLinked 
                      ? 'This rider is linked to a user account and can login to the system.'
                      : 'Not linked. When a user signs up as a rider, an admin can link them to this record.'}
                  </p>
                </div>
                {isLinked && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="bg-transparent shrink-0">
                        <Unlink className="w-4 h-4 mr-2" />
                        Unlink
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Unlink Rider</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to unlink this rider from their user account? 
                          The user will no longer be able to access this rider&apos;s data.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleUnlink} disabled={unlinking}>
                          {unlinking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Unlink'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
            
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="destructive" size="sm" disabled={isLinked}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Rider</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this rider? This action cannot be undone.
                    All delivery records associated with this rider will be affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
