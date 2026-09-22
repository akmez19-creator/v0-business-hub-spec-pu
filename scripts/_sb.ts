async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  console.log('url', url)
  for (let i = 0; i < 4; i++) {
    const t = Date.now()
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key!, Authorization: `Bearer ${key}` } }).catch(e => ({ status: 'ERR ' + e.message }))
    console.log('auth/v1/user', r.status, Date.now() - t, 'ms')
  }
  const t = Date.now()
  const r = await fetch(`${url}/rest/v1/products?select=id&limit=1`, { headers: { apikey: key!, Authorization: `Bearer ${key}` } })
  console.log('rest products', r.status, Date.now() - t, 'ms')
}
main()
