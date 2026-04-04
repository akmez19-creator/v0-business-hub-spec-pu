'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Users, Building2, Search, Plus, UserCircle, Calendar, Phone, Mail, MapPin, CreditCard, Briefcase } from 'lucide-react'
import { AddExecutiveDialog } from './add-executive-dialog'
import { EditExecutiveDialog } from './edit-executive-dialog'
import { EditContractorDetailsDialog } from './edit-contractor-details-dialog'

interface Executive {
  id: string
  profile_id: string | null
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
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  photo_url: string | null
  notes: string | null
  created_at: string
}

interface Contractor {
  id: string
  name: string
  first_name: string | null
  last_name: string | null
  date_of_birth: string | null
  sex: string | null
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
  pay_type: string | null
  rate_per_delivery: number | null
  monthly_salary: number | null
  bank_name: string | null
  bank_account: string | null
  is_active: boolean
  created_at: string
}

interface Props {
  executives: Executive[]
  contractors: Contractor[]
}

function calculateAge(dob: string | null): number | null {
  if (!dob) return null
  const birthDate = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

function formatDate(date: string | null): string {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ExecutivesContent({ executives, contractors }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState('executives')
  
  const filteredExecutives = executives.filter(exec => {
    const fullName = `${exec.first_name} ${exec.last_name}`.toLowerCase()
    const search = searchTerm.toLowerCase()
    return fullName.includes(search) || 
           exec.email?.toLowerCase().includes(search) ||
           exec.nic?.toLowerCase().includes(search) ||
           exec.employee_code?.toLowerCase().includes(search)
  })
  
  const filteredContractors = contractors.filter(contractor => {
    const search = searchTerm.toLowerCase()
    return contractor.name?.toLowerCase().includes(search) ||
           contractor.email?.toLowerCase().includes(search) ||
           contractor.nic?.toLowerCase().includes(search)
  })
  
  const activeExecutives = executives.filter(e => e.is_active)
  const activeContractors = contractors.filter(c => c.is_active)
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Staff Management</h2>
          <p className="text-muted-foreground">
            Manage executives, employees, and contractor details
          </p>
        </div>
        <AddExecutiveDialog />
      </div>
      
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Executives</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{executives.length}</div>
            <p className="text-xs text-muted-foreground">{activeExecutives.length} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contractors</CardTitle>
            <Building2 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{contractors.length}</div>
            <p className="text-xs text-muted-foreground">{activeContractors.length} active</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Departments</CardTitle>
            <Briefcase className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Set([...executives.map(e => e.department), ...contractors.map(c => c.department)].filter(Boolean)).size}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Staff</CardTitle>
            <UserCircle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{executives.length + contractors.length}</div>
          </CardContent>
        </Card>
      </div>
      
      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Search by name, email, NIC..."
          className="pl-9"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      
      {/* Tabs for Executives and Contractors */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="executives" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Executives ({executives.length})
          </TabsTrigger>
          <TabsTrigger value="contractors" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Contractors ({contractors.length})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="executives" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Executives / Employees</CardTitle>
              <CardDescription>Full-time and part-time staff members</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredExecutives.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No executives found</p>
                  <p className="text-sm">Add your first executive to get started</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredExecutives.map(exec => (
                    <div key={exec.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-lg">
                            {exec.first_name?.charAt(0)}{exec.last_name?.charAt(0)}
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold">{exec.first_name} {exec.last_name}</h4>
                              <Badge variant={exec.is_active ? 'default' : 'secondary'}>
                                {exec.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                              {exec.sex && (
                                <Badge variant="outline" className="capitalize">
                                  {exec.sex}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {exec.position || 'Executive'} • {exec.department || 'Operations'}
                            </p>
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-2">
                              {exec.date_of_birth && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5" />
                                  {calculateAge(exec.date_of_birth)} yrs ({formatDate(exec.date_of_birth)})
                                </span>
                              )}
                              {exec.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3.5 h-3.5" />
                                  {exec.phone}
                                </span>
                              )}
                              {exec.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="w-3.5 h-3.5" />
                                  {exec.email}
                                </span>
                              )}
                              {exec.city && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3.5 h-3.5" />
                                  {exec.city}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-1">
                              {exec.nic && <span>NIC: {exec.nic}</span>}
                              {exec.employee_code && <span>Code: {exec.employee_code}</span>}
                              {exec.date_joined && <span>Joined: {formatDate(exec.date_joined)}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {exec.pay_type === 'monthly' && exec.base_salary 
                                ? `Rs ${exec.base_salary.toLocaleString()}/mo`
                                : exec.pay_type === 'hourly'
                                  ? 'Hourly'
                                  : '-'}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {exec.employment_type?.replace('_', ' ') || 'Full-time'}
                            </p>
                          </div>
                          <EditExecutiveDialog executive={exec} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="contractors" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Contractors</CardTitle>
              <CardDescription>Delivery contractors and their personal details</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredContractors.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No contractors found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredContractors.map(contractor => (
                    <div key={contractor.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-600 font-medium text-lg">
                            {contractor.name?.charAt(0) || 'C'}
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold">{contractor.name}</h4>
                              <Badge variant={contractor.is_active ? 'default' : 'secondary'}>
                                {contractor.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                              {contractor.sex && (
                                <Badge variant="outline" className="capitalize">
                                  {contractor.sex}
                                </Badge>
                              )}
                            </div>
                            {(contractor.first_name || contractor.last_name) && (
                              <p className="text-sm text-muted-foreground">
                                {contractor.first_name} {contractor.last_name}
                              </p>
                            )}
                            <p className="text-sm text-muted-foreground">
                              {contractor.position || 'Contractor'} • {contractor.department || 'Delivery'}
                            </p>
                            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-2">
                              {contractor.date_of_birth && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5" />
                                  {calculateAge(contractor.date_of_birth)} yrs
                                </span>
                              )}
                              {contractor.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="w-3.5 h-3.5" />
                                  {contractor.phone}
                                </span>
                              )}
                              {contractor.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="w-3.5 h-3.5" />
                                  {contractor.email}
                                </span>
                              )}
                              {contractor.city && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="w-3.5 h-3.5" />
                                  {contractor.city}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-1">
                              {contractor.nic && <span>NIC: {contractor.nic}</span>}
                              {contractor.employee_code && <span>Code: {contractor.employee_code}</span>}
                              {contractor.date_joined && <span>Joined: {formatDate(contractor.date_joined)}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {contractor.pay_type === 'fixed_monthly' && contractor.monthly_salary 
                                ? `Rs ${contractor.monthly_salary.toLocaleString()}/mo`
                                : contractor.rate_per_delivery
                                  ? `Rs ${contractor.rate_per_delivery}/delivery`
                                  : '-'}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {contractor.pay_type?.replace('_', ' ') || 'Per Delivery'}
                            </p>
                          </div>
                          <EditContractorDetailsDialog contractor={contractor} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
