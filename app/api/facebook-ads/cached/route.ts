import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`
const CACHE_TTL_SECONDS = 15 * 60 // 15 minutes

interface CacheData {
  accounts: unknown[]
  campaigns: unknown[]
  account_spends: Record<string, number>
  last_refresh: string
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const forceRefresh = searchParams.get('forceRefresh') === 'true'
  const cacheKey = 'today_spend' // We primarily cache today's data
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  // Load any existing cache up front so we can fall back to it if Facebook fails
  const { data: cached } = await supabase
    .from('ads_cache')
    .select('*')
    .eq('cache_key', cacheKey)
    .single()
  
  // Helper to return cached (possibly stale) data with an optional error message
  const returnCache = (stale: boolean, errorMessage?: string) => {
    if (!cached) return null
    const lastRefresh = new Date(cached.last_refresh)
    const ageSeconds = (Date.now() - lastRefresh.getTime()) / 1000
    const remainingSeconds = Math.max(0, CACHE_TTL_SECONDS - ageSeconds)
    return NextResponse.json({
      accounts: cached.accounts,
      campaigns: cached.campaigns,
      accountSpends: cached.account_spends,
      lastRefresh: cached.last_refresh,
      nextRefreshIn: Math.round(remainingSeconds),
      fromCache: true,
      stale,
      ...(errorMessage ? { error: errorMessage } : {})
    })
  }
  
  try {
    // Return cached data if still valid
    if (!forceRefresh && cached) {
      const ageSeconds = (Date.now() - new Date(cached.last_refresh).getTime()) / 1000
      if (ageSeconds < CACHE_TTL_SECONDS) {
        return returnCache(false)!
      }
    }
    
    // Fetch fresh data from Facebook
    const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
    
    if (!accessToken) {
      // Fall back to stale cache if available
      return returnCache(true, 'Facebook access token not configured') ??
        NextResponse.json({ error: 'Facebook access token not configured' }, { status: 500 })
    }
    
    // Fetch all accounts including billing info
    // balance = current amount owed (positive = you owe Facebook)
    // spend_cap = spending limit
    // amount_spent = total amount spent (lifetime)
    const accountsResponse = await fetch(
      `${FACEBOOK_GRAPH_URL}/me/adaccounts?fields=id,name,account_status,currency,balance,spend_cap,amount_spent&access_token=${accessToken}`
    )
    
    if (!accountsResponse.ok) {
      const error = await accountsResponse.json()
      const message = error.error?.message || 'Failed to fetch ad accounts'
      // Fall back to stale cache instead of crashing (e.g. expired token)
      const fallback = returnCache(true, message)
      if (fallback) return fallback
      throw new Error(message)
    }
    
    const accountsData = await accountsResponse.json()
    const accounts = accountsData.data || []
    
    // Fetch campaigns and spend for each account (today's data) - in parallel for speed
    const allCampaigns: unknown[] = []
    const accountSpends: Record<string, number> = {}
    
    // Process all accounts in parallel
    await Promise.all(accounts.map(async (account: { id: string; name?: string }) => {
      try {
        // Get account-level spend AND campaigns with spend in one call using insights breakdown.
        // Also fetch all ads for the account so we can show each campaign's ad IDs.
        const [spendResponse, campaignsResponse, adsResponse] = await Promise.all([
          fetch(`${FACEBOOK_GRAPH_URL}/${account.id}/insights?fields=spend&date_preset=today&access_token=${accessToken}`),
          fetch(`${FACEBOOK_GRAPH_URL}/${account.id}/campaigns?fields=id,name,status,objective,created_time,insights.date_preset(today){spend}&access_token=${accessToken}&limit=500`),
          fetch(`${FACEBOOK_GRAPH_URL}/${account.id}/ads?fields=id,campaign_id&access_token=${accessToken}&limit=500`)
        ])
        
        const spendData = await spendResponse.json()
        accountSpends[account.id] = parseFloat(spendData.data?.[0]?.spend || '0')
        
        // Build a map of campaign_id -> [adId, ...] (with pagination)
        const adsByCampaign: Record<string, string[]> = {}
        const collectAds = (ads: { id: string; campaign_id?: string }[]) => {
          for (const ad of ads) {
            if (!ad.campaign_id) continue
            if (!adsByCampaign[ad.campaign_id]) adsByCampaign[ad.campaign_id] = []
            adsByCampaign[ad.campaign_id].push(ad.id)
          }
        }
        const adsData = await adsResponse.json()
        collectAds(adsData.data || [])
        let nextAdsUrl = adsData.paging?.next
        while (nextAdsUrl) {
          const r = await fetch(nextAdsUrl)
          const d = await r.json()
          collectAds(d.data || [])
          nextAdsUrl = d.paging?.next
        }
        
        const campaignsData = await campaignsResponse.json()
        const campaigns = campaignsData.data || []
        
        for (const campaign of campaigns) {
          const spend = campaign.insights?.data?.[0]?.spend || '0'
          allCampaigns.push({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            objective: campaign.objective,
            created_time: campaign.created_time,
            spend,
            adIds: adsByCampaign[campaign.id] || [],
            accountId: account.id,
            accountName: account.name || account.id
          })
        }
        
        // Handle pagination if needed
        let nextUrl = campaignsData.paging?.next
        while (nextUrl) {
          const nextResponse = await fetch(nextUrl)
          const nextData = await nextResponse.json()
          for (const campaign of (nextData.data || [])) {
            const spend = campaign.insights?.data?.[0]?.spend || '0'
            allCampaigns.push({
              id: campaign.id,
              name: campaign.name,
              status: campaign.status,
              objective: campaign.objective,
              created_time: campaign.created_time,
              spend,
              adIds: adsByCampaign[campaign.id] || [],
              accountId: account.id,
              accountName: account.name || account.id
            })
          }
          nextUrl = nextData.paging?.next
        }
      } catch (err) {
        console.error(`Failed to fetch data for account ${account.id}:`, err)
      }
    }))
    
    // Sort campaigns by spend descending
    allCampaigns.sort((a: unknown, b: unknown) => {
      const aSpend = parseFloat((a as { spend: string }).spend || '0')
      const bSpend = parseFloat((b as { spend: string }).spend || '0')
      return bSpend - aSpend
    })
    
    const now = new Date().toISOString()
    
    // Save to cache
    await supabase
      .from('ads_cache')
      .upsert({
        cache_key: cacheKey,
        accounts,
        campaigns: allCampaigns,
        account_spends: accountSpends,
        last_refresh: now,
        updated_at: now
      }, { onConflict: 'cache_key' })
    
    return NextResponse.json({
      accounts,
      campaigns: allCampaigns,
      accountSpends,
      lastRefresh: now,
      nextRefreshIn: CACHE_TTL_SECONDS,
      fromCache: false
    })
    
  } catch (error) {
    console.error('Cached Facebook API Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to fetch ads data'
    // Fall back to stale cache if we have any, otherwise return the error
    const fallback = returnCache(true, message)
    if (fallback) return fallback
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
