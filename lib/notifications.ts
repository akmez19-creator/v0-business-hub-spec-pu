import { createAdminClient } from '@/lib/supabase/server'

type NotificationType = 'delivery_assigned' | 'delivery_completed' | 'delivery_failed' | 'payout' | 'stock_update' | 'rate_update' | 'info' | 'warning' | 'error' | 'welcome' | 'withdrawal_request' | 'withdrawal_update' | 'order_modified'

interface NotifyParams {
  userId: string
  type: NotificationType
  title: string
  message?: string
  link?: string
}

export async function notify({ userId, type, title, message, link }: NotifyParams) {
  try {
    const supabase = createAdminClient()
    await supabase.from('notifications').insert({
      user_id: userId,
      type,
      title,
      message: message || null,
      link: link || null,
    })
  } catch (error) {
    console.error('Failed to send notification:', error)
  }
}

export async function notifyMultiple(notifications: NotifyParams[]) {
  try {
    const supabase = createAdminClient()
    await supabase.from('notifications').insert(
      notifications.map(n => ({
        user_id: n.userId,
        type: n.type,
        title: n.title,
        message: n.message || null,
        link: n.link || null,
      }))
    )
  } catch (error) {
    console.error('Failed to send notifications:', error)
  }
}
