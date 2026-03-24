'use client'

import React from "react"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createDelivery } from '@/lib/delivery-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Loader2 } from 'lucide-react'

export function AddDeliveryDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const result = await createDelivery(formData)

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setLoading(false)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Delivery
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Delivery</DialogTitle>
          <DialogDescription>
            Enter the delivery details below
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {error && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customer_name">Customer Name *</Label>
                <Input id="customer_name" name="customer_name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact_1">Contact 1</Label>
                <Input id="contact_1" name="contact_1" type="tel" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="contact_2">Contact 2</Label>
                <Input id="contact_2" name="contact_2" type="tel" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="locality">Locality</Label>
                <Input id="locality" name="locality" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qty">Quantity</Label>
                <Input id="qty" name="qty" type="number" defaultValue={1} min={1} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (Rs)</Label>
                <Input id="amount" name="amount" type="number" step="0.01" defaultValue={0} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rider_fee">Rider Fee (Rs)</Label>
                <Input id="rider_fee" name="rider_fee" type="number" step="0.01" defaultValue={50} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="products">Products</Label>
              <Input id="products" name="products" placeholder="Product description" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="payment_method">Primary Payment Method</Label>
                <Select name="payment_method">
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="juice">Juice</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="juice_to_rider">Juice To Rider</SelectItem>
                    <SelectItem value="bank">Internet Banking</SelectItem>
                    <SelectItem value="already_paid">Already Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="payment_status">Payment Status</Label>
                <Select name="payment_status" defaultValue="unpaid">
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="already_paid">Already Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Split Payment (optional - fill if client pays via multiple methods)</Label>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="payment_juice" className="text-xs">Juice (Rs)</Label>
                  <Input id="payment_juice" name="payment_juice" type="number" step="0.01" defaultValue={0} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="payment_cash" className="text-xs">Cash (Rs)</Label>
                  <Input id="payment_cash" name="payment_cash" type="number" step="0.01" defaultValue={0} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="payment_bank" className="text-xs">Bank (Rs)</Label>
                  <Input id="payment_bank" name="payment_bank" type="number" step="0.01" defaultValue={0} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sales_type">Sales Type</Label>
                <Select name="sales_type">
                  <SelectTrigger>
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="repeat">Repeat</SelectItem>
                    <SelectItem value="referral">Referral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="entry_date">Entry Date</Label>
                <Input 
                  id="entry_date" 
                  name="entry_date" 
                  type="date" 
                  defaultValue={new Date().toISOString().split('T')[0]} 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delivery_date">Delivery Date</Label>
                <Input id="delivery_date" name="delivery_date" type="date" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rte">RTE</Label>
                <Input id="rte" name="rte" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="index_no">Index No</Label>
                <Input id="index_no" name="index_no" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="medium">Medium</Label>
              <Select name="medium">
                <SelectTrigger>
                  <SelectValue placeholder="Select source..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="website">Website</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="phone">Phone Call</SelectItem>
                  <SelectItem value="walk-in">Walk-in</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Delivery
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
