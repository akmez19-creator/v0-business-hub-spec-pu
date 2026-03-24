'use client'

import { forwardRef } from 'react'
import { format } from 'date-fns'

interface ReceiptTemplateProps {
  receipt: {
    receipt_number: string
    from_party_name: string
    to_party_name: string
    from_party_type: string
    to_party_type: string
    transaction_type: string
    amount: number
    description?: string
    issued_at: string
  }
  company?: {
    company_name?: string
    company_address?: string
    brn?: string
    phone?: string
    email?: string
    logo_url?: string
    stamp_url?: string
  } | null
}

export const ReceiptTemplate = forwardRef<HTMLDivElement, ReceiptTemplateProps>(
  ({ receipt, company }, ref) => {
    const transactionTypeLabels: Record<string, string> = {
      payment: 'Payment',
      deduction: 'Deduction',
      collection: 'Cash Collection',
      stock_return: 'Stock Return'
    }

    return (
      <div 
        ref={ref}
        className="bg-white text-black p-8 w-[400px] font-sans"
        style={{ fontFamily: 'Arial, sans-serif' }}
      >
        {/* Header */}
        <div className="text-center border-b-2 border-black pb-4 mb-4">
          {company?.logo_url && (
            <img 
              src={company.logo_url} 
              alt="Company Logo" 
              className="h-12 mx-auto mb-2"
            />
          )}
          <h1 className="text-xl font-bold uppercase">
            {company?.company_name || 'COMPANY NAME'}
          </h1>
          {company?.company_address && (
            <p className="text-sm text-gray-600">{company.company_address}</p>
          )}
          {company?.brn && (
            <p className="text-xs text-gray-500">BRN: {company.brn}</p>
          )}
        </div>

        {/* Receipt Title */}
        <div className="text-center mb-6">
          <h2 className="text-lg font-bold border border-black inline-block px-6 py-1">
            RECEIPT
          </h2>
        </div>

        {/* Receipt Details */}
        <div className="space-y-3 mb-6">
          <div className="flex justify-between">
            <span className="font-semibold">Receipt No:</span>
            <span>{receipt.receipt_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">Date:</span>
            <span>{format(new Date(receipt.issued_at), 'dd MMM yyyy, HH:mm')}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-semibold">Type:</span>
            <span>{transactionTypeLabels[receipt.transaction_type] || receipt.transaction_type}</span>
          </div>
        </div>

        {/* Parties */}
        <div className="border-t border-b border-gray-300 py-4 mb-4 space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600">From:</span>
            <span className="font-medium">{receipt.from_party_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">To:</span>
            <span className="font-medium">{receipt.to_party_name}</span>
          </div>
        </div>

        {/* Amount */}
        <div className="bg-gray-100 p-4 rounded mb-4">
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold">Amount:</span>
            <span className="text-2xl font-bold">
              Rs {receipt.amount.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Description */}
        {receipt.description && (
          <div className="mb-6">
            <p className="text-sm text-gray-600">
              <span className="font-semibold">Description:</span> {receipt.description}
            </p>
          </div>
        )}

        {/* Stamp */}
        <div className="flex justify-between items-end mt-8">
          <div className="text-center">
            <div className="border-t border-black w-32 pt-1">
              <span className="text-xs">Signature</span>
            </div>
          </div>
          {company?.stamp_url && (
            <img 
              src={company.stamp_url} 
              alt="Official Stamp" 
              className="h-20 opacity-80"
            />
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6 pt-4 border-t border-gray-200">
          <p className="text-xs text-gray-500">
            This is a computer-generated receipt.
          </p>
          {company?.phone && (
            <p className="text-xs text-gray-500">
              Tel: {company.phone} {company?.email && `| Email: ${company.email}`}
            </p>
          )}
        </div>
      </div>
    )
  }
)

ReceiptTemplate.displayName = 'ReceiptTemplate'
