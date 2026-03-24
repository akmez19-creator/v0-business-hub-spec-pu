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
import { Badge } from '@/components/ui/badge'
import { Pencil, Loader2, Link2, User, Trash2, Unlink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { updateContractor, deleteContractor, unlinkContractor } from '@/lib/admin-actions'
import type { Contractor } from '@/lib/types'
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
  contractor: Contractor & { profile_id?: string | null; riderCount?: number }
  trigger?: React.ReactNode
}

export function EditContractorDialog({ contractor, trigger }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({
    name: contractor.name,
    phone: contractor.phone || '',
    email: contractor.email || '',
    has_partners: contractor.has_partners ?? false,
  })

  const isLinked = !!contractor.profile_id
  const hasRiders = (contractor.riderCount || 0) > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const result = await updateContractor(contractor.id, {
      name: formData.name,
      phone: formData.phone || null,
      email: formData.email || null,
      has_partners: formData.has_partners,
    })

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setLoading(false)
    setOpen(false)
    router.refresh()
  }

  async function handleDelete() {
    setDeleting(true)
    const result = await deleteContractor(contractor.id)
    
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
    const result = await unlinkContractor(contractor.id)
    
    if (result.error) {
      setError(result.error)
      setUnlinking(false)
      return
    }

    setUnlinking(false)
    setOpen(false)
    router.refresh()
  }

  const canDelete = !isLinked && !hasRiders

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
            Edit Contractor
            {isLinked && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <Link2 className="w-3 h-3 mr-1" />
                Linked
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Update contractor information. {isLinked ? 'This contractor is linked to a user account.' : 'This contractor is not linked to any user account yet.'}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Company/Contractor Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Contractor name"
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
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="Email address"
              />
            </div>

            {/* Partner Access Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
              <div>
                <p className="text-sm font-medium">Partner Deliveries</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Allow this contractor to manage partner deliveries
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={formData.has_partners}
                onClick={() => setFormData(prev => ({ ...prev, has_partners: !prev.has_partners }))}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  formData.has_partners ? 'bg-primary' : 'bg-muted'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
                    formData.has_partners ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
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
                      ? 'This contractor is linked to a user account and can login to the system.'
                      : 'Not linked. When a user signs up as a contractor, an admin can link them to this record.'}
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
                        <AlertDialogTitle>Unlink Contractor</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to unlink this contractor from their user account? 
                          The user will no longer be able to access this contractor&apos;s data.
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

            {hasRiders && (
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                <p className="text-sm text-blue-700">
                  This contractor has {contractor.riderCount} rider(s) assigned.
                </p>
              </div>
            )}
            
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  type="button" 
                  variant="destructive" 
                  size="sm" 
                  disabled={!canDelete}
                  title={!canDelete ? 'Cannot delete: has linked user or assigned riders' : undefined}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Contractor</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this contractor? This action cannot be undone.
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
