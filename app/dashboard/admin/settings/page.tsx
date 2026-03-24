import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, MapPin } from 'lucide-react'
import { CompanySettingsForm } from '@/components/admin/company-settings-form'
import { WarehouseMapPicker } from '@/components/admin/warehouse-map-picker'
import { getCompanySettings } from '@/lib/company-settings-actions'

export default async function AdminSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  const settings = await getCompanySettings()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Company Settings</h1>
        <p className="text-muted-foreground">Manage your company information for invoices and documents.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle>Company Information</CardTitle>
              <CardDescription>This information appears on invoices, payslips, and client-facing pages.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <CompanySettingsForm settings={settings} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <CardTitle>Warehouse Location</CardTitle>
              <CardDescription>Pin your warehouse on the map. All contractors pick up products from here.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <WarehouseMapPicker
            warehouseName={settings?.warehouse_name || null}
            warehouseLat={settings?.warehouse_lat || null}
            warehouseLng={settings?.warehouse_lng || null}
            mapboxToken={process.env.MAPBOX_TOKEN || ''}
          />
        </CardContent>
      </Card>
    </div>
  )
}
