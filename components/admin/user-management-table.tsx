'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { approveUser, revokeUser, updateUserRole, deleteUser, assignRiderToContractor, linkUserToRider, linkUserToContractor, unlinkUserFromRider, unlinkUserFromContractor, getUnlinkedRiders, getUnlinkedContractors, resetUserPassword, createUser, updateUserProfile } from '@/lib/admin-actions'
import { Label } from '@/components/ui/label'
import type { Profile, UserRole } from '@/lib/types'
import { ROLE_LABELS } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MoreHorizontal, Check, X, Trash2, Search, Link2, Unlink, KeyRound, Eye, EyeOff, Copy, UserPlus, Pencil } from 'lucide-react'

interface Props {
  users: Profile[]
  contractors: Profile[]
  currentUserId: string
}

interface UnlinkedRider {
  id: string
  name: string
  phone: string | null
}

interface UnlinkedContractor {
  id: string
  name: string
  phone: string | null
  email: string | null
}

export function UserManagementTable({ users, contractors, currentUserId }: Props) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [unlinkedRiders, setUnlinkedRiders] = useState<UnlinkedRider[]>([])
  const [unlinkedContractors, setUnlinkedContractors] = useState<UnlinkedContractor[]>([])
  const [selectedLinkId, setSelectedLinkId] = useState<string>('')
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [passwordUser, setPasswordUser] = useState<Profile | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [editFormData, setEditFormData] = useState({ name: '', email: '', phone: '' })
  const [newUser, setNewUser] = useState({ email: '', password: '', name: '', role: 'marketing_agent' as UserRole, phone: '' })
  const router = useRouter()

  // Fetch unlinked riders and contractors
  useEffect(() => {
    async function fetchUnlinked() {
      const [ridersResult, contractorsResult] = await Promise.all([
        getUnlinkedRiders(),
        getUnlinkedContractors()
      ])
      if (ridersResult.riders) setUnlinkedRiders(ridersResult.riders)
      if (contractorsResult.contractors) setUnlinkedContractors(contractorsResult.contractors)
    }
    fetchUnlinked()
  }, [])

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.name?.toLowerCase().includes(search.toLowerCase()) ||
      user.email.toLowerCase().includes(search.toLowerCase())
    
    const matchesRole = roleFilter === 'all' || user.role === roleFilter
    const matchesStatus = 
      statusFilter === 'all' || 
      (statusFilter === 'approved' && user.approved) ||
      (statusFilter === 'pending' && !user.approved)
    
    return matchesSearch && matchesRole && matchesStatus
  })

  const pendingCount = users.filter(u => !u.approved).length
  const approvedCount = users.filter(u => u.approved).length
  const unlinkedRiderUsers = users.filter(u => u.role === 'rider' && !u.rider_id).length
  const unlinkedContractorUsers = users.filter(u => u.role === 'contractor' && !u.contractor_id).length

  async function handleApprove(userId: string) {
    setLoading(userId)
    await approveUser(userId)
    setLoading(null)
    router.refresh()
  }

  async function handleRevoke(userId: string) {
    setLoading(userId)
    await revokeUser(userId)
    setLoading(null)
    router.refresh()
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    setLoading(userId)
    await updateUserRole(userId, role)
    setLoading(null)
    router.refresh()
  }

  async function handleContractorAssignment(riderId: string, contractorId: string) {
    setLoading(riderId)
    await assignRiderToContractor(riderId, contractorId === 'none' ? null : contractorId)
    setLoading(null)
    router.refresh()
  }

  async function handleDelete() {
    if (!selectedUser) return
    setLoading(selectedUser.id)
    await deleteUser(selectedUser.id)
    setDeleteDialogOpen(false)
    setSelectedUser(null)
    setLoading(null)
    router.refresh()
  }

  async function handleLinkUser() {
    if (!selectedUser || !selectedLinkId) return
    setLoading(selectedUser.id)
    
    let result: { error?: string; success?: boolean } = {}
    
    if (selectedUser.role === 'rider') {
      result = await linkUserToRider(selectedUser.id, selectedLinkId)
      if (result.success) {
        // Remove from unlinked list
        setUnlinkedRiders(prev => prev.filter(r => r.id !== selectedLinkId))
      }
    } else if (selectedUser.role === 'contractor') {
      result = await linkUserToContractor(selectedUser.id, selectedLinkId)
      if (result.success) {
        // Remove from unlinked list
        setUnlinkedContractors(prev => prev.filter(c => c.id !== selectedLinkId))
      }
    }
    
    if (result.error) {
      console.error('[v0] Link error:', result.error)
      alert(`Failed to link: ${result.error}`)
    }
    
    setLinkDialogOpen(false)
    setSelectedUser(null)
    setSelectedLinkId('')
    setLoading(null)
    router.refresh()
  }

  async function handleResetPassword() {
    if (!passwordUser || !newPassword.trim()) return
    setLoading(passwordUser.id)
    const result = await resetUserPassword(passwordUser.id, newPassword.trim())
    if (result.error) {
      alert(`Failed: ${result.error}`)
    }
    setPasswordDialogOpen(false)
    setPasswordUser(null)
    setNewPassword('')
    setLoading(null)
    router.refresh()
  }

  function openPasswordDialog(user: Profile) {
    setPasswordUser(user)
    setNewPassword('')
    setPasswordDialogOpen(true)
  }

  async function handleCreateUser() {
    if (!newUser.email || !newUser.password || !newUser.name) return
    setLoading('create')
    const result = await createUser({
      email: newUser.email,
      password: newUser.password,
      name: newUser.name,
      role: newUser.role,
      phone: newUser.phone || undefined,
      approved: true,
    })
    if (result.error) {
      alert(`Failed: ${result.error}`)
    }
    setCreateDialogOpen(false)
    setNewUser({ email: '', password: '', name: '', role: 'marketing_agent', phone: '' })
    setLoading(null)
    router.refresh()
  }

  function togglePasswordVisibility(userId: string) {
    setShowPasswords(prev => ({ ...prev, [userId]: !prev[userId] }))
  }

  function openEditDialog(user: Profile) {
    setEditUser(user)
    setEditFormData({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
    })
    setEditDialogOpen(true)
  }

  async function handleUpdateUser() {
    if (!editUser) return
    setLoading(editUser.id)
    const result = await updateUserProfile(editUser.id, editFormData)
    if (result.error) {
      alert(`Failed: ${result.error}`)
    }
    setEditDialogOpen(false)
    setEditUser(null)
    setLoading(null)
    router.refresh()
  }

  function openLinkDialog(user: Profile) {
    setSelectedUser(user)
    setSelectedLinkId('')
    setLinkDialogOpen(true)
  }

  async function handleUnlink(user: Profile) {
    setLoading(user.id)
    
    if (user.role === 'rider' && user.rider_id) {
      await unlinkUserFromRider(user.id)
    } else if (user.role === 'contractor' && user.contractor_id) {
      await unlinkUserFromContractor(user.id)
    }
    
    // Refresh unlinked lists
    const [ridersResult, contractorsResult] = await Promise.all([
      getUnlinkedRiders(),
      getUnlinkedContractors()
    ])
    if (ridersResult.riders) setUnlinkedRiders(ridersResult.riders)
    if (contractorsResult.contractors) setUnlinkedContractors(contractorsResult.contractors)
    
    setLoading(null)
    router.refresh()
  }

  function isLinked(user: Profile): boolean {
    if (user.role === 'rider' && user.rider_id) return true
    if (user.role === 'contractor' && user.contractor_id) return true
    return false
  }

  // Check if user needs linking
  function needsLinking(user: Profile): boolean {
    if (user.role === 'rider' && !user.rider_id) return true
    if (user.role === 'contractor' && !user.contractor_id) return true
    return false
  }

  // Get linked status badge
  function getLinkedBadge(user: Profile) {
    if (user.role === 'rider') {
      if (user.rider_id) {
        return <Badge variant="outline" className="bg-success/10 text-success border-success/30"><Link2 className="w-3 h-3 mr-1" />Linked</Badge>
      }
      return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30"><Unlink className="w-3 h-3 mr-1" />Not Linked</Badge>
    }
    if (user.role === 'contractor') {
      if (user.contractor_id) {
        return <Badge variant="outline" className="bg-success/10 text-success border-success/30"><Link2 className="w-3 h-3 mr-1" />Linked</Badge>
      }
      return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30"><Unlink className="w-3 h-3 mr-1" />Not Linked</Badge>
    }
    return null
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Approval
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Approved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{approvedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unlinked Riders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{unlinkedRiderUsers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unlinked Contractors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{unlinkedContractorUsers}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
          <UserPlus className="w-4 h-4" />
          Create User
        </Button>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Password</TableHead>
              <TableHead>Linked Status</TableHead>
              <TableHead>Contractor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map((user) => (
                <TableRow key={user.id} className={needsLinking(user) ? 'bg-warning/5' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-medium text-sm">
                        {user.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium">{user.name || 'No name'}</p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select 
                      value={user.role} 
                      onValueChange={(v) => handleRoleChange(user.id, v as UserRole)}
                      disabled={user.id === currentUserId || loading === user.id}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {user.password_plain ? (
                      <div className="flex items-center gap-1">
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                          {showPasswords[user.id] ? user.password_plain : '********'}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => togglePasswordVisibility(user.id)}
                        >
                          {showPasswords[user.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => {
                            navigator.clipboard.writeText(user.password_plain!)
                          }}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => openPasswordDialog(user)}
                      >
                        <KeyRound className="w-3 h-3 mr-1" />
                        Set
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {getLinkedBadge(user)}
                  </TableCell>
                  <TableCell>
                    {user.role === 'rider' ? (
                      <Select
                        value={user.contractor_id || 'none'}
                        onValueChange={(v) => handleContractorAssignment(user.id, v)}
                        disabled={loading === user.id}
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue placeholder="Assign..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Independent</SelectItem>
                          {contractors.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name || c.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.approved ? 'default' : 'secondary'}>
                      {user.approved ? 'Approved' : 'Pending'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={loading === user.id}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => openEditDialog(user)}>
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit User
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {user.approved ? (
                          <DropdownMenuItem onClick={() => handleRevoke(user.id)}>
                            <X className="w-4 h-4 mr-2" />
                            Revoke Access
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => handleApprove(user.id)}>
                            <Check className="w-4 h-4 mr-2" />
                            Approve User
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => openPasswordDialog(user)}>
                            <KeyRound className="w-4 h-4 mr-2" />
                            {user.password_plain ? 'Reset Password' : 'Set Password'}
                          </DropdownMenuItem>
                        {needsLinking(user) && (
                          <DropdownMenuItem onClick={() => openLinkDialog(user)}>
                            <Link2 className="w-4 h-4 mr-2" />
                            Link to {user.role === 'rider' ? 'Rider' : 'Contractor'} Record
                          </DropdownMenuItem>
                        )}
                        {isLinked(user) && (
                          <DropdownMenuItem onClick={() => handleUnlink(user)}>
                            <Unlink className="w-4 h-4 mr-2" />
                            Unlink {user.role === 'rider' ? 'Rider' : 'Contractor'} Record
                          </DropdownMenuItem>
                        )}
                        {user.id !== currentUserId && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedUser(user)
                                setDeleteDialogOpen(true)
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete User
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedUser?.name || selectedUser?.email}? 
              This action cannot be undone and will remove all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Link User Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Link User to {selectedUser?.role === 'rider' ? 'Rider' : 'Contractor'} Record
            </DialogTitle>
            <DialogDescription>
              Select the {selectedUser?.role === 'rider' ? 'rider' : 'contractor'} record from your imports to link with this user account.
              This will connect their login to their delivery/payment records.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">User Account</p>
              <p className="text-sm text-muted-foreground">{selectedUser?.name || selectedUser?.email}</p>
              <p className="text-xs text-muted-foreground">{selectedUser?.email}</p>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Select {selectedUser?.role === 'rider' ? 'Rider' : 'Contractor'} Record
              </label>
              <Select value={selectedLinkId} onValueChange={setSelectedLinkId}>
                <SelectTrigger>
                  <SelectValue placeholder={`Select a ${selectedUser?.role === 'rider' ? 'rider' : 'contractor'}...`} />
                </SelectTrigger>
                <SelectContent>
                  {selectedUser?.role === 'rider' ? (
                    unlinkedRiders.length === 0 ? (
                      <SelectItem value="none" disabled>No unlinked riders available</SelectItem>
                    ) : (
                      unlinkedRiders.map((rider) => (
                        <SelectItem key={rider.id} value={rider.id}>
                          <div className="flex flex-col">
                            <span>{rider.name}</span>
                            {rider.phone && <span className="text-xs text-muted-foreground">{rider.phone}</span>}
                          </div>
                        </SelectItem>
                      ))
                    )
                  ) : (
                    unlinkedContractors.length === 0 ? (
                      <SelectItem value="none" disabled>No unlinked contractors available</SelectItem>
                    ) : (
                      unlinkedContractors.map((contractor) => (
                        <SelectItem key={contractor.id} value={contractor.id}>
                          <div className="flex flex-col">
                            <span>{contractor.name}</span>
                            {contractor.email && <span className="text-xs text-muted-foreground">{contractor.email}</span>}
                          </div>
                        </SelectItem>
                      ))
                    )
                  )}
                </SelectContent>
              </Select>
              
              {selectedUser?.role === 'rider' && unlinkedRiders.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  All imported riders have been linked. Import new deliveries to create more rider records.
                </p>
              )}
              {selectedUser?.role === 'contractor' && unlinkedContractors.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  All contractors have been linked. Create a new contractor in the import process first.
                </p>
              )}
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleLinkUser} 
              disabled={!selectedLinkId || loading === selectedUser?.id}
            >
              {loading === selectedUser?.id ? 'Linking...' : 'Link Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {passwordUser?.password_plain ? 'Reset' : 'Set'} Password
            </DialogTitle>
            <DialogDescription>
              {passwordUser?.password_plain ? 'Reset' : 'Set'} password for {passwordUser?.name || passwordUser?.email}. This will update their login credentials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">{passwordUser?.name || 'No name'}</p>
              <p className="text-xs text-muted-foreground">{passwordUser?.email}</p>
              <p className="text-xs text-muted-foreground capitalize">{passwordUser?.role}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="text"
                placeholder="Enter new password..."
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Minimum 6 characters. Password will be visible to admin.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleResetPassword} 
              disabled={!newPassword.trim() || newPassword.trim().length < 6 || loading === passwordUser?.id}
            >
              {loading === passwordUser?.id ? 'Saving...' : 'Save Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user profile information.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full Name</Label>
              <Input
                id="edit-name"
                placeholder="John Doe"
                value={editFormData.name}
                onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email Address</Label>
              <Input
                id="edit-email"
                type="email"
                placeholder="user@example.com"
                value={editFormData.email}
                onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                placeholder="+230 XX XXX XXXX"
                value={editFormData.phone}
                onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleUpdateUser} 
              disabled={!editFormData.name || !editFormData.email || loading === editUser?.id}
            >
              {loading === editUser?.id ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
            <DialogDescription>
              Create a new user account. The user will be approved automatically and can login immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-name">Full Name</Label>
                <Input
                  id="new-name"
                  placeholder="John Doe"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-phone">Phone (optional)</Label>
                <Input
                  id="new-phone"
                  placeholder="+233 XX XXX XXXX"
                  value={newUser.phone}
                  onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-email">Email Address</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="user@example.com"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-role">Role</Label>
              <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v as UserRole })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-password">Password</Label>
              <Input
                id="new-user-password"
                type="text"
                placeholder="Min 6 characters"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Password will be visible to admin for sharing with the user.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateUser} 
              disabled={!newUser.email || !newUser.name || !newUser.password || newUser.password.length < 6 || loading === 'create'}
            >
              {loading === 'create' ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
