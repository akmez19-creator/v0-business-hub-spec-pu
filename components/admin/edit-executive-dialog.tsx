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
import { Pencil, Loader2, Trash2 } from 'lucide-react'
import { updateExecutive, deleteExecutive } from '@/lib/executive-actions'

interface Executive {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
  sex: string | null
  marital_status: string | null
  nationality: string | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  nic: string | null
  tan: string | null
  employee_code: string | null
  department: string | null
  position: string | null
  employment_type: string | null
  date_joined: string | null
  date_left: string | null
  is_active: boolean
  pay_type: string | null
  base_salary: number | null
  bank_name: string | null
  bank_account: string | null
  bank_branch?: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relation?: string | null
  notes: string | null
}

interface Props {
  executive: Executive
}

export function EditExecutiveDialog({ executive }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({
    first_name: executive.first_name || '',
    last_name: executive.last_name || '',
    date_of_birth: executive.date_of_birth || '',
    sex: executive.sex || '',
    marital_status: executive.marital_status || '',
    nationality: executive.nationality || 'Mauritian',
    email: executive.email || '',
    phone: executive.phone || '',
    address: executive.address || '',
    city: executive.city || '',
    nic: executive.nic || '',
    tan: executive.tan || '',
    employee_code: executive.employee_code || '',
    department: executive.department || 'Operations',
    position: executive.position || 'Executive',
    employment_type: executive.employment_type || 'full_time',
    date_joined: executive.date_joined || '',
    date_left: executive.date_left || '',
    is_active: executive.is_active,
    pay_type: executive.pay_type || 'monthly',
    base_salary: executive.base_salary?.toString() || '',
    bank_name: executive.bank_name || '',
    bank_account: executive.bank_account || '',
    bank_branch: executive.bank_branch || '',
    emergency_contact_name: executive.emergency_contact_name || '',
    emergency_contact_phone: executive.emergency_contact_phone || '',
    emergency_contact_relation: executive.emergency_contact_relation || '',
    notes: executive.notes || '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const result = await updateExecutive(executive.id, {
      ...formData,
      base_salary: formData.base_salary ? parseFloat(formData.base_salary) : null,
      date_of_birth: formData.date_of_birth || null,
      date_joined: formData.date_joined || null,
      date_left: formData.date_left || null,
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
    if (!confirm('Are you sure you want to delete this executive?')) return
    
    setDeleting(true)
    const result = await deleteExecutive(executive.id)
    
    if (result.error) {
      setError(result.error)
      setDeleting(false)
      return
    }
    
    setDeleting(false)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="w-3.5 h-3.5 mr-1" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Executive</DialogTitle>
          <DialogDescription>
            Update details for {executive.first_name} {executive.last_name}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
          <Tabs defaultValue="personal" className="mt-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="personal">Personal</TabsTrigger>
              <TabsTrigger value="employment">Employment</TabsTrigger>
              <TabsTrigger value="banking">Banking</TabsTrigger>
              <TabsTrigger value="emergency">Emergency</TabsTrigger>
            </TabsList>
            
            <TabsContent value="personal" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Name *</Label>
                  <Input
                    value={formData.first_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Name *</Label>
                  <Input
                    value={formData.last_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                    required
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
                  />
                </div>
                <div className="space-y-2">
                  <Label>TAN</Label>
                  <Input
                    value={formData.tan}
                    onChange={(e) => setFormData(prev => ({ ...prev, tan: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Address</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input
                    value={formData.city}
                    onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Nationality</Label>
                  <Input
                    value={formData.nationality}
                    onChange={(e) => setFormData(prev => ({ ...prev, nationality: e.target.value }))}
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
                  />
                </div>
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
                      <SelectItem value="Operations">Operations</SelectItem>
                      <SelectItem value="Marketing">Marketing</SelectItem>
                      <SelectItem value="Sales">Sales</SelectItem>
                      <SelectItem value="Delivery">Delivery</SelectItem>
                      <SelectItem value="Finance">Finance</SelectItem>
                      <SelectItem value="HR">HR</SelectItem>
                      <SelectItem value="IT">IT</SelectItem>
                      <SelectItem value="Admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Position</Label>
                  <Input
                    value={formData.position}
                    onChange={(e) => setFormData(prev => ({ ...prev, position: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Employment Type</Label>
                  <Select
                    value={formData.employment_type}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, employment_type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_time">Full Time</SelectItem>
                      <SelectItem value="part_time">Part Time</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="intern">Intern</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date Joined</Label>
                  <Input
                    type="date"
                    value={formData.date_joined}
                    onChange={(e) => setFormData(prev => ({ ...prev, date_joined: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date Left</Label>
                  <Input
                    type="date"
                    value={formData.date_left}
                    onChange={(e) => setFormData(prev => ({ ...prev, date_left: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Pay Type</Label>
                  <Select
                    value={formData.pay_type}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, pay_type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly Salary</SelectItem>
                      <SelectItem value="hourly">Hourly Rate</SelectItem>
                      <SelectItem value="per_delivery">Per Delivery</SelectItem>
                      <SelectItem value="commission">Commission Based</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Base Salary (Rs)</Label>
                  <Input
                    type="number"
                    value={formData.base_salary}
                    onChange={(e) => setFormData(prev => ({ ...prev, base_salary: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                />
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
                />
              </div>
              
              <div className="space-y-2">
                <Label>Account Number</Label>
                <Input
                  value={formData.bank_account}
                  onChange={(e) => setFormData(prev => ({ ...prev, bank_account: e.target.value }))}
                />
              </div>
            </TabsContent>
            
            <TabsContent value="emergency" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Emergency Contact Name</Label>
                <Input
                  value={formData.emergency_contact_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, emergency_contact_name: e.target.value }))}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Emergency Contact Phone</Label>
                <Input
                  value={formData.emergency_contact_phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, emergency_contact_phone: e.target.value }))}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Relationship</Label>
                <Select
                  value={formData.emergency_contact_relation}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, emergency_contact_relation: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select relationship" />
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
            </TabsContent>
          </Tabs>
          
          {error && (
            <p className="text-sm text-destructive mt-4">{error}</p>
          )}
          
          <DialogFooter className="mt-6 flex justify-between">
            <Button 
              type="button" 
              variant="destructive" 
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
