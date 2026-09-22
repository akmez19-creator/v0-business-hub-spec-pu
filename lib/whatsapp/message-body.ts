export type WaLocation = { latitude?: number; longitude?: number; name?: string; address?: string }
export type WaContact = { name?: { formatted_name?: string }; phones?: { phone?: string; wa_id?: string }[] }

/**
 * A shared pin has no text, so a null body made the bubble say "content is
 * unavailable" and paused AI drafting. A maps link keeps it readable everywhere
 * (bubble, AI transcript, autopilot) and the rider can open it directly.
 */
export function locationBody(loc: WaLocation | undefined | null): string | null {
  if (typeof loc?.latitude !== 'number' || typeof loc?.longitude !== 'number') return null
  const label = [loc.name, loc.address].filter(Boolean).join(', ')
  const url = `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`
  return label ? `Location shared: ${label}\n${url}` : `Location shared: ${url}`
}

export function contactsBody(contacts: WaContact[] | undefined | null): string | null {
  if (!contacts?.length) return null
  const cards = contacts
    .map(c => [c.name?.formatted_name, c.phones?.map(p => p.phone ?? p.wa_id).filter(Boolean).join(' / ')].filter(Boolean).join(': '))
    .filter(Boolean)
  return cards.length ? `Contact shared: ${cards.join('; ')}` : null
}
