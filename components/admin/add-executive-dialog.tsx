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
import { Plus, Loader2, UserPlus } from 'lucide-react'
import { createExecutive } from '@/lib/executive-actions'

export function AddExecutiveDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [formData, setFormData] = useState({
    // Personal
    first_name: '',
    last_name: '',
    date_of_birth: '',
    sex: '',
    marital_status: '',
    nationality: 'Mauritian',
    // Contact
    email: '',
    phone: '',
    address: '',
    city: '',
    // Identification
    nic: '',
    tan: '',
    // Employment
    employee_code: '',
    department: 'Operations',
    position: 'Executive',
    employment_type: 'full_time',
    date_joined: new Date().toISOString().split('T')[0],
    // Compensation
    pay_type: 'monthly',
    base_salary: '',
    // Banking
    bank_name: '',
    bank_account: '',
    bank_branch: '',
    // Emergency
    emergency_contact_name: '',
    emergency_contact_phone: '',
    emergency_contact_relation: '',
    // Notes
    notes: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const result = await createExecutive({
      ...formData,
      base_salary: formData.base_salary ? parseFloat(formData.base_salary) : null,
    })

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setFormData({
      first_name: '',
      last_name: '',
      date_of_birth: '',
      sex: '',
      marital_status: '',
      nationality: 'Mauritian',
      email: '',
      phone: '',
      address: '',
      city: '',
      nic: '',
      tan: '',
      employee_code: '',
      department: 'Operations',
      position: 'Executive',
      employment_type: 'full_time',
      date_joined: new Date().toISOString().split('T')[0],
      pay_type: 'monthly',
      base_salary: '',
      bank_name: '',
      bank_account: '',
      bank_branch: '',
      emergency_contact_name: '',
      emergency_contact_phone: '',
      emergency_contact_relation: '',
      notes: '',
    })
    setLoading(false)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Executive
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Add New Executive / Employee
          </DialogTitle>
          <DialogDescription>
            Enter the personal and employment details for the new staff member
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
                  <Label htmlFor="first_name">First Name *</Label>
                  <Input
                    id="first_name"
                    value={formData.first_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                    placeholder="John"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name">Last Name *</Label>
                  <Input
                    id="last_name"
                    value={formData.last_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                    placeholder="Doe"
                    required
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date_of_birth">Date of Birth</Label>
                  <Input
                    id="date_of_birth"
                    type="date"
                    value={formData.date_of_birth}
                    onChange={(e) => setFormData(prev => ({ ...prev, date_of_birth: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sex">Sex</Label>
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
                  <Label htmlFor="marital_status">Marital Status</Label>
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
                  <Label htmlFor="nic">NIC (National ID)</Label>
                  <Input
                    id="nic"
                    value={formData.nic}
                    onChange={(e) => setFormData(prev => ({ ...prev, nic: e.target.value }))}
                    placeholder="A123456789012B"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tan">TAN</Label>
                  <Input
                    id="tan"
                    value={formData.tan}
                    onChange={(e) => setFormData(prev => ({ ...prev, tan: e.target.value }))}
                    placeholder="TAN number"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="john@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="+230 5XXX XXXX"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="Street address"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                    placeholder="Port Louis"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nationality">Nationality</Label>
                  <Input
                    id="nationality"
                    value={formData.nationality}
                    onChange={(e) => setFormData(prev => ({ ...prev, nationality: e.target.value }))}
                    placeholder="Mauritian"
                  />
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="employment" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="employee_code">Employee Code</Label>
                  <Input
                    id="employee_code"
                    value={formData.employee_code}
                    onChange={(e) => setFormData(prev => ({ ...prev, employee_code: e.target.value }))}
                    placeholder="EMP001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date_joined">Date Joined</Label>
                  <Input
                    id="date_joined"
                    type="date"
                    value={formData.date_joined}
                    onChange={(e) => setFormData(prev => ({ ...prev, date_joined: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Select
                    value={formData.department}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, department: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
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
                <div className="space-y-2">
                  <Label htmlFor="position">Position</Label>
                  <Input
                    id="position"
                    value={formData.position}
                    onChange={(e) => setFormData(prev => ({ ...prev, position: e.target.value }))}
                    placeholder="Executive"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="employment_type">Employment Type</Label>
                  <Select
                    value={formData.employment_type}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, employment_type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_time">Full Time</SelectItem>
                      <SelectItem value="part_time">Part Time</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="intern">Intern</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pay_type">Pay Type</Label>
                  <Select
                    value={formData.pay_type}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, pay_type: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly Salary</SelectItem>
                      <SelectItem value="hourly">Hourly Rate</SelectItem>
                      <SelectItem value="per_delivery">Per Delivery</SelectItem>
                      <SelectItem value="commission">Commission Based</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="base_salary">Base Salary (Rs)</Label>
                <Input
                  id="base_salary"
                  type="number"
                  value={formData.base_salary}
                  onChange={(e) => setFormData(prev => ({ ...prev, base_salary: e.target.value }))}
                  placeholder="25000"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Any additional notes..."
                  rows={3}
                />
              </div>
            </TabsContent>
            
            <TabsContent value="banking" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="bank_name">Bank Name</Label>
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
                <Label htmlFor="bank_branch">Bank Branch</Label>
                <Input
                  id="bank_branch"
                  value={formData.bank_branch}
                  onChange={(e) => setFormData(prev => ({ ...prev, bank_branch: e.target.value }))}
                  placeholder="Branch name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="bank_account">Account Number</Label>
                <Input
                  id="bank_account"
                  value={formData.bank_account}
                  onChange={(e) => setFormData(prev => ({ ...prev, bank_account: e.target.value }))}
                  placeholder="Account number"
                />
              </div>
            </TabsContent>
            
            <TabsContent value="emergency" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="emergency_contact_name">Emergency Contact Name</Label>
                <Input
                  id="emergency_contact_name"
                  value={formData.emergency_contact_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, emergency_contact_name: e.target.value }))}
                  placeholder="Contact person name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="emergency_contact_phone">Emergency Contact Phone</Label>
                <Input
                  id="emergency_contact_phone"
                  value={formData.emergency_contact_phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, emergency_contact_phone: e.target.value }))}
                  placeholder="+230 5XXX XXXX"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="emergency_contact_relation">Relationship</Label>
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
          
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Executive
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
