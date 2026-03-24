'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ── Set Contractor Pay Type (admin only) ──
export async function setContractorPayType(
  contractorId: string,
  payType: 'per_delivery' | 'fixed_monthly',
  monthlySalary?: number
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  const updateData: any = {
    pay_type: payType,
    updated_at: new Date().toISOString(),
  }
  if (payType === 'fixed_monthly' && monthlySalary !== undefined) {
    updateData.monthly_salary = monthlySalary
  }
  if (payType === 'per_delivery') {
    updateData.monthly_salary = 0
  }

  const { error } = await supabase
    .from('contractors')
    .update(updateData)
    .eq('id', contractorId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/deliveries/payments')
  revalidatePath('/dashboard/contractors/earnings')
  return { success: true }
}

// ── Set Contractor Rate (admin only) ──
export async function setContractorRate(contractorId: string, ratePerDelivery: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  const { error } = await supabase
    .from('contractors')
    .update({
      rate_per_delivery: ratePerDelivery,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contractorId)

  if (error) return { error: error.message }
  revalidatePath('/dashboard/admin/team')
  return { success: true }
}

// ── Record Admin -> Contractor Payout ──
export async function recordContractorPayout(contractorId: string, amount: number, description?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify admin
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  if (amount <= 0) return { error: 'Amount must be positive' }

  // Get or create contractor wallet
  let { data: wallet } = await supabase
    .from('wallets')
    .select('*')
    .eq('owner_type', 'contractor')
    .eq('owner_id', contractorId)
    .single()

  if (!wallet) {
    const { data: newWallet, error: walletError } = await supabase
      .from('wallets')
      .insert({
        owner_type: 'contractor',
        owner_id: contractorId,
        balance: 0,
        total_earned: 0,
        total_paid_out: 0,
      })
      .select()
      .single()
    if (walletError) return { error: walletError.message }
    wallet = newWallet
  }

  // Record transaction
  const { error: txError } = await supabase
    .from('payment_transactions')
    .insert({
      wallet_id: wallet.id,
      transaction_type: 'payout',
      amount,
      description: description || `Payout from admin`,
      recipient_id: contractorId,
      recipient_type: 'contractor',
      payer_type: 'admin',
      payer_id: user.id,
      status: 'completed',
      processed_by: user.id,
      reference_date: new Date().toISOString().split('T')[0],
    })

  if (txError) return { error: txError.message }

  // Update wallet - credit balance + total_earned
  await supabase
    .from('wallets')
    .update({
      balance: (wallet.balance || 0) + amount,
      total_earned: (wallet.total_earned || 0) + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', wallet.id)

  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/contractors/earnings')
  return { success: true }
}

// ── Set Rider Rate (contractor) ──
export async function setRiderRate(riderId: string, ratePerDelivery: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Use admin client to bypass RLS (contractors don't have write access to rider_payment_settings)
  const adminDb = createAdminClient()
  const { error } = await adminDb
    .from('rider_payment_settings')
    .upsert({
      rider_id: riderId,
      per_delivery_rate: ratePerDelivery,
      payment_type: 'per_delivery',
      effective_from: new Date().toISOString().split('T')[0],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'rider_id' })

  if (error) return { error: error.message }
  revalidatePath('/dashboard/contractors/riders')
  revalidatePath('/dashboard/contractors/earnings')
  revalidatePath('/dashboard/riders/earnings')
  return { success: true }
}

// ── Record Contractor -> Rider Payout ──
export async function recordRiderPayout(riderId: string, amount: number, description?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  if (amount <= 0) return { error: 'Amount must be positive' }

  const adminDb = createAdminClient()

  // Get contractor id
  const { data: profile } = await supabase
    .from('profiles')
    .select('contractor_id')
    .eq('id', user.id)
    .single()

  let contractorId = profile?.contractor_id
  if (!contractorId) {
    const { data: c } = await supabase
      .from('contractors')
      .select('id')
      .eq('profile_id', user.id)
      .single()
    contractorId = c?.id
  }

  // Get or create rider wallet
  let { data: wallet } = await supabase
    .from('wallets')
    .select('*')
    .eq('owner_type', 'rider')
    .eq('owner_id', riderId)
    .single()

  if (!wallet) {
    const { data: newWallet, error: walletError } = await adminDb
      .from('wallets')
      .insert({
        owner_type: 'rider',
        owner_id: riderId,
        balance: 0,
        total_earned: 0,
        total_paid_out: 0,
      })
      .select()
      .single()
    if (walletError) return { error: walletError.message }
    wallet = newWallet
  }

  // Record transaction on rider wallet
  const { error: txError } = await adminDb
    .from('payment_transactions')
    .insert({
      wallet_id: wallet.id,
      transaction_type: 'payout',
      amount,
      description: description || `Payout from contractor`,
      recipient_id: riderId,
      recipient_type: 'rider',
      payer_type: 'contractor',
      payer_id: contractorId,
      status: 'completed',
      processed_by: user.id,
      reference_date: new Date().toISOString().split('T')[0],
    })

  if (txError) return { error: txError.message }

  // Credit rider wallet
  await adminDb
    .from('wallets')
    .update({
      balance: (wallet.balance || 0) + amount,
      total_earned: (wallet.total_earned || 0) + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', wallet.id)

  // Deduct from contractor wallet
  if (contractorId) {
    const { data: cWallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('owner_type', 'contractor')
      .eq('owner_id', contractorId)
      .single()

    if (cWallet) {
      await adminDb
        .from('wallets')
        .update({
          balance: (cWallet.balance || 0) - amount,
          total_paid_out: (cWallet.total_paid_out || 0) + amount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cWallet.id)
    }
  }

  revalidatePath('/dashboard/contractors/riders')
  revalidatePath('/dashboard/contractors/earnings')
  revalidatePath('/dashboard/riders/earnings')
  return { success: true }
}

// ── Request Withdrawal (contractor or rider) ──
// Rider -> notifies their contractor; Contractor -> notifies admin
export async function requestWithdrawal(
  requesterType: 'contractor' | 'rider',
  requesterId: string,
  amount: number,
  paymentMethod: string,
  paymentDetails: Record<string, string>,
  notes?: string
) {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  if (amount <= 0) return { error: 'Amount must be positive' }

  // Find or create wallet for the requester (wallet is just a reference for payout_requests)
  let walletId: string | null = null
  const { data: existingWallet } = await adminDb
    .from('wallets')
    .select('id')
    .eq('owner_type', requesterType)
    .eq('owner_id', requesterId)
    .single()

  if (existingWallet) {
    walletId = existingWallet.id
  } else {
    const { data: newWallet } = await adminDb
      .from('wallets')
      .insert({ owner_type: requesterType, owner_id: requesterId, balance: 0 })
      .select('id')
      .single()
    walletId = newWallet?.id || null
  }

  const { error } = await adminDb
    .from('payout_requests')
    .insert({
      wallet_id: walletId,
      requester_type: requesterType,
      requester_id: requesterId,
      amount,
      payment_method: paymentMethod,
      payment_details: paymentDetails,
      status: 'pending',
      notes: notes || null,
    })

  if (error) return { error: error.message }

  // Send notification to the approver
  const { notify } = await import('@/lib/notifications')

  if (requesterType === 'rider') {
    // Notify the rider's contractor
    const { data: rider } = await adminDb
      .from('riders')
      .select('name, contractor_id')
      .eq('id', requesterId)
      .single()
    if (rider?.contractor_id) {
      // Find contractor's profile_id
      const { data: contractor } = await adminDb
        .from('contractors')
        .select('profile_id, name')
        .eq('id', rider.contractor_id)
        .single()
      if (contractor?.profile_id) {
        await notify({
          userId: contractor.profile_id,
          type: 'withdrawal_request',
          title: `Withdrawal Request from ${rider.name}`,
          message: `${rider.name} has requested a withdrawal of Rs ${amount.toLocaleString()}.`,
          link: '/dashboard/contractors/earnings',
        })
      }
    }
  } else if (requesterType === 'contractor') {
    // Notify all admins
    const { data: admins } = await adminDb
      .from('profiles')
      .select('id')
      .in('role', ['admin', 'manager'])
    if (admins) {
      const { data: contractor } = await adminDb
        .from('contractors')
        .select('name')
        .eq('id', requesterId)
        .single()
      const { notifyMultiple } = await import('@/lib/notifications')
      await notifyMultiple(admins.map(a => ({
        userId: a.id,
        type: 'withdrawal_request' as const,
        title: `Withdrawal Request from ${contractor?.name || 'Contractor'}`,
        message: `${contractor?.name || 'A contractor'} has requested a withdrawal of Rs ${amount.toLocaleString()}.`,
        link: '/dashboard/deliveries/payments',
      })))
    }
  }

  revalidatePath('/dashboard/contractors/earnings')
  revalidatePath('/dashboard/riders/earnings')
  revalidatePath('/dashboard/deliveries/payments')
  return { success: true }
}

// ── Step 1: Approve or Reject Withdrawal ──
// Approved: status -> 'approved' (no wallet change yet)
// Rejected: status -> 'rejected' + notify requester
export async function processWithdrawal(requestId: string, action: 'approved' | 'rejected', processNotes?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const adminDb = createAdminClient()

  const { data: request } = await adminDb
    .from('payout_requests')
    .select('*')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found' }
  if (request.status !== 'pending') return { error: 'Already processed' }

  const { error: updateError } = await adminDb
    .from('payout_requests')
    .update({
      status: action,
      processed_by: user.id,
      processed_at: new Date().toISOString(),
      notes: processNotes || request.notes,
    })
    .eq('id', requestId)

  if (updateError) return { error: updateError.message }

  // Notify the requester about the decision
  const { notify } = await import('@/lib/notifications')
  const requesterProfileId = await getRequesterProfileId(adminDb, request.requester_type, request.requester_id)
  if (requesterProfileId) {
    await notify({
      userId: requesterProfileId,
      type: 'withdrawal_update',
      title: action === 'approved'
        ? `Withdrawal Approved - Rs ${request.amount.toLocaleString()}`
        : `Withdrawal Rejected - Rs ${request.amount.toLocaleString()}`,
      message: action === 'approved'
        ? 'Your withdrawal has been approved. Payment will be processed shortly.'
        : `Your withdrawal was rejected.${processNotes ? ` Reason: ${processNotes}` : ''}`,
      link: request.requester_type === 'contractor'
        ? '/dashboard/contractors/wallet'
        : '/dashboard/riders/earnings',
    })
  }

  revalidatePath('/dashboard/deliveries/payments')
  revalidatePath('/dashboard/contractors/earnings')
  revalidatePath('/dashboard/contractors/wallet')
  revalidatePath('/dashboard/riders/earnings')
  return { success: true }
}

// ── Step 2: Confirm Payment (mark as paid, deduct wallet) ──
// Only for approved requests. Deducts wallet + logs transaction.
export async function confirmWithdrawalPaid(requestId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const adminDb = createAdminClient()

  const { data: request } = await adminDb
    .from('payout_requests')
    .select('*')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Request not found' }
  if (request.status !== 'approved') return { error: 'Request must be approved first' }

  // Deduct from wallet
  const { data: wallet } = await adminDb
    .from('wallets')
    .select('*')
    .eq('id', request.wallet_id)
    .single()

  if (!wallet) return { error: 'Wallet not found' }

  await adminDb
    .from('wallets')
    .update({
      balance: (wallet.balance || 0) - request.amount,
      total_paid_out: (wallet.total_paid_out || 0) + request.amount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', wallet.id)

  // Log transaction as 'payout' so it deducts from the calculated balance on earnings pages
  await adminDb
    .from('payment_transactions')
    .insert({
      wallet_id: wallet.id,
      transaction_type: 'payout',
      amount: request.amount,
      description: `Withdrawal payout`,
      recipient_type: request.requester_type,
      recipient_id: request.requester_id,
      payer_type: 'system',
      payer_id: user.id,
      status: 'completed',
      processed_by: user.id,
      reference_id: request.id,
      reference_date: new Date().toISOString().split('T')[0],
    })

  // Mark as completed
  await adminDb
    .from('payout_requests')
    .update({
      status: 'completed',
      notes: (request.notes ? request.notes + ' | ' : '') + `Paid on ${new Date().toLocaleDateString()}`,
    })
    .eq('id', requestId)

  // Notify the requester
  const { notify } = await import('@/lib/notifications')
  const requesterProfileId = await getRequesterProfileId(adminDb, request.requester_type, request.requester_id)
  if (requesterProfileId) {
    await notify({
      userId: requesterProfileId,
      type: 'withdrawal_update',
      title: `Payment Received - Rs ${request.amount.toLocaleString()}`,
      message: `Your withdrawal of Rs ${request.amount.toLocaleString()} has been paid.`,
      link: request.requester_type === 'contractor'
        ? '/dashboard/contractors/wallet'
        : '/dashboard/riders/earnings',
    })
  }

  revalidatePath('/dashboard/deliveries/payments')
  revalidatePath('/dashboard/contractors/earnings')
  revalidatePath('/dashboard/contractors/wallet')
  revalidatePath('/dashboard/riders/earnings')
  return { success: true }
}

// Helper: resolve requester profile_id for notifications
async function getRequesterProfileId(adminDb: any, type: string, id: string): Promise<string | null> {
  if (type === 'contractor') {
    const { data } = await adminDb
      .from('contractors')
      .select('profile_id')
      .eq('id', id)
      .single()
    return data?.profile_id || null
  } else if (type === 'rider') {
    const { data } = await adminDb
      .from('riders')
      .select('profile_id')
      .eq('id', id)
      .single()
    return data?.profile_id || null
  }
  return null
}

// ── Set Contractor Initial/Opening Balance (admin only) ──
export async function setContractorInitialBalance(contractorId: string, amount: number, description?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  const adminDb = createAdminClient()

  // Get contractor info
  const { data: contractor } = await adminDb
    .from('contractors')
    .select('name, profile_id')
    .eq('id', contractorId)
    .single()

  // Get or create wallet
  let { data: wallet } = await adminDb
    .from('wallets')
    .select('*')
    .eq('owner_type', 'contractor')
    .eq('owner_id', contractorId)
    .single()

  if (!wallet) {
    const { data: newWallet, error: walletError } = await adminDb
      .from('wallets')
      .insert({
        owner_type: 'contractor',
        owner_id: contractorId,
        balance: 0,
        total_earned: 0,
        total_paid_out: 0,
      })
      .select()
      .single()
    if (walletError) return { error: walletError.message }
    wallet = newWallet
  }

  // Add the amount to existing balance (opening balance/adjustment)
  const currentBalance = Number(wallet.balance) || 0
  const newBalance = currentBalance + amount

  if (amount === 0) return { success: true, message: 'No adjustment needed' }

  // Record the adjustment transaction (use 'adjustment' type which is allowed by constraint)
  const { error: txError } = await adminDb
    .from('payment_transactions')
    .insert({
      wallet_id: wallet.id,
      transaction_type: 'adjustment',
      amount: amount, // The amount being added (positive for credit, negative for debit)
      description: description || `Balance adjustment: ${amount >= 0 ? '+' : ''}Rs ${amount.toLocaleString()}`,
      recipient_id: contractorId,
      recipient_type: 'contractor',
      payer_type: 'admin',
      payer_id: user.id,
      status: 'completed',
      processed_by: user.id,
      reference_date: new Date().toISOString().split('T')[0],
    })

  if (txError) return { error: txError.message }

  // Update wallet balance (add the amount to existing balance)
  const newTotalEarned = amount > 0 ? (wallet.total_earned || 0) + amount : wallet.total_earned || 0
  const { error: updateError } = await adminDb
    .from('wallets')
    .update({
      balance: newBalance,
      total_earned: newTotalEarned,
      updated_at: new Date().toISOString(),
    })
    .eq('id', wallet.id)

  if (updateError) return { error: updateError.message }

  // Notify contractor with amount and notes (no balance shown)
  if (contractor?.profile_id) {
    const noteText = description ? ` Note: ${description}` : ''
    await adminDb.from('notifications').insert({
      user_id: contractor.profile_id,
      title: amount >= 0 ? 'Balance Credit' : 'Balance Deduction',
      message: amount >= 0 
        ? `Rs ${amount.toLocaleString()} has been credited to your account.${noteText}`
        : `Rs ${Math.abs(amount).toLocaleString()} has been deducted from your account.${noteText}`,
      type: amount >= 0 ? 'payment' : 'warning',
    })
  }

  revalidatePath('/dashboard/deliveries/contractors')
  revalidatePath('/dashboard/contractors/wallet')
  return { success: true }
}

// ── Reset Contractor Wallet (admin only — for testing) ──
export async function resetContractorWallet(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') {
    return { error: 'Not authorized — admin only' }
  }

  const adminDb = createAdminClient()

  // Reset wallet to zero
  const { error: walletError } = await adminDb
    .from('wallets')
    .update({
      balance: 0,
      total_earned: 0,
      total_paid_out: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('owner_type', 'contractor')
    .eq('owner_id', contractorId)

  // Delete all payment transactions for this contractor
  await adminDb
    .from('payment_transactions')
    .delete()
    .eq('recipient_type', 'contractor')
    .eq('recipient_id', contractorId)

  // Delete all payout requests
  await adminDb
    .from('payout_requests')
    .delete()
    .eq('requester_type', 'contractor')
    .eq('requester_id', contractorId)

  // Also reset rider wallets under this contractor
  const { data: riders } = await adminDb
    .from('riders')
    .select('id')
    .eq('contractor_id', contractorId)

  for (const rider of riders || []) {
    await adminDb
      .from('wallets')
      .update({ balance: 0, total_earned: 0, total_paid_out: 0, updated_at: new Date().toISOString() })
      .eq('owner_type', 'rider')
      .eq('owner_id', rider.id)

    await adminDb
      .from('payment_transactions')
      .delete()
      .eq('recipient_type', 'rider')
      .eq('recipient_id', rider.id)

    await adminDb
      .from('payout_requests')
      .delete()
      .eq('requester_type', 'rider')
      .eq('requester_id', rider.id)
  }

  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/contractors/earnings')
  revalidatePath('/dashboard/contractors/wallet')
  revalidatePath('/dashboard/riders/earnings')
  return { success: true }
}

// ── Reset Contractor Notifications (admin only — for testing) ──
export async function resetContractorNotifications(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') {
    return { error: 'Not authorized — admin only' }
  }

  const adminDb = createAdminClient()

  // Get contractor's profile_id
  const { data: contractor } = await adminDb
    .from('contractors')
    .select('profile_id')
    .eq('id', contractorId)
    .single()

  if (contractor?.profile_id) {
    await adminDb
      .from('notifications')
      .delete()
      .eq('user_id', contractor.profile_id)
  }

  // Also clear notifications for all riders under this contractor
  const { data: riders } = await adminDb
    .from('riders')
    .select('profile_id')
    .eq('contractor_id', contractorId)

  for (const rider of riders || []) {
    if (rider.profile_id) {
      await adminDb
        .from('notifications')
        .delete()
        .eq('user_id', rider.profile_id)
    }
  }

  revalidatePath('/dashboard/admin/team')
  return { success: true }
}

// ── Save Custom Message Templates ──
export async function saveMessageTemplates(templates: Record<string, string>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { error } = await supabase
    .from('profiles')
    .update({ message_templates: templates })
    .eq('id', user.id)
  if (error) return { error: error.message }
  return { success: true }
}

// ══════════════════════════════════════════════════════════════
// RIDER WALLET ACTIONS (Admin Only)
// ══════════════════════════════════════════════════════════════

async function getOrCreateRiderWallet(adminDb: ReturnType<typeof createAdminClient>, riderId: string) {
  let { data: wallet } = await adminDb
    .from('wallets')
    .select('*')
    .eq('owner_type', 'rider')
    .eq('owner_id', riderId)
    .single()

  if (!wallet) {
    const { data: newWallet, error: walletError } = await adminDb
      .from('wallets')
      .insert({
        owner_type: 'rider',
        owner_id: riderId,
        balance: 0,
        total_earned: 0,
        total_paid_out: 0,
      })
      .select()
      .single()
    if (walletError) return { error: walletError.message }
    wallet = newWallet
  }
  return { wallet }
}

// ── Record Admin -> Rider Payout ──
export async function recordAdminRiderPayout(riderId: string, amount: number, description?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  if (amount <= 0) return { error: 'Amount must be positive' }

  const adminDb = createAdminClient()

  // Get rider info for notification
  const { data: rider } = await adminDb
    .from('riders')
    .select('name, profile_id')
    .eq('id', riderId)
    .single()

  const walletResult = await getOrCreateRiderWallet(adminDb, riderId)
  if ('error' in walletResult) return walletResult
  const { wallet } = walletResult

  // Record transaction
  const { error: txError } = await adminDb
    .from('payment_transactions')
    .insert({
      wallet_id: wallet.id,
      transaction_type: 'payout',
      amount,
      description: description || 'Payment from admin',
      recipient_id: riderId,
      recipient_type: 'rider',
      payer_type: 'admin',
      payer_id: user.id,
      status: 'completed',
      processed_by: user.id,
      reference_date: new Date().toISOString().split('T')[0],
    })

  if (txError) return { error: txError.message }

  // Update wallet - increase total_paid_out, decrease balance
  await adminDb
    .from('wallets')
    .update({
      balance: Math.max(0, (wallet.balance || 0) - amount),
      total_paid_out: (wallet.total_paid_out || 0) + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', wallet.id)

  // Send notification to rider
  if (rider?.profile_id) {
    await adminDb.from('notifications').insert({
      user_id: rider.profile_id,
      title: 'Payment Received',
      message: `You received a payment of Rs ${amount.toLocaleString()}${description ? ` - ${description}` : ''}`,
      type: 'payment',
    })
  }

  revalidatePath('/dashboard/deliveries/contractors')
  revalidatePath('/dashboard/contractors/wallet')
  revalidatePath('/dashboard/riders/earnings')
  return { success: true }
}

// ── Record Admin -> Rider Advance ──
export async function recordAdminRiderAdvance(riderId: string, amount: number, description?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  if (amount <= 0) return { error: 'Amount must be positive' }

  const adminDb = createAdminClient()

  // Get rider info for notification
  const { data: rider } = await adminDb
    .from('riders')
    .select('name, profile_id')
    .eq('id', riderId)
    .single()

  const walletResult = await getOrCreateRiderWallet(adminDb, riderId)
  if ('error' in walletResult) return walletResult
  const { wallet } = walletResult

  // Record transaction
  const { error: txError } = await adminDb
    .from('payment_transactions')
    .insert({
      wallet_id: wallet.id,
      transaction_type: 'advance',
      amount,
      description: description || 'Advance from admin',
      recipient_id: riderId,
      recipient_type: 'rider',
      payer_type: 'admin',
      payer_id: user.id,
      status: 'completed',
      processed_by: user.id,
      reference_date: new Date().toISOString().split('T')[0],
    })

  if (txError) return { error: txError.message }

  // Update wallet - advances reduce future balance (negative balance means rider owes)
  await adminDb
    .from('wallets')
    .update({
      balance: (wallet.balance || 0) - amount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', wallet.id)

  // Send notification to rider
  if (rider?.profile_id) {
    await adminDb.from('notifications').insert({
      user_id: rider.profile_id,
      title: 'Advance Received',
      message: `You received an advance of Rs ${amount.toLocaleString()}${description ? ` - ${description}` : ''}. This will be deducted from future earnings.`,
      type: 'payment',
    })
  }

  revalidatePath('/dashboard/deliveries/contractors')
  revalidatePath('/dashboard/contractors/wallet')
  revalidatePath('/dashboard/riders/earnings')
  return { success: true }
}

// ── Record Admin -> Rider Deduction ──
export async function recordAdminRiderDeduction(riderId: string, amount: number, description?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  if (amount <= 0) return { error: 'Amount must be positive' }

  const adminDb = createAdminClient()

  // Get rider info for notification
  const { data: rider } = await adminDb
    .from('riders')
    .select('name, profile_id')
    .eq('id', riderId)
    .single()

  const walletResult = await getOrCreateRiderWallet(adminDb, riderId)
  if ('error' in walletResult) return walletResult
  const { wallet } = walletResult

  // Record transaction
  const { error: txError } = await adminDb
    .from('payment_transactions')
    .insert({
      wallet_id: wallet.id,
      transaction_type: 'deduction',
      amount,
      description: description || 'Deduction by admin',
      recipient_id: riderId,
      recipient_type: 'rider',
      payer_type: 'admin',
      payer_id: user.id,
      status: 'completed',
      processed_by: user.id,
      reference_date: new Date().toISOString().split('T')[0],
    })

  if (txError) return { error: txError.message }

  // Update wallet - deductions reduce balance (penalty)
  await adminDb
    .from('wallets')
    .update({
      balance: (wallet.balance || 0) - amount,
      total_earned: Math.max(0, (wallet.total_earned || 0) - amount),
      updated_at: new Date().toISOString(),
    })
    .eq('id', wallet.id)

  // Send notification to rider
  if (rider?.profile_id) {
    await adminDb.from('notifications').insert({
      user_id: rider.profile_id,
      title: 'Deduction Applied',
      message: `A deduction of Rs ${amount.toLocaleString()} was applied${description ? `: ${description}` : ''}`,
      type: 'warning',
    })
  }

  revalidatePath('/dashboard/deliveries/contractors')
  revalidatePath('/dashboard/contractors/wallet')
  revalidatePath('/dashboard/riders/earnings')
  return { success: true }
}
