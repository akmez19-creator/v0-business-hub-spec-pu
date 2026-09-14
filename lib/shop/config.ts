/**
 * Storefront constants.
 *
 * WHATSAPP_NUMBER is the "Made By Moris" Cloud API line (+230 5251 1213),
 * chosen by the owner for price enquiries. It is deliberately NOT read from
 * `company_settings.phone` - that row exists but its phone column is empty, so
 * reading it would render a dead wa.me link. If that setting is ever filled in,
 * switch to it and delete this constant.
 *
 * Digits only, country code included: wa.me rejects spaces, "+" and dashes.
 */
export const WHATSAPP_NUMBER = '23052511213'

/** Pretty form for display next to the button. */
export const WHATSAPP_DISPLAY = '+230 5251 1213'

/**
 * Deep link to a pre-filled enquiry. The product name is the whole point -
 * without it the customer lands in a blank chat and has to describe the item,
 * which is exactly the friction this button exists to remove.
 */
export function whatsappEnquiryUrl(productName: string, productId?: string): string {
  const ref = productId ? ` (ref ${productId.slice(0, 8)})` : ''
  const text = `Hello, I would like to know the price of: ${productName}${ref}`
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`
}
