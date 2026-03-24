'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import type { UserRole } from '@/lib/types'

interface RoleSwitcherContextType {
  viewAsRole: UserRole | null
  setViewAsRole: (role: UserRole | null) => void
  isViewingAs: boolean
  actualRole: UserRole
}

const RoleSwitcherContext = createContext<RoleSwitcherContextType | undefined>(undefined)

export function RoleSwitcherProvider({ 
  children, 
  actualRole 
}: { 
  children: React.ReactNode
  actualRole: UserRole 
}) {
  const [viewAsRole, setViewAsRole] = useState<UserRole | null>(null)

  // Clear view-as role on page refresh (stored in session only)
  useEffect(() => {
    const stored = sessionStorage.getItem('viewAsRole')
    if (stored && ['admin', 'manager', 'marketing_agent', 'contractor', 'rider'].includes(stored)) {
      setViewAsRole(stored as UserRole)
    }
  }, [])

  useEffect(() => {
    if (viewAsRole) {
      sessionStorage.setItem('viewAsRole', viewAsRole)
    } else {
      sessionStorage.removeItem('viewAsRole')
    }
  }, [viewAsRole])

  return (
    <RoleSwitcherContext.Provider 
      value={{ 
        viewAsRole, 
        setViewAsRole, 
        isViewingAs: viewAsRole !== null,
        actualRole
      }}
    >
      {children}
    </RoleSwitcherContext.Provider>
  )
}

export function useRoleSwitcher() {
  const context = useContext(RoleSwitcherContext)
  if (context === undefined) {
    throw new Error('useRoleSwitcher must be used within a RoleSwitcherProvider')
  }
  return context
}

// Helper hook to get the effective role (viewed role or actual role)
export function useEffectiveRole() {
  const context = useContext(RoleSwitcherContext)
  if (context === undefined) {
    throw new Error('useEffectiveRole must be used within a RoleSwitcherProvider')
  }
  return context.viewAsRole || context.actualRole
}
