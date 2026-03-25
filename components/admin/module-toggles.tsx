'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { toggleOrdersModule } from '@/lib/company-settings-actions'
import { ShoppingCart, Loader2 } from 'lucide-react'

export function ModuleToggles({ ordersModuleEnabled }: { ordersModuleEnabled: boolean }) {
  const [ordersEnabled, setOrdersEnabled] = useState(ordersModuleEnabled)
  const [saving, setSaving] = useState(false)

  async function handleToggleOrders(checked: boolean) {
    setSaving(true)
    setOrdersEnabled(checked)
    
    const result = await toggleOrdersModule(checked)
    if (result.error) {
      // Revert on error
      setOrdersEnabled(!checked)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <ShoppingCart className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <Label htmlFor="orders-module" className="text-base font-medium cursor-pointer">
              Orders Module
            </Label>
            <p className="text-sm text-muted-foreground">
              Allow contractors and riders to access the Orders page
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          <Switch
            id="orders-module"
            checked={ordersEnabled}
            onCheckedChange={handleToggleOrders}
            disabled={saving}
          />
        </div>
      </div>
      
      <p className="text-xs text-muted-foreground">
        When disabled, the Orders tab will be hidden from contractor and rider dashboards.
      </p>
    </div>
  )
}
