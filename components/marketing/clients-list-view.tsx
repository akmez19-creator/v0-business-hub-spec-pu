'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Users, Search, Phone, MapPin, Mail } from 'lucide-react'

interface Client {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  source: string | null
  created_at: string
}

interface Props {
  clients: Client[]
}

const sourceColors: Record<string, string> = {
  manual: 'bg-blue-500/10 text-blue-500',
  import: 'bg-purple-500/10 text-purple-500',
  website: 'bg-emerald-500/10 text-emerald-500',
  facebook: 'bg-pink-500/10 text-pink-500',
}

export function ClientsListView({ clients }: Props) {
  const [search, setSearch] = useState('')

  const filteredClients = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone && c.phone.includes(search)) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
    (c.city && c.city.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Clients</h1>
        <p className="text-muted-foreground mt-1">{clients.length.toLocaleString()} total clients</p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, phone, email, or city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 max-w-md"
        />
      </div>

      {/* Clients Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredClients.map(client => (
          <Card key={client.id} className="hover:border-violet-500/50 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-violet-500" />
                </div>
                {client.source && (
                  <Badge variant="outline" className={sourceColors[client.source] || ''}>
                    {client.source}
                  </Badge>
                )}
              </div>
              <h3 className="font-semibold mb-2">{client.name}</h3>
              <div className="space-y-1 text-sm text-muted-foreground">
                {client.phone && (
                  <p className="flex items-center gap-2">
                    <Phone className="w-3 h-3" /> {client.phone}
                  </p>
                )}
                {client.email && (
                  <p className="flex items-center gap-2 truncate">
                    <Mail className="w-3 h-3" /> {client.email}
                  </p>
                )}
                {(client.address || client.city) && (
                  <p className="flex items-center gap-2">
                    <MapPin className="w-3 h-3" /> {client.address || ''}{client.address && client.city ? ', ' : ''}{client.city || ''}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredClients.length === 0 && (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No clients found</p>
        </div>
      )}
    </div>
  )
}
