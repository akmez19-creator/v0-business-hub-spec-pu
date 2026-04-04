'use client'

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
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Pencil, Loader2 } from 'lucide-react'
import { updateContractorDetails } from '@/lib/executive-actions'

interface Contractor {
  id: string
  name: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  sex: string | null
  marital_status?: string | null
  nationality?: string | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  nic: string | null
  tan: string | null
  employee_code: string | null
  department: string | null
  position: string | null
  date_joined: string | null
  bank_name: string | null
  bank_account: string | null
  bank_branch?: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relation?: string | null
  notes?: string | null
}

interface Props {
  contractor: Contractor
}

export function EditContractorDetailsDialog({ contractor }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({
    first_name: contractor.first_name || '',
    last_name: contractor.last_name || '',
    date_of_birth: contractor.date_of_birth || '',
    sex: contractor.sex || '',
    marital_status: contractor.marital_status || '',
    nationality: contractor.nationality || 'Mauritian',
    address: contractor.address || '',
    city: contractor.city || '',
    nic: contractor.nic || '',
    tan: contractor.tan || '',
    employee_code: contractor.employee_code || '',
    department: contractor.department || 'Delivery',
    position: contractor.position || 'Contractor',
    date_joined: contractor.date_joined || '',
    bank_name: contractor.bank_name || '',
    bank_account: contractor.bank_account || '',
    bank_branch: contractor.bank_branch || '',
    emergency_contact_name: contractor.emergency_contact_name || '',
    emergency_contact_phone: contractor.emergency_contact_phone || '',
    emergency_contact_relation: contractor.emergency_contact_relation || '',
    notes: contractor.notes || '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const result = await updateContractorDetails(contractor.id, {
      ...formData,
      date_of_birth: formData.date_of_birth || null,
      date_joined: formData.date_joined || null,
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="w-3.5 h-3.5 mr-1" />
          Edit Details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Contractor Details</DialogTitle>
          <DialogDescription>
            Update personal details for {contractor.name}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
          <Tabs defaultValue="personal" className="mt-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="personal">Personal</TabsTrigger>
              <TabsTrigger value="employment">Employment</TabsTrigger>
              <TabsTrigger value="banking">Banking</TabsTrigger>
            </TabsList>
            
            <TabsContent value="personal" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Name</Label>
                  <Input
                    value={formData.first_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                    placeholder="First name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Name</Label>
                  <Input
                    value={formData.last_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                    placeholder="Last name"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Date of Birth</Label>
                  <Input
                    type="date"
                    value={formData.date_of_birth}
                    onChange={(e) => setFormData(prev => ({ ...prev, date_of_birth: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sex</Label>
                  <Select
                    value={formData.sex}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, sex: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Marital Status</Label>
                  <Select
                    value={formData.marital_status}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, marital_status: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single</SelectItem>
                      <SelectItem value="married">Married</SelectItem>
                      <SelectItem value="divorced">Divorced</SelectItem>
                      <SelectItem value="widowed">Widowed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>NIC</Label>
                  <Input
                    value={formData.nic}
                    onChange={(e) => setFormData(prev => ({ ...prev, nic: e.target.value }))}
                    placeholder="National ID"
                  />
                </div>
                <div className="space-y-2">
                  <Label>TAN</Label>
                  <Input
                    value={formData.tan}
                    onChange={(e) => setFormData(prev => ({ ...prev, tan: e.target.value }))}
                    placeholder="TAN number"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Address</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="Street address"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input
                    value={formData.city}
                    onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                    placeholder="City"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Nationality</Label>
                  <Input
                    value={formData.nationality}
                    onChange={(e) => setFormData(prev => ({ ...prev, nationality: e.target.value }))}
                    placeholder="Nationality"
                  />
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="employment" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Employee Code</Label>
                  <Input
                    value={formData.employee_code}
                    onChange={(e) => setFormData(prev => ({ ...prev, employee_code: e.target.value }))}
                    placeholder="CON001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date Joined</Label>
                  <Input
                    type="date"
                    value={formData.date_joined}
                    onChange={(e) => setFormData(prev => ({ ...prev, date_joined: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Select
                    value={formData.department}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, department: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Delivery">Delivery</SelectItem>
                      <SelectItem value="Operations">Operations</SelectItem>
                      <SelectItem value="Logistics">Logistics</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Position</Label>
                  <Input
                    value={formData.position}
                    onChange={(e) => setFormData(prev => ({ ...prev, position: e.target.value }))}
                    placeholder="Contractor"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Any additional notes..."
                  rows={3}
                />
              </div>
              
              <div className="p-3 rounded-lg bg-muted/50 border border-border">
                <h4 className="text-sm font-medium mb-2">Emergency Contact</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={formData.emergency_contact_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, emergency_contact_name: e.target.value }))}
                      placeholder="Contact name"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone</Label>
                    <Input
                      value={formData.emergency_contact_phone}
                      onChange={(e) => setFormData(prev => ({ ...prev, emergency_contact_phone: e.target.value }))}
                      placeholder="Phone"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Relation</Label>
                    <Select
                      value={formData.emergency_contact_relation}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, emergency_contact_relation: value }))}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="spouse">Spouse</SelectItem>
                        <SelectItem value="parent">Parent</SelectItem>
                        <SelectItem value="sibling">Sibling</SelectItem>
                        <SelectItem value="child">Child</SelectItem>
                        <SelectItem value="friend">Friend</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="banking" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Bank Name</Label>
                <Select
                  value={formData.bank_name}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, bank_name: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select bank" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MCB">MCB</SelectItem>
                    <SelectItem value="SBM">SBM</SelectItem>
                    <SelectItem value="Barclays">Barclays</SelectItem>
                    <SelectItem value="HSBC">HSBC</SelectItem>
                    <SelectItem value="Standard Chartered">Standard Chartered</SelectItem>
                    <SelectItem value="Bank One">Bank One</SelectItem>
                    <SelectItem value="ABC Banking">ABC Banking</SelectItem>
                    <SelectItem value="AfrAsia">AfrAsia Bank</SelectItem>
                    <SelectItem value="MauBank">MauBank</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Bank Branch</Label>
                <Input
                  value={formData.bank_branch}
                  onChange={(e) => setFormData(prev => ({ ...prev, bank_branch: e.target.value }))}
                  placeholder="Branch name"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input
                  value={formData.bank_account}
                  onChange={(e) => setFormData(prev => ({ ...prev, bank_account: e.target.value }))}
                  placeholder="Account number"
                />
              </div>
            </TabsContent>
          </Tabs>
          
          {error && (
            <p className="text-sm text-destructive mt-4">{error}</p>
          )}
          
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
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
