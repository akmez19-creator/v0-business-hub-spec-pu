'use client'

import React from "react"

import { useRoleSwitcher } from './role-switcher-context'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import type { UserRole } from '@/lib/types'
import { 
  Eye, 
  EyeOff,
  Shield, 
  UserCog, 
  Megaphone, 
  Building2, 
  Bike,
  Check
} from 'lucide-react'

const ROLE_CONFIG: Record<UserRole, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  admin: { label: 'Admin', icon: Shield, color: 'bg-red-100 text-red-700 border-red-200' },
  manager: { label: 'Manager', icon: UserCog, color: 'bg-blue-100 text-blue-700 border-blue-200' },
  marketing_agent: { label: 'Marketing Agent', icon: Megaphone, color: 'bg-purple-100 text-purple-700 border-purple-200' },
  contractor: { label: 'Contractor', icon: Building2, color: 'bg-amber-100 text-amber-700 border-amber-200' },
  rider: { label: 'Rider', icon: Bike, color: 'bg-green-100 text-green-700 border-green-200' },
}

const ALL_ROLES: UserRole[] = ['admin', 'manager', 'marketing_agent', 'contractor', 'rider']

export function RoleSwitcher() {
  const { viewAsRole, setViewAsRole, isViewingAs, actualRole } = useRoleSwitcher()

  // Only show for admins
  if (actualRole !== 'admin') {
    return null
  }

  const currentViewRole = viewAsRole || actualRole
  const currentConfig = ROLE_CONFIG[currentViewRole]
  const CurrentIcon = currentConfig.icon

  return (
    <div className="flex items-center gap-2">
      {isViewingAs && (
        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 animate-pulse">
          <Eye className="w-3 h-3 mr-1" />
          Viewing as {ROLE_CONFIG[viewAsRole!].label}
        </Badge>
      )}
      
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className={isViewingAs ? 'border-amber-400 bg-amber-50' : ''}
          >
            <CurrentIcon className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">View As</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex items-center gap-2">
            <Eye className="w-4 h-4" />
            Test Role Interface
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {ALL_ROLES.map((role) => {
            const config = ROLE_CONFIG[role]
            const Icon = config.icon
            const isSelected = currentViewRole === role
            const isActual = role === actualRole
            
            return (
              <DropdownMenuItem 
                key={role}
                onClick={() => setViewAsRole(role === actualRole ? null : role)}
                className="flex items-center justify-between"
              >
                <span className="flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {config.label}
                  {isActual && (
                    <Badge variant="secondary" className="text-xs px-1 py-0">
                      You
                    </Badge>
                  )}
                </span>
                {isSelected && <Check className="w-4 h-4 text-primary" />}
              </DropdownMenuItem>
            )
          })}
          
          {isViewingAs && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => setViewAsRole(null)}
                className="text-amber-600 focus:text-amber-600"
              >
                <EyeOff className="w-4 h-4 mr-2" />
                Exit View Mode
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
