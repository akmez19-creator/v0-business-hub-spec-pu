'use client'

import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { QuickOrderPanel } from './quick-order-panel'

interface Product {
  id: string
  name: string
  price: string
}

interface Props {
  userId: string
  products: Product[]
  regions: string[]
  onOrderCreated?: () => void
}

export function QuickOrderFab({ userId, products, regions, onOrderCreated }: Props) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
        title="Quick Order"
      >
        <ShoppingCart className="w-6 h-6" />
      </button>

      {/* Quick Order Panel */}
      <QuickOrderPanel
        userId={userId}
        products={products}
        regions={regions}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSuccess={() => {
          onOrderCreated?.()
        }}
      />
    </>
  )
}
