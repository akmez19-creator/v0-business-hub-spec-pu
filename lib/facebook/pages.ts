const GRAPH = 'https://graph.facebook.com/v21.0'

export type FbPage = { id: string; name: string; access_token: string }

// Facebook's /me/accounts only returns pages granted during the app's login
// flow (granular scoping) - it can silently hide pages the user actually
// manages. So we ALSO discover pages through the ad accounts' promote_pages
// edge and try to resolve a page access token for each directly. Any page
// that hands us a token is manageable and gets included.
export async function getManageablePages(token: string): Promise<FbPage[]> {
  const enc = encodeURIComponent(token)
  const byId = new Map<string, FbPage>()

  // 1. The straightforward path: pages granted to the app
  try {
    const res = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${enc}`)
    const json = (await res.json()) as { data?: FbPage[] }
    for (const p of json.data ?? []) {
      if (p.access_token) byId.set(p.id, p)
    }
  } catch {
    // fall through to discovery
  }

  // 2. Discovery: pages promotable from the user's ad accounts
  const candidates = new Map<string, string>() // id -> name
  try {
    const acctRes = await fetch(`${GRAPH}/me/adaccounts?fields=id&limit=50&access_token=${enc}`)
    const acctJson = (await acctRes.json()) as { data?: { id: string }[] }
    const accounts = (acctJson.data ?? []).slice(0, 10)
    const results = await Promise.all(
      accounts.map(async (a) => {
        try {
          const r = await fetch(`${GRAPH}/${a.id}/promote_pages?fields=id,name&limit=50&access_token=${enc}`)
          const j = (await r.json()) as { data?: { id: string; name: string }[] }
          return j.data ?? []
        } catch {
          return []
        }
      }),
    )
    for (const list of results) {
      for (const p of list) {
        if (!byId.has(p.id)) candidates.set(p.id, p.name)
      }
    }
  } catch {
    // me/accounts result stands alone
  }

  // 3. Resolve page tokens for candidates - only works where the user has a
  // page role, which is exactly the filter we want
  const entries = Array.from(candidates.entries())
  const resolved = await Promise.all(
    entries.map(async ([id, name]) => {
      try {
        const r = await fetch(`${GRAPH}/${id}?fields=access_token&access_token=${enc}`)
        const j = (await r.json()) as { access_token?: string }
        return j.access_token ? { id, name, access_token: j.access_token } : null
      } catch {
        return null
      }
    }),
  )
  for (const p of resolved) {
    if (p) byId.set(p.id, p)
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
}
