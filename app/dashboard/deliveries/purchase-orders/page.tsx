import { redirect } from 'next/navigation'

/**
 * Purchase Orders moved out of Deliveries into its own Purchasing section.
 * Kept as a redirect so existing bookmarks and links keep working.
 */
export default function PurchaseOrdersRedirect() {
  redirect('/dashboard/purchasing')
}
