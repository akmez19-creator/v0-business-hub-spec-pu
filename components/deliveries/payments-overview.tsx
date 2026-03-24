'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Wallet,
  TrendingUp,
  Clock,
  Search,
  Banknote,
  ArrowUpRight,
  ArrowDownLeft,
  Building2,
  Bike,
  CheckCircle,
  Package,
  CreditCard,
} from 'lucide-react'
import { recordContractorPayout, processWithdrawal, confirmWithdrawalPaid } from '@/lib/payment-actions'

interface Contractor {
  id: string
  name: string
  phone: string | null
  email: string | null
  rate_per_delivery: number | null
}

interface WalletData {
  id: string
  owner_type: string
  owner_id: string
  balance: number
  total_earned: number
  total_paid_out: number
}

interface Transaction {
  id: string
  wallet_id: string
  transaction_type: string
  amount: number
  description: string | null
  reference_type: string | null
  created_at: string
  wallets: { owner_type: string; owner_id: string } | null
}

interface PaymentsOverviewProps {
  contractors: Contractor[]
  contractorWallets: Record<string, WalletData>
  contractorRateMap: Record<string, number>
  contractorMonthlySalary?: Record<string, number>
  contractorEarnings: Record<string, number>
  contractorThisMonthEarnings: Record<string, number>
  contractorLastMonthEarnings: Record<string, number>
  contractorPaidOut: Record<string, number>
  contractorDeliveryCounts: Record<string, number>
  contractorThisMonthCounts: Record<string, number>
  contractorLastMonthCounts: Record<string, number>
  ridersPerContractor: Record<string, number>
  recentTransactions: Transaction[]
  totalContractorEarnings: number
  totalContractorPaidOut: number
  totalContractorOwed: number
  totalThisMonth: number
  totalLastMonth: number
  withdrawalRequests: any[]
}

export function PaymentsOverview({
  contractors,
  contractorWallets,
  contractorRateMap,
  contractorMonthlySalary = {},
  contractorEarnings,
  contractorThisMonthEarnings,
  contractorLastMonthEarnings,
  contractorPaidOut,
  contractorDeliveryCounts,
  contractorThisMonthCounts,
  contractorLastMonthCounts,
  ridersPerContractor,
  recentTransactions,
  totalContractorEarnings,
  totalContractorPaidOut,
  totalContractorOwed,
  totalThisMonth,
  totalLastMonth,
  withdrawalRequests,
}: PaymentsOverviewProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [payoutDialog, setPayoutDialog] = useState<{ id: string; name: string; owed: number } | null>(null)
  const [payoutAmount, setPayoutAmount] = useState('')
  const [payoutDescription, setPayoutDescription] = useState('')
  const [isPending, startTransition] = useTransition()

  const pendingWithdrawals = withdrawalRequests.filter(w => w.status === 'pending')
  const approvedWithdrawals = withdrawalRequests.filter(w => w.status === 'approved')

  const filteredContractors = contractors.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  )

  function getOwnerName(ownerType: string, ownerId: string) {
    return contractors.find(c => c.id === ownerId)?.name || 'Unknown'
  }

  function handleRecordPayout() {
    if (!payoutDialog || !payoutAmount) return
    startTransition(async () => {
      await recordContractorPayout(payoutDialog.id, Number(payoutAmount), payoutDescription || undefined)
      setPayoutDialog(null)
      setPayoutAmount('')
      setPayoutDescription('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-muted/50">
                <TrendingUp className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Month</p>
                <p className="text-2xl font-bold">Rs {totalLastMonth.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">This Month</p>
                <p className="text-2xl font-bold text-primary">Rs {totalThisMonth.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-emerald-500/10">
                <CheckCircle className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Paid Out</p>
                <p className="text-2xl font-bold text-emerald-500">Rs {totalContractorPaidOut.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-500/10">
                <Clock className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Owed</p>
                <p className="text-2xl font-bold text-amber-500">Rs {Math.max(0, totalContractorOwed).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search contractors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Badge variant="secondary">{contractors.length} contractors</Badge>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="contractors">
        <TabsList>
          <TabsTrigger value="contractors" className="gap-2">
            <Building2 className="w-4 h-4" />
            Contractors ({contractors.length})
          </TabsTrigger>
          <TabsTrigger value="withdrawals" className="gap-2 relative">
            <Banknote className="w-4 h-4" />
            Withdrawals
            {pendingWithdrawals.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                {pendingWithdrawals.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="transactions" className="gap-2">
            <CreditCard className="w-4 h-4" />
            Payout History
          </TabsTrigger>
        </TabsList>

        {/* Contractors Tab */}
        <TabsContent value="contractors" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-center">Riders</TableHead>
                  <TableHead className="text-center">Deliveries</TableHead>
                  <TableHead className="text-right">Last Month</TableHead>
                  <TableHead className="text-right">This Month</TableHead>
                  <TableHead className="text-right">Total Earned</TableHead>
                  <TableHead className="text-right">Paid Out</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredContractors.map((contractor) => {
                  const rate = contractorRateMap[contractor.id] || 0
                  const salary = contractorMonthlySalary[contractor.id] || 0
                  const totalDel = contractorDeliveryCounts[contractor.id] || 0
                  const thisMonthDel = contractorThisMonthCounts[contractor.id] || 0
                  const lastMonthDel = contractorLastMonthCounts[contractor.id] || 0
                  const earned = contractorEarnings[contractor.id] || 0
                  const thisMonth = contractorThisMonthEarnings[contractor.id] || 0
                  const lastMonth = contractorLastMonthEarnings[contractor.id] || 0
                  const paid = contractorPaidOut[contractor.id] || 0
                  // Owed = earned from deliveries - fixed salary deduction - already paid out
                  const owed = Math.max(0, earned - salary - paid)
                  const riderCount = ridersPerContractor[contractor.id] || 0
                  const hasSalary = salary > 0

                  return (
                    <TableRow key={contractor.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{contractor.name}</p>
                          {hasSalary && (
                            <Badge variant="secondary" className="text-[9px] mt-0.5 bg-blue-500/10 text-blue-500 border-blue-500/20">
                              Rs {salary.toLocaleString()}/mo fixed
                            </Badge>
                          )}
                          {contractor.email && (
                            <p className="text-xs text-muted-foreground">{contractor.email}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="text-sm font-medium">Rs {rate}/del</span>
                          {hasSalary && (
                            <p className="text-[10px] text-blue-500">- Rs {salary.toLocaleString()}/mo</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Bike className="w-3.5 h-3.5 text-muted-foreground" />
                          <span>{riderCount}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Package className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="font-medium">{totalDel}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>
                          <span className="text-sm text-muted-foreground">Rs {lastMonth.toLocaleString()}</span>
                          <p className="text-[10px] text-muted-foreground">{lastMonthDel} del</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>
                          <span className="text-sm font-medium text-primary">Rs {thisMonth.toLocaleString()}</span>
                          <p className="text-[10px] text-muted-foreground">{thisMonthDel} del</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        Rs {earned.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-emerald-500">
                        <div>
                          <span>Rs {paid.toLocaleString()}</span>
                          {hasSalary && (
                            <p className="text-[10px] text-blue-500">+ Rs {salary.toLocaleString()} fixed</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={`text-right font-bold ${owed > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {owed > 0 ? `Rs ${owed.toLocaleString()}` : 'Settled'}
                      </TableCell>
                      <TableCell className="text-right">
                        {owed > 0 && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => {
                              setPayoutDialog({ id: contractor.id, name: contractor.name, owed })
                              setPayoutAmount(owed.toString())
                            }}
                            title="Record payout"
                          >
                            <Banknote className="w-4 h-4 mr-1" />
                            Pay
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {filteredContractors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No contractors found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          {/* Summary footer */}
          <div className="mt-4 p-4 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-sm text-muted-foreground mb-1">Earnings = Deliveries x Rate. Fixed monthly salary (if set) is deducted from earnings.</p>
            <p className="text-xs text-muted-foreground">Rider payments are managed by each contractor separately. Admin only pays contractors.</p>
          </div>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Payout History</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Paid To</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTransactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-muted-foreground">
                      {new Date(tx.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {tx.transaction_type === 'payout' ? (
                          <ArrowUpRight className="w-4 h-4 text-red-500" />
                        ) : (
                          <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
                        )}
                        <span className="capitalize">{tx.transaction_type}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {tx.wallets && (
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4" />
                          {getOwnerName(tx.wallets.owner_type, tx.wallets.owner_id)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {tx.description || '-'}
                    </TableCell>
                    <TableCell className="text-right font-medium text-red-500">
                      Rs {Math.abs(Number(tx.amount)).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {recentTransactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No payouts recorded yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Withdrawals Tab */}
        <TabsContent value="withdrawals" className="mt-4 space-y-4">
          {/* Pending Withdrawal Requests */}
          {pendingWithdrawals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-500">
                  <Clock className="w-5 h-5" />
                  Pending Requests ({pendingWithdrawals.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pendingWithdrawals.map((w: any) => {
                  const cName = contractors.find(c => c.id === w.requester_id)?.name || 'Unknown'
                  return (
                    <div key={w.id} className="flex items-center justify-between p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">{cName}</p>
                        <p className="text-lg font-bold text-foreground">Rs {Number(w.amount).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(w.requested_at || w.created_at).toLocaleDateString()}
                        </p>
                        {w.notes && <p className="text-xs text-muted-foreground">Note: {w.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-destructive/30 text-destructive hover:bg-destructive/10"
                          disabled={isPending}
                          onClick={() => startTransition(async () => { await processWithdrawal(w.id, 'rejected'); router.refresh() })}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          disabled={isPending}
                          onClick={() => startTransition(async () => { await processWithdrawal(w.id, 'approved'); router.refresh() })}
                        >
                          {isPending ? 'Processing...' : 'Approve'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          {/* Approved - Awaiting Payment */}
          {approvedWithdrawals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-500">
                  <CheckCircle className="w-5 h-5" />
                  Approved - Awaiting Payment ({approvedWithdrawals.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {approvedWithdrawals.map((w: any) => {
                  const cName = contractors.find(c => c.id === w.requester_id)?.name || 'Unknown'
                  return (
                    <div key={w.id} className="flex items-center justify-between p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">{cName}</p>
                        <p className="text-lg font-bold text-foreground">Rs {Number(w.amount).toLocaleString()}</p>
                        {w.notes && <p className="text-xs text-muted-foreground">Note: {w.notes}</p>}
                      </div>
                      <Button
                        size="sm"
                        className="bg-primary hover:bg-primary/90"
                        disabled={isPending}
                        onClick={() => startTransition(async () => { await confirmWithdrawalPaid(w.id); router.refresh() })}
                      >
                        {isPending ? 'Processing...' : 'Confirm Paid'}
                      </Button>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          {pendingWithdrawals.length === 0 && approvedWithdrawals.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <Banknote className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
                <p className="text-sm text-muted-foreground">No withdrawal requests at this time</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Payout Dialog */}
      <Dialog open={!!payoutDialog} onOpenChange={() => setPayoutDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payout - {payoutDialog?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-muted-foreground">Amount owed</p>
              <p className="text-xl font-bold text-amber-500">Rs {payoutDialog?.owed.toLocaleString()}</p>
            </div>

            <div className="space-y-2">
              <Label>Payout Amount (Rs)</Label>
              <Input
                type="number"
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
                placeholder="Enter amount"
              />
              <p className="text-xs text-muted-foreground">
                You can pay the full amount or a partial amount.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Input
                value={payoutDescription}
                onChange={(e) => setPayoutDescription(e.target.value)}
                placeholder="e.g., Weekly payment, Bank transfer"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutDialog(null)}>Cancel</Button>
            <Button onClick={handleRecordPayout} disabled={isPending || !payoutAmount}>
              {isPending ? 'Processing...' : `Pay Rs ${Number(payoutAmount || 0).toLocaleString()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
