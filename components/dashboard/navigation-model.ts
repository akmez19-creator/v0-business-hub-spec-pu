import type { UserRole } from '@/lib/types'
import { navItems } from './navigation-config'
import { LayoutDashboard, MessageSquare, Truck, Boxes, Wallet, Users, Orbit } from 'lucide-react'

export const navigationGroups = [
  { id: 'home', label: 'Overview', icon: LayoutDashboard, description: 'Your day at a glance' },
  { id: 'customers', label: 'Customers', icon: MessageSquare, description: 'Conversations, clients & demand' },
  { id: 'operations', label: 'Operations', icon: Truck, description: 'Delivery, coverage & exceptions' },
  { id: 'supply', label: 'Supply', icon: Boxes, description: 'Products, stock & purchasing' },
  { id: 'finance', label: 'Finance', icon: Wallet, description: 'Collections, payments & payroll' },
  { id: 'people', label: 'People', icon: Users, description: 'Your team & working day' },
  { id: 'system', label: 'System', icon: Orbit, description: 'Blueprint, settings & tools' },
] as const
export type NavigationGroup = typeof navigationGroups[number]['id']

const groupForSection: Record<string, NavigationGroup> = {
  '/dashboard': 'home',
  '/dashboard/inbox': 'customers',
  '/dashboard/clients': 'customers',
  '/dashboard/ads': 'customers',
  '/dashboard/product-master': 'supply',
  '/dashboard/inventory': 'supply',
  '/dashboard/purchasing': 'supply',
  '/dashboard/deliveries': 'operations',
  '/dashboard/riders': 'operations',
  '/dashboard/contractors': 'operations',
  '/dashboard/storekeeper': 'operations',
  '/dashboard/marketing-back-office': 'operations',
  '/dashboard/marketing-front-office': 'customers',
  '/dashboard/finance': 'finance',
  '/dashboard/admin/cms': 'operations',
  '/dashboard/admin/placement': 'operations',
  '/dashboard/admin/regions': 'operations',
  '/dashboard/admin/users': 'people',
  '/dashboard/admin/team': 'people',
  '/dashboard/admin/executives': 'people',
  '/dashboard/admin/timetable': 'people',
  '/dashboard/admin/settings': 'system',
  '/dashboard/admin/blueprint': 'system',
  '/dashboard/tools': 'system',
}

export function getNavigationDestinations(role: UserRole) {
  return navItems.filter(item => item.roles.includes(role)).flatMap(item => {
    const children = item.subItems?.filter(child => !child.roles || child.roles.includes(role))
    return (children ?? [item]).map(child => ({
      href: child.href, label: child.label, icon: child.icon,
      section: item.label, group: groupForSection[item.href] ?? 'system',
    }))
  })
}
export type NavigationDestination = ReturnType<typeof getNavigationDestinations>[number]

export function findCurrentDestination(destinations: NavigationDestination[], pathname: string) {
  return destinations.filter(item => pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0]
}

export function getDefaultPins(destinations: NavigationDestination[]) {
  const preferred = ['/dashboard', '/dashboard/inbox', '/dashboard/deliveries/all', '/dashboard/product-master', '/dashboard/admin/blueprint']
  const allowed = preferred.filter(href => destinations.some(item => item.href === href))
  return allowed.length ? allowed : destinations.slice(0, 4).map(item => item.href)
}
