'use client'

import React, { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Database,
  Users,
  Truck,
  Package,
  Wallet,
  Building2,
  Bike,
  Settings,
  ShoppingCart,
  FileText,
  MapPin,
  Banknote,
  BarChart3,
  Globe,
  Server,
  Layers,
  Zap,
  Shield,
  GitBranch,
  Box,
  ChevronRight,
  ChevronDown,
  X,
  Maximize2,
  Minimize2,
  Search,
  Filter,
  Download,
  Eye,
  Code,
  Activity,
  Network,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface SystemStats {
  deliveries: number
  riders: number
  contractors: number
  clients: number
  products: number
  users: number
  tables: number
  pages: number
  apiRoutes: number
}

interface ModuleNode {
  id: string
  name: string
  icon: React.ElementType
  description: string
  color: string
  tables: string[]
  pages: string[]
  apiRoutes: string[]
  connections: string[]
  stats?: { label: string; value: number | string }[]
}

const systemModules: ModuleNode[] = [
  {
    id: 'delivery',
    name: 'Delivery Management',
    icon: Truck,
    description: 'Core delivery tracking, assignment, and status management',
    color: 'from-cyan-500 to-blue-600',
    tables: ['deliveries', 'delivery_imports', 'order_modifications', 'localities'],
    pages: [
      '/dashboard/deliveries',
      '/dashboard/deliveries/all',
      '/dashboard/deliveries/riders',
      '/dashboard/deliveries/contractors',
    ],
    apiRoutes: ['/api/export-deliveries', '/api/optimize-route'],
    connections: ['rider', 'contractor', 'client', 'stock', 'payment'],
  },
  {
    id: 'rider',
    name: 'Rider Operations',
    icon: Bike,
    description: 'Rider management, assignments, earnings, and stock tracking',
    color: 'from-emerald-500 to-teal-600',
    tables: ['riders', 'rider_stock', 'rider_work_days', 'rider_payment_settings', 'rider_region_defaults'],
    pages: [
      '/dashboard/riders',
      '/dashboard/riders/deliveries',
      '/dashboard/riders/map',
      '/dashboard/riders/collections',
      '/dashboard/riders/stock',
      '/dashboard/riders/earnings',
    ],
    apiRoutes: ['/api/rider-stats', '/api/work-days'],
    connections: ['delivery', 'contractor', 'stock', 'payment'],
  },
  {
    id: 'contractor',
    name: 'Contractor Hub',
    icon: Building2,
    description: 'Contractor management, partner sheets, and multi-rider operations',
    color: 'from-violet-500 to-purple-600',
    tables: [
      'contractors',
      'contractor_daily_stock',
      'contractor_payment_settings',
      'contractor_stock_validation',
      'partner_sheets',
      'partner_deliveries',
      'partner_sync_logs',
    ],
    pages: [
      '/dashboard/contractors',
      '/dashboard/contractors/riders',
      '/dashboard/contractors/deliveries',
      '/dashboard/contractors/map',
      '/dashboard/contractors/collections',
      '/dashboard/contractors/stock',
      '/dashboard/contractors/earnings',
      '/dashboard/contractors/wallet',
    ],
    apiRoutes: ['/api/contractor-stats'],
    connections: ['delivery', 'rider', 'stock', 'payment', 'wallet'],
  },
  {
    id: 'stock',
    name: 'Inventory & Stock',
    icon: Package,
    description: 'Stock movements, dispatch, returns, and inventory tracking',
    color: 'from-amber-500 to-orange-600',
    tables: [
      'products',
      'product_aliases',
      'stock_movements',
      'stock_dispatch_sessions',
      'stock_dispatch_items',
      'stock_transactions',
      'stock_transaction_items',
      'return_collections',
    ],
    pages: [
      '/dashboard/deliveries/stock',
      '/dashboard/deliveries/inventory',
      '/dashboard/storekeeper/stock-out',
      '/dashboard/storekeeper/stock-in',
    ],
    apiRoutes: [],
    connections: ['delivery', 'rider', 'contractor', 'storekeeper'],
  },
  {
    id: 'payment',
    name: 'Payments & Finance',
    icon: Wallet,
    description: 'Wallets, transactions, payouts, payroll, and deductions',
    color: 'from-green-500 to-emerald-600',
    tables: [
      'wallets',
      'payment_transactions',
      'payout_requests',
      'payslips',
      'employee_payroll_profiles',
      'deductions',
      'expenses',
    ],
    pages: [
      '/dashboard/deliveries/payments',
      '/dashboard/deliveries/payroll',
      '/dashboard/contractors/wallet',
      '/dashboard/admin/deductions',
    ],
    apiRoutes: ['/api/deductions', '/api/expenses'],
    connections: ['rider', 'contractor', 'delivery'],
  },
  {
    id: 'collection',
    name: 'Cash & Juice Collection',
    icon: Banknote,
    description: 'Cash collection sessions, juice transfers, and reconciliation',
    color: 'from-rose-500 to-pink-600',
    tables: ['cash_collections', 'cash_collection_sessions'],
    pages: [
      '/dashboard/deliveries/collections',
      '/dashboard/storekeeper/cash-collection',
      '/dashboard/storekeeper/juice-collection',
      '/dashboard/contractors/cash-collection',
      '/dashboard/contractors/juice-collection',
    ],
    apiRoutes: ['/api/cash-collections', '/api/extract-juice-transfer'],
    connections: ['delivery', 'contractor', 'storekeeper'],
  },
  {
    id: 'storekeeper',
    name: 'Store Operations',
    icon: Box,
    description: 'Warehouse management, stock dispatch, and daily operations',
    color: 'from-indigo-500 to-blue-600',
    tables: [],
    pages: [
      '/dashboard/storekeeper',
      '/dashboard/storekeeper/cash-collection',
      '/dashboard/storekeeper/stock-out',
      '/dashboard/storekeeper/stock-in',
      '/dashboard/storekeeper/history',
      '/dashboard/storekeeper/daily-summary',
    ],
    apiRoutes: [],
    connections: ['stock', 'collection', 'contractor'],
  },
  {
    id: 'client',
    name: 'Client Database',
    icon: Users,
    description: 'Customer management, import history, and contact tracking',
    color: 'from-sky-500 to-cyan-600',
    tables: ['clients', 'clients_import_log'],
    pages: ['/dashboard/clients'],
    apiRoutes: [],
    connections: ['delivery'],
  },
  {
    id: 'admin',
    name: 'Admin & Settings',
    icon: Settings,
    description: 'User management, company settings, regions, and system config',
    color: 'from-slate-500 to-gray-600',
    tables: [
      'profiles',
      'company_settings',
      'address_region_mappings',
      'import_mappings',
      'notifications',
      'letter_requests',
    ],
    pages: [
      '/dashboard/admin/users',
      '/dashboard/admin/team',
      '/dashboard/admin/regions',
      '/dashboard/admin/settings',
    ],
    apiRoutes: ['/api/notifications', '/api/scan-nic', '/api/upload'],
    connections: ['rider', 'contractor', 'delivery'],
  },
  {
    id: 'purchase',
    name: 'Purchase Orders',
    icon: ShoppingCart,
    description: 'Supplier orders, import tracking, and procurement',
    color: 'from-fuchsia-500 to-pink-600',
    tables: ['purchase_orders'],
    pages: ['/dashboard/deliveries/purchase-orders'],
    apiRoutes: [],
    connections: ['stock', 'admin'],
  },
]

const databaseTables = [
  { name: 'deliveries', records: '50K+', category: 'Core' },
  { name: 'riders', records: '50+', category: 'Users' },
  { name: 'contractors', records: '10+', category: 'Users' },
  { name: 'clients', records: '20K+', category: 'CRM' },
  { name: 'products', records: '500+', category: 'Inventory' },
  { name: 'profiles', records: '100+', category: 'Auth' },
  { name: 'wallets', records: '100+', category: 'Finance' },
  { name: 'payment_transactions', records: '10K+', category: 'Finance' },
  { name: 'cash_collections', records: '5K+', category: 'Collections' },
  { name: 'stock_movements', records: '20K+', category: 'Inventory' },
  { name: 'payslips', records: '1K+', category: 'Payroll' },
  { name: 'partner_deliveries', records: '10K+', category: 'Partners' },
]

const userRoles = [
  { role: 'Admin', description: 'Full system access', color: 'bg-red-500', permissions: 'All modules' },
  { role: 'Manager', description: 'Operational oversight', color: 'bg-orange-500', permissions: 'Deliveries, Team, Reports' },
  { role: 'Contractor', description: 'Multi-rider management', color: 'bg-violet-500', permissions: 'Riders, Deliveries, Stock, Wallet' },
  { role: 'Rider', description: 'Delivery execution', color: 'bg-emerald-500', permissions: 'My Deliveries, Stock, Earnings' },
  { role: 'Storekeeper', description: 'Warehouse operations', color: 'bg-blue-500', permissions: 'Stock, Collections, Dispatch' },
  { role: 'Marketing Agent', description: 'Client management', color: 'bg-pink-500', permissions: 'Clients, Deliveries' },
]

export function SystemBlueprintPage({ stats }: { stats: SystemStats }) {
  const [selectedModule, setSelectedModule] = useState<ModuleNode | null>(null)
  const [viewMode, setViewMode] = useState<'overview' | 'database' | 'roles' | 'api'>('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filteredModules = systemModules.filter(
    (m) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div
      ref={containerRef}
      className={cn(
        'min-h-screen bg-[#0a0a0f] text-white overflow-hidden',
        isFullscreen && 'fixed inset-0 z-50'
      )}
    >
      {/* Animated Background Grid */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/10 via-transparent to-purple-900/10" />
        
        {/* Animated pulse circles */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                  <Network className="w-6 h-6 text-white" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-[#0a0a0f] animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                  System Architecture Blueprint
                </h1>
                <p className="text-sm text-white/40">AKMEZ Delivery Management Platform</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="text"
                  placeholder="Search modules..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-64 pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50 focus:bg-white/10 transition-all"
                />
              </div>

              {/* View Mode Tabs */}
              <div className="flex bg-white/5 rounded-lg p-1 border border-white/10">
                {(['overview', 'database', 'roles', 'api'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      'px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize',
                      viewMode === mode
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg'
                        : 'text-white/50 hover:text-white'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {/* Fullscreen Toggle */}
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4 text-white/60" />
                ) : (
                  <Maximize2 className="w-4 h-4 text-white/60" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Live Stats Bar */}
      <div className="relative z-10 border-b border-white/5 bg-black/20 backdrop-blur-sm">
        <div className="max-w-[1800px] mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <StatBadge icon={Database} label="Tables" value={stats.tables} color="cyan" />
              <StatBadge icon={Layers} label="Pages" value={stats.pages} color="violet" />
              <StatBadge icon={Zap} label="API Routes" value={stats.apiRoutes} color="amber" />
              <StatBadge icon={Users} label="Users" value={stats.users} color="emerald" />
              <StatBadge icon={Truck} label="Deliveries" value={stats.deliveries.toLocaleString()} color="blue" />
            </div>
            <div className="flex items-center gap-2 text-xs text-white/40">
              <Activity className="w-3 h-3 text-emerald-500 animate-pulse" />
              <span>System Online</span>
              <span className="text-white/20">|</span>
              <span>Last updated: Just now</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="relative z-10 max-w-[1800px] mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {viewMode === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Module Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredModules.map((module, index) => (
                  <ModuleCard
                    key={module.id}
                    module={module}
                    index={index}
                    isSelected={selectedModule?.id === module.id}
                    onClick={() => setSelectedModule(selectedModule?.id === module.id ? null : module)}
                  />
                ))}
              </div>

              {/* Module Detail Panel */}
              <AnimatePresence>
                {selectedModule && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-6 overflow-hidden"
                  >
                    <ModuleDetailPanel module={selectedModule} onClose={() => setSelectedModule(null)} />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Data Flow Visualization */}
              <div className="mt-8">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <GitBranch className="w-5 h-5 text-cyan-500" />
                  Data Flow Architecture
                </h2>
                <DataFlowDiagram modules={systemModules} />
              </div>
            </motion.div>
          )}

          {viewMode === 'database' && (
            <motion.div
              key="database"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <DatabaseView />
            </motion.div>
          )}

          {viewMode === 'roles' && (
            <motion.div
              key="roles"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <RolesView roles={userRoles} />
            </motion.div>
          )}

          {viewMode === 'api' && (
            <motion.div
              key="api"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <APIView modules={systemModules} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}

function StatBadge({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  color: string
}) {
  const colorClasses: Record<string, string> = {
    cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  }

  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border', colorClasses[color])}>
      <Icon className="w-4 h-4" />
      <span className="text-xs text-white/50">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </div>
  )
}

function ModuleCard({
  module,
  index,
  isSelected,
  onClick,
}: {
  module: ModuleNode
  index: number
  isSelected: boolean
  onClick: () => void
}) {
  const Icon = module.icon

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={onClick}
      className={cn(
        'relative group text-left p-5 rounded-xl border transition-all duration-300',
        isSelected
          ? 'bg-white/10 border-cyan-500/50 shadow-lg shadow-cyan-500/10'
          : 'bg-white/[0.02] border-white/10 hover:bg-white/5 hover:border-white/20'
      )}
    >
      {/* Gradient Overlay */}
      <div
        className={cn(
          'absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br',
          module.color
        )}
        style={{ opacity: isSelected ? 0.1 : undefined }}
      />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-3">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br',
              module.color
            )}
          >
            <Icon className="w-5 h-5 text-white" />
          </div>
          <ChevronRight
            className={cn(
              'w-4 h-4 text-white/30 transition-transform',
              isSelected && 'rotate-90 text-cyan-400'
            )}
          />
        </div>

        <h3 className="font-semibold text-white mb-1">{module.name}</h3>
        <p className="text-xs text-white/40 line-clamp-2 mb-3">{module.description}</p>

        <div className="flex items-center gap-3 text-[10px] text-white/30">
          <span className="flex items-center gap-1">
            <Database className="w-3 h-3" />
            {module.tables.length} tables
          </span>
          <span className="flex items-center gap-1">
            <Layers className="w-3 h-3" />
            {module.pages.length} pages
          </span>
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {module.apiRoutes.length} APIs
          </span>
        </div>
      </div>

      {/* Connection Indicator */}
      <div className="absolute -bottom-px left-1/2 -translate-x-1/2 w-12 h-1 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    </motion.button>
  )
}

function ModuleDetailPanel({ module, onClose }: { module: ModuleNode; onClose: () => void }) {
  const Icon = module.icon

  return (
    <div className="bg-white/[0.02] border border-white/10 rounded-xl p-6">
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div
            className={cn('w-14 h-14 rounded-xl flex items-center justify-center bg-gradient-to-br', module.color)}
          >
            <Icon className="w-7 h-7 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{module.name}</h2>
            <p className="text-sm text-white/50">{module.description}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-white/50" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Tables */}
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-500" />
            Database Tables ({module.tables.length})
          </h3>
          <div className="space-y-2">
            {module.tables.map((table) => (
              <div
                key={table}
                className="px-3 py-2 bg-cyan-500/5 border border-cyan-500/20 rounded-lg text-sm text-cyan-300 font-mono"
              >
                {table}
              </div>
            ))}
            {module.tables.length === 0 && (
              <p className="text-xs text-white/30 italic">No direct tables</p>
            )}
          </div>
        </div>

        {/* Pages */}
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-violet-500" />
            Pages ({module.pages.length})
          </h3>
          <div className="space-y-2">
            {module.pages.map((page) => (
              <div
                key={page}
                className="px-3 py-2 bg-violet-500/5 border border-violet-500/20 rounded-lg text-sm text-violet-300 font-mono text-xs"
              >
                {page}
              </div>
            ))}
          </div>
        </div>

        {/* Connections */}
        <div>
          <h3 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-emerald-500" />
            Connections ({module.connections.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {module.connections.map((conn) => {
              const connModule = systemModules.find((m) => m.id === conn)
              if (!connModule) return null
              const ConnIcon = connModule.icon
              return (
                <div
                  key={conn}
                  className="flex items-center gap-2 px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg"
                >
                  <ConnIcon className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-300">{connModule.name}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function DataFlowDiagram({ modules }: { modules: ModuleNode[] }) {
  return (
    <div className="relative bg-white/[0.02] border border-white/10 rounded-xl p-8 overflow-hidden">
      {/* Central Hub */}
      <div className="flex items-center justify-center mb-8">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-cyan-500/30">
            <Server className="w-10 h-10 text-white" />
          </div>
          <div className="absolute -inset-4 rounded-full border-2 border-dashed border-cyan-500/30 animate-spin-slow" />
          <div className="absolute -inset-8 rounded-full border border-cyan-500/10" />
        </div>
      </div>

      {/* Module Ring */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {modules.slice(0, 10).map((module, index) => {
          const Icon = module.icon
          return (
            <motion.div
              key={module.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
              className="relative flex flex-col items-center p-4 bg-white/[0.02] border border-white/10 rounded-xl hover:border-white/20 transition-all group"
            >
              <div
                className={cn(
                  'w-12 h-12 rounded-lg flex items-center justify-center bg-gradient-to-br mb-3',
                  module.color
                )}
              >
                <Icon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xs font-medium text-white/70 text-center">{module.name}</span>
              
              {/* Connection Line */}
              <div className="absolute -top-4 left-1/2 w-px h-4 bg-gradient-to-b from-cyan-500/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </motion.div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-8 flex items-center justify-center gap-8 text-xs text-white/40">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-cyan-500" />
          <span>Data Flow</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-violet-500" />
          <span>API Calls</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500" />
          <span>Events</span>
        </div>
      </div>
    </div>
  )
}

function DatabaseView() {
  const tableGroups = {
    Core: ['deliveries', 'delivery_imports', 'order_modifications'],
    Users: ['profiles', 'riders', 'contractors', 'clients'],
    Finance: ['wallets', 'payment_transactions', 'payout_requests', 'payslips', 'deductions', 'expenses'],
    Inventory: ['products', 'product_aliases', 'stock_movements', 'stock_dispatch_sessions', 'stock_dispatch_items'],
    Collections: ['cash_collections', 'cash_collection_sessions'],
    Partners: ['partner_sheets', 'partner_deliveries', 'partner_sync_logs'],
    Settings: ['company_settings', 'localities', 'address_region_mappings', 'import_mappings'],
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Database className="w-6 h-6 text-cyan-500" />
          Database Schema
        </h2>
        <span className="text-sm text-white/40">45 Tables | PostgreSQL (Supabase)</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Object.entries(tableGroups).map(([group, tables]) => (
          <div
            key={group}
            className="bg-white/[0.02] border border-white/10 rounded-xl p-4"
          >
            <h3 className="text-sm font-semibold text-cyan-400 mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4" />
              {group}
              <span className="text-white/30 font-normal">({tables.length})</span>
            </h3>
            <div className="space-y-1.5">
              {tables.map((table) => (
                <div
                  key={table}
                  className="px-3 py-1.5 bg-white/5 rounded text-xs font-mono text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                >
                  {table}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* RLS Indicator */}
      <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
        <Shield className="w-5 h-5 text-emerald-400" />
        <div>
          <p className="text-sm font-medium text-emerald-300">Row Level Security Enabled</p>
          <p className="text-xs text-emerald-300/60">All tables protected with RLS policies based on user roles</p>
        </div>
      </div>
    </div>
  )
}

function RolesView({ roles }: { roles: typeof userRoles }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Users className="w-6 h-6 text-violet-500" />
          User Roles & Permissions
        </h2>
        <span className="text-sm text-white/40">6 Roles | RBAC System</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {roles.map((role, index) => (
          <motion.div
            key={role.role}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="relative bg-white/[0.02] border border-white/10 rounded-xl p-5 hover:border-white/20 transition-all"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={cn('w-3 h-3 rounded-full', role.color)} />
              <h3 className="font-semibold text-white">{role.role}</h3>
            </div>
            <p className="text-sm text-white/50 mb-4">{role.description}</p>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">Permissions</p>
              <p className="text-xs text-white/70">{role.permissions}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Access Matrix */}
      <div className="bg-white/[0.02] border border-white/10 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-white mb-4">Module Access Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/40">
                <th className="text-left py-2 px-3">Module</th>
                <th className="text-center py-2 px-3">Admin</th>
                <th className="text-center py-2 px-3">Manager</th>
                <th className="text-center py-2 px-3">Contractor</th>
                <th className="text-center py-2 px-3">Rider</th>
                <th className="text-center py-2 px-3">Storekeeper</th>
                <th className="text-center py-2 px-3">Marketing</th>
              </tr>
            </thead>
            <tbody className="text-white/70">
              {['Deliveries', 'Riders', 'Stock', 'Payments', 'Collections', 'Settings'].map((module) => (
                <tr key={module} className="border-t border-white/5">
                  <td className="py-2 px-3 font-medium">{module}</td>
                  <td className="text-center py-2 px-3"><span className="text-emerald-400">Full</span></td>
                  <td className="text-center py-2 px-3"><span className="text-emerald-400">Full</span></td>
                  <td className="text-center py-2 px-3"><span className="text-amber-400">Limited</span></td>
                  <td className="text-center py-2 px-3"><span className="text-amber-400">Own</span></td>
                  <td className="text-center py-2 px-3">{module === 'Stock' || module === 'Collections' ? <span className="text-emerald-400">Full</span> : <span className="text-white/20">-</span>}</td>
                  <td className="text-center py-2 px-3">{module === 'Deliveries' ? <span className="text-amber-400">View</span> : <span className="text-white/20">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function APIView({ modules }: { modules: ModuleNode[] }) {
  const allApiRoutes = modules.flatMap((m) =>
    m.apiRoutes.map((route) => ({ route, module: m.name, color: m.color }))
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Code className="w-6 h-6 text-amber-500" />
          API Routes
        </h2>
        <span className="text-sm text-white/40">16 Routes | Next.js API</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allApiRoutes.map(({ route, module, color }, index) => (
          <motion.div
            key={route}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="flex items-center gap-4 p-4 bg-white/[0.02] border border-white/10 rounded-xl hover:border-white/20 transition-all"
          >
            <div className={cn('w-2 h-10 rounded-full bg-gradient-to-b', color)} />
            <div className="flex-1">
              <p className="font-mono text-sm text-amber-300">{route}</p>
              <p className="text-xs text-white/40">{module}</p>
            </div>
            <div className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded text-[10px] text-emerald-400 font-medium">
              POST
            </div>
          </motion.div>
        ))}
      </div>

      {/* API Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Routes', value: '16', icon: Globe },
          { label: 'Server Actions', value: '50+', icon: Zap },
          { label: 'Auth Protected', value: '100%', icon: Shield },
          { label: 'Rate Limited', value: 'Yes', icon: Activity },
        ].map((stat) => (
          <div
            key={stat.label}
            className="p-4 bg-white/[0.02] border border-white/10 rounded-xl text-center"
          >
            <stat.icon className="w-5 h-5 text-amber-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-white/40">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
