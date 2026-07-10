'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Search, Upload, Users, ThumbsUp, ThumbsDown, Minus, Trophy, History } from 'lucide-react'
import Link from 'next/link'
import { ClientsTable } from '@/components/clients/clients-table'
import { AddClientDialog } from '@/components/clients/add-client-dialog'
import { ImportHistoryDialog } from '@/components/clients/import-history-dialog'
import { getClientsPage, getClientStats } from '@/lib/client-actions'
import type { Client } from '@/lib/types'

const PAGE_SIZE = 50

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showHistoryImport, setShowHistoryImport] = useState(false)
  const [stats, setStats] = useState<{ total: number; good: number; average: number; bad: number } | null>(null)

  const loadData = async () => {
    setLoading(true)
    const [pageData, statsData] = await Promise.all([
      getClientsPage({ search: searchQuery, status: statusFilter, page, pageSize: PAGE_SIZE }),
      getClientStats(),
    ])
    setClients(pageData.clients)
    setTotal(pageData.total)
    setStats(statsData)
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, statusFilter, page])

  // Debounce search typing so we don't fire a query per keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      setSearchQuery(searchInput)
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Client Database</h1>
          <p className="text-muted-foreground">Client ratings based on delivery history</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/clients/top">
              <Trophy className="mr-2 h-4 w-4" />
              Top 100
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setShowHistoryImport(true)}>
            <History className="mr-2 h-4 w-4" />
            Import Past Data
          </Button>
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Client
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total?.toLocaleString() ?? '0'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Good Clients</CardTitle>
            <ThumbsUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{stats?.good?.toLocaleString() ?? '0'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Average Clients</CardTitle>
            <Minus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.average?.toLocaleString() ?? '0'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Bad Clients</CardTitle>
            <ThumbsDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats?.bad?.toLocaleString() ?? '0'}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Clients</CardTitle>
          <CardDescription>
            {total.toLocaleString()} clients · sorted by total sales
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, email..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ratings</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="average">Average</SelectItem>
                <SelectItem value="bad">Bad</SelectItem>
                <SelectItem value="new">New</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ClientsTable
            clients={clients}
            loading={loading}
            onRefresh={loadData}
          />
          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AddClientDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSuccess={loadData}
      />

      <ImportHistoryDialog
        open={showHistoryImport}
        onOpenChange={setShowHistoryImport}
        onSuccess={loadData}
      />
    </div>
  )
}
