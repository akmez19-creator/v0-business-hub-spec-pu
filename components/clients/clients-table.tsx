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
import { deleteClient } from '@/lib/client-actions'
import type { Client } from '@/lib/types'

interface ClientsTableProps {
  clients: Client[]
  loading: boolean
  onRefresh: () => void
}

export function ClientsTable({ clients, loading, onRefresh }: ClientsTableProps) {
  const [editingClient, setEditingClient] = useState<Client | null>(null)

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

  const getSourceBadge = (source: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'outline'; label: string }> = {
      manual: { variant: 'secondary', label: 'Manual' },
      import: { variant: 'outline', label: 'Import' },
      website: { variant: 'default', label: 'Website' },
      facebook: { variant: 'default', label: 'Facebook' },
    }
    const config = variants[source] || { variant: 'secondary', label: source }
    return <Badge variant={config.variant}>{config.label}</Badge>
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
              <TableHead>Source</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={client.id}>
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
                        <a href={`tel:${client.phone}`} className="hover:underline">
                          {formatPhone(client.phone)}
                        </a>
                      </div>
                    )}
                    {client.email && (
                      <div className="flex items-center gap-1 text-sm">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <a href={`mailto:${client.email}`} className="hover:underline">
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
                <TableCell>{getSourceBadge(client.source)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(client.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell>
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
    </>
  )
}
