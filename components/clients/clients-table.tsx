'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MoreHorizontal, Pencil, Trash2, Phone, Mail, MapPin } from 'lucide-react'
import { EditClientDialog } from './edit-client-dialog'
import { ClientDetailSheet } from './client-detail-sheet'
import { deleteClient } from '@/lib/client-actions'
import { CLIENT_STATUS_LABELS, CLIENT_STATUS_COLORS, BAD_SEVERITY_COLORS, getBadSeverity } from '@/lib/types'
import type { Client } from '@/lib/types'

interface ClientsTableProps {
  clients: Client[]
  loading: boolean
  onRefresh: () => void
}

export function ClientsTable({ clients, loading, onRefresh }: ClientsTableProps) {
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [detailClient, setDetailClient] = useState<Client | null>(null)

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this client?')) return
    await deleteClient(id)
    onRefresh()
  }

  const formatPhone = (phone: string | null) => {
    if (!phone) return '-'
    // Format as +230 XXXX XXXX for Mauritius
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length === 8) {
      return `+230 ${cleaned.slice(0, 4)} ${cleaned.slice(4)}`
    }
    if (cleaned.startsWith('230') && cleaned.length === 11) {
      return `+${cleaned.slice(0, 3)} ${cleaned.slice(3, 7)} ${cleaned.slice(7)}`
    }
    return phone
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (clients.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center text-center">
        <p className="text-muted-foreground">No clients found</p>
        <p className="text-sm text-muted-foreground">Add your first client or import from a file</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Delivered %</TableHead>
              <TableHead className="text-right">Total Sales</TableHead>
              <TableHead>Last Order</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow
                key={client.id}
                className="cursor-pointer"
                onClick={() => setDetailClient(client)}
              >
                <TableCell>
                  <div className="font-medium">{client.name}</div>
                  {client.notes && (
                    <div className="text-sm text-muted-foreground line-clamp-1">{client.notes}</div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    {client.phone && (
                      <div className="flex items-center gap-1 text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        <a href={`tel:${client.phone}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {formatPhone(client.phone)}
                        </a>
                      </div>
                    )}
                    {client.email && (
                      <div className="flex items-center gap-1 text-sm">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <a href={`mailto:${client.email}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {client.email}
                        </a>
                      </div>
                    )}
                    {!client.phone && !client.email && (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {client.city || client.address ? (
                    <div className="flex items-start gap-1 text-sm">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                      <div>
                        {client.city && <div>{client.city}</div>}
                        {client.address && (
                          <div className="text-muted-foreground line-clamp-1">{client.address}</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge className={CLIENT_STATUS_COLORS[client.client_status] || CLIENT_STATUS_COLORS.new}>
                      {CLIENT_STATUS_LABELS[client.client_status] || 'New'}
                    </Badge>
                    {client.client_status === 'bad' && (() => {
                      const sev = getBadSeverity(client.cms_orders || 0)
                      return (
                        <Badge
                          variant="outline"
                          className={BAD_SEVERITY_COLORS[sev.level]}
                          title={`${sev.failedOrders} failed (CMS) order${sev.failedOrders === 1 ? '' : 's'}`}
                        >
                          {sev.label} · {sev.failedOrders} failed
                        </Badge>
                      )
                    })()}
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm">
                  {(client.total_orders || 0).toLocaleString()}
                </TableCell>
                <TableCell className="text-right text-sm">
                  {(client.delivered_orders || 0) + (client.cms_orders || 0) > 0
                    ? `${Math.round(((client.delivered_orders || 0) / ((client.delivered_orders || 0) + (client.cms_orders || 0))) * 100)}%`
                    : '-'}
                </TableCell>
                <TableCell className="text-right text-sm font-medium">
                  {client.total_sales > 0 ? `Rs ${Number(client.total_sales).toLocaleString()}` : '-'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {client.last_order_date
                    ? new Date(client.last_order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '-'}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Open menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditingClient(client)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(client.id)}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editingClient && (
        <EditClientDialog
          client={editingClient}
          open={!!editingClient}
          onOpenChange={(open) => !open && setEditingClient(null)}
          onSuccess={() => {
            setEditingClient(null)
            onRefresh()
          }}
        />
      )}

      <ClientDetailSheet
        client={detailClient}
        open={!!detailClient}
        onOpenChange={(open) => !open && setDetailClient(null)}
      />
    </>
  )
}
