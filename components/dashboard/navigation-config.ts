import type React from 'react'
import type { UserRole } from '@/lib/types'
import { Wallet } from 'lucide-react'
import {
  Package,
  ClipboardList,
  LayoutDashboard,
  Truck,
  Users,
  UserCog,
  Database,
  Bike,
  Building2,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Banknote,
  BoxesIcon,
  ShoppingCart,
  MessageSquare,
  TrendingDown,
  FileText,
  MapPin,
  Map,
  Settings,
  Download,
  Network,
  TrendingUp,
  X,
  Menu,
  LogOut,
  User,
  AlertTriangle,
  CalendarDays,
  CalendarClock,
  Megaphone,
} from 'lucide-react'

interface SubNavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /**
   * Optional per-sub-item gate. Sub-items otherwise inherit the parent's roles,
   * which is too coarse for Overview: its parent is open to riders and
   * contractors, but they never type orders so Entry Activity would be an empty
   * screen for them.
   */
  roles?: UserRole[]
}

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
  subItems?: SubNavItem[]
  color?: string
}

export const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Overview',
    icon: LayoutDashboard,
    roles: ['admin', 'manager', 'marketing_agent', 'contractor', 'rider'],
    color: '#f97316',
    /*
     * A parent WITH sub-items renders as an expand button instead of a link, so
     * it stops navigating. "Dashboard" is therefore listed as the first
     * sub-item - the same pattern Deliveries already uses - or clicking
     * Overview would no longer reach /dashboard at all.
     */
    subItems: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      {
        href: '/dashboard/activity',
        label: 'Entry Activity',
        icon: CalendarClock,
        roles: ['admin', 'manager', 'marketing_agent'],
      },
    ],
  },
  {
    href: '/dashboard/inbox',
    label: 'Inbox',
    icon: MessageSquare,
    roles: ['admin', 'manager'],
    color: '#3b82f6',
  },
  {
    href: '/dashboard/product-master',
    label: 'Product Master',
    icon: Package,
    roles: ['admin', 'manager'],
    color: '#eab308',
  },
  {
    href: '/dashboard/deliveries',
    label: 'Deliveries',
    icon: Truck,
    roles: ['admin', 'manager'],
    color: '#06b6d4',
    subItems: [
      { href: '/dashboard/deliveries', label: 'Dashboard', icon: BarChart3 },
      { href: '/dashboard/deliveries/all', label: 'All Deliveries', icon: Truck },
      { href: '/dashboard/deliveries/riders', label: 'Riders', icon: Bike },
      { href: '/dashboard/deliveries/contractors', label: 'Contractors', icon: Building2 },
    ],
  },
  {
    href: '/dashboard/finance',
    label: 'Finance',
    icon: Banknote,
    roles: ['admin', 'manager'],
    color: '#10b981',
    subItems: [
      { href: '/dashboard/deliveries/collections', label: 'Collections', icon: Banknote },
      { href: '/dashboard/deliveries/payments', label: 'Payments', icon: Wallet },
      { href: '/dashboard/deliveries/payroll', label: 'Payroll', icon: FileText },
      { href: '/dashboard/admin/deductions', label: 'Deductions', icon: TrendingDown },
    ],
  },
  {
    href: '/dashboard/inventory',
    label: 'Inventory',
    icon: BoxesIcon,
    roles: ['admin', 'manager'],
    color: '#8b5cf6',
    subItems: [
      { href: '/dashboard/deliveries/inventory', label: 'Products', icon: BoxesIcon },
      { href: '/dashboard/deliveries/stock', label: 'Stock In/Out', icon: Package },
      { href: '/dashboard/deliveries/stock-counts', label: 'Stock Counts', icon: ClipboardList },
    ],
  },
  {
    href: '/dashboard/purchasing',
    label: 'Purchasing',
    icon: ShoppingCart,
    roles: ['admin', 'manager'],
    color: '#14b8a6',
    subItems: [
      { href: '/dashboard/purchasing', label: 'Imports', icon: ShoppingCart },
      // China suppliers belong with Imports: they are who the imports come from.
      { href: '/dashboard/purchasing/suppliers', label: 'Foreign Suppliers', icon: Building2 },
      { href: '/dashboard/purchasing/reorders', label: 'Reorders', icon: ClipboardList },
      // Local (Mauritius) buying sits under Purchasing rather than in its own
      // section: it is the same decision as importing, seen from the other side.
      { href: '/dashboard/purchasing/local', label: 'Local Purchases', icon: FileText },
    ],
  },
  {
    href: '/dashboard/clients',
    label: 'Clients',
    icon: Database,
    roles: ['admin', 'manager', 'marketing_agent'],
    color: '#ec4899',
  },
  {
    href: '/dashboard/ads',
    label: 'Ads Manager',
    icon: Megaphone,
    roles: ['admin', 'manager'],
    color: '#3b82f6',
  },
  {
    href: '/dashboard/riders',
    label: 'My Dashboard',
    icon: Bike,
    roles: ['rider'],
    color: '#06b6d4',
    subItems: [
      { href: '/dashboard/riders', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/riders/deliveries', label: 'My Deliveries', icon: Truck },
      { href: '/dashboard/riders/map', label: 'Map', icon: Map },
      { href: '/dashboard/riders/collections', label: 'Collections', icon: Banknote },
      { href: '/dashboard/riders/stock', label: 'My Stock', icon: Package },
      { href: '/dashboard/riders/earnings', label: 'My Earnings', icon: Wallet },
    ],
  },
  {
    href: '/dashboard/contractors',
    label: 'My Dashboard',
    icon: Building2,
    roles: ['contractor'],
    color: '#f97316',
    subItems: [
      { href: '/dashboard/contractors', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/contractors/riders', label: 'My Riders', icon: Users },
      { href: '/dashboard/contractors/deliveries', label: 'Deliveries', icon: Truck },
      { href: '/dashboard/contractors/map', label: 'Map', icon: Map },
      { href: '/dashboard/contractors/collections', label: 'Collections', icon: Banknote },
      { href: '/dashboard/contractors/stock', label: 'Stock', icon: Package },
      { href: '/dashboard/contractors/earnings', label: 'Earnings', icon: TrendingUp },
      { href: '/dashboard/contractors/accounting', label: 'Accounting', icon: FileText },
      { href: '/dashboard/contractors/wallet', label: 'Wallet', icon: Wallet },
    ],
  },
  {
    href: '/dashboard/storekeeper',
    label: 'Store Ops',
    icon: BoxesIcon,
    roles: ['storekeeper'],
    color: '#10b981',
    subItems: [
      { href: '/dashboard/storekeeper', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/storekeeper/cash-collection', label: 'Cash Collection', icon: Banknote },
      { href: '/dashboard/storekeeper/stock-out', label: 'Stock Out', icon: Package },
      { href: '/dashboard/storekeeper/stock-in', label: 'Stock In', icon: BoxesIcon },
      { href: '/dashboard/storekeeper/history', label: 'History', icon: FileText },
    ],
  },
  {
    href: '/dashboard/marketing-back-office',
    label: 'Back Office',
    icon: BarChart3,
    roles: ['marketing_back_office'],
    color: '#8b5cf6',
    subItems: [
      { href: '/dashboard/marketing-back-office', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/marketing-back-office/stock', label: 'Stock', icon: BoxesIcon },
      { href: '/dashboard/marketing-back-office/sales', label: 'Sales Report', icon: TrendingUp },
      { href: '/dashboard/marketing-back-office/orders', label: 'Create Order', icon: ShoppingCart },
      { href: '/dashboard/marketing-back-office/deliveries', label: 'Deliveries', icon: Truck },
      { href: '/dashboard/marketing-back-office/clients', label: 'Clients', icon: Database },
    ],
  },
  {
    href: '/dashboard/marketing-front-office',
    label: 'Front Office',
    icon: Users,
    roles: ['marketing_front_office'],
    color: '#ec4899',
    subItems: [
      { href: '/dashboard/marketing-front-office', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/marketing-front-office/orders', label: 'New Order', icon: ShoppingCart },
      { href: '/dashboard/marketing-front-office/clients', label: 'Clients', icon: Database },
      { href: '/dashboard/marketing-front-office/follow-up', label: 'Follow Up', icon: FileText },
    ],
  },
  {
    href: '/dashboard/admin/users',
    label: 'Users',
    icon: UserCog,
    roles: ['admin'],
    color: '#f59e0b',
  },
  {
    href: '/dashboard/admin/team',
    label: 'Team',
    icon: Users,
    roles: ['admin', 'manager'],
    color: '#6366f1',
  },
  {
    href: '/dashboard/admin/executives',
    label: 'Staff / Executives',
    icon: UserCog,
    roles: ['admin', 'manager'],
    color: '#8b5cf6',
  },
  {
    href: '/dashboard/admin/timetable',
    label: 'Staff Timetable',
    icon: CalendarDays,
    roles: ['admin', 'manager'],
    color: '#06b6d4',
  },
  {
    href: '/dashboard/admin/cms',
    label: 'CMS Review',
    icon: AlertTriangle,
    roles: ['admin', 'manager'],
    color: '#f59e0b',
  },
  {
    href: '/dashboard/admin/placement',
    label: 'Day Placement',
    icon: CalendarClock,
    roles: ['admin', 'manager'],
    color: '#f59e0b',
  },
  {
    href: '/dashboard/admin/regions',
    label: 'Regions',
    icon: MapPin,
    roles: ['admin', 'manager'],
    color: '#ef4444',
  },
  {
    href: '/dashboard/admin/settings',
    label: 'Settings',
    icon: Settings,
    roles: ['admin'],
    color: '#64748b',
  },
  {
    href: '/dashboard/admin/blueprint',
    label: 'Blueprint',
    icon: Network,
    roles: ['admin'],
    color: '#0ea5e9',
  },
  {
    href: '/dashboard/tools',
    label: 'Tools',
    icon: Download,
    roles: ['admin', 'manager', 'marketing_agent', 'marketing_back_office', 'marketing_front_office'],
    color: '#8b5cf6',
  },
]

