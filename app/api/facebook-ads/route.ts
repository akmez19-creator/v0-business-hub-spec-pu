import { NextResponse } from 'next/server'

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'accounts'
  const accountId = searchParams.get('accountId')
  const datePreset = searchParams.get('datePreset') || 'lifetime'
  const since = searchParams.get('since')
  const until = searchParams.get('until')
  
  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
  
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Facebook access token not configured' },
      { status: 500 }
    )
  }

  try {
    switch (action) {
      case 'accounts':
        return await getAdAccounts(accessToken)
      case 'campaigns':
        return await getCampaignsWithSpend(accessToken, accountId, datePreset, since, until)
      case 'campaigns-list':
        return await getCampaignsList(accessToken, accountId)
      case 'account_spend':
        return await getAccountSpend(accessToken, accountId, datePreset, since, until)
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  } catch (error) {
    console.error('Facebook API Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch from Facebook API' },
      { status: 500 }
    )
  }
}

async function getAdAccounts(accessToken: string) {
  const response = await fetch(
    `${FACEBOOK_GRAPH_URL}/me/adaccounts?fields=id,name,account_status,currency,amount_spent,balance&access_token=${accessToken}`
  )
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Failed to fetch ad accounts')
  }
  
  const data = await response.json()
  return NextResponse.json(data)
}

// Lightweight campaign list for pickers (e.g. Campaign Creator) - names only,
// no per-campaign insights. The full 'campaigns' action makes one insights
// call per campaign, which takes minutes on accounts with hundreds of them.
async function getCampaignsList(accessToken: string, accountId: string | null) {
  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
  }

  let campaigns: Array<{ id: string; name: string; status: string; objective: string; created_time: string }> = []
  let nextUrl: string | null = `${FACEBOOK_GRAPH_URL}/${accountId}/campaigns?fields=id,name,status,objective,created_time&access_token=${accessToken}&limit=500`

  while (nextUrl) {
    const response: Response = await fetch(nextUrl)
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || 'Failed to fetch campaigns')
    }
    const data = await response.json()
    campaigns = [...campaigns, ...(data.data || [])]
    nextUrl = data.paging?.next || null
  }

  // Newest first so the picker surfaces recent campaigns at the top
  campaigns.sort((a, b) => (b.created_time || '').localeCompare(a.created_time || ''))

  return NextResponse.json({ campaigns })
}

async function getCampaignsWithSpend(
  accessToken: string, 
  accountId: string | null,
  datePreset: string,
  since: string | null,
  until: string | null
) {
  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
  }
  
  // Build time range params
  let timeRange = ''
  if (since && until) {
    timeRange = `&time_range={"since":"${since}","until":"${until}"}`
  } else if (datePreset !== 'lifetime') {
    timeRange = `&date_preset=${datePreset}`
  }
  
  // Get ALL campaigns with pagination. Budget + schedule fields (lifetime_budget,
  // budget_remaining, stop_time) power the per-campaign spent/remaining/end-date UI.
  let allCampaigns: Array<{ id: string; name: string; status: string; objective: string; created_time: string; lifetime_budget?: string; daily_budget?: string; budget_remaining?: string; start_time?: string; stop_time?: string }> = []
  let nextUrl: string | null = `${FACEBOOK_GRAPH_URL}/${accountId}/campaigns?fields=id,name,status,objective,created_time,lifetime_budget,daily_budget,budget_remaining,start_time,stop_time&access_token=${accessToken}&limit=500`
  
  while (nextUrl) {
    const campaignsResponse: Response = await fetch(nextUrl)
    
    if (!campaignsResponse.ok) {
      const error = await campaignsResponse.json()
      throw new Error(error.error?.message || 'Failed to fetch campaigns')
    }
    
    const campaignsData: { data?: typeof allCampaigns; paging?: { next?: string } } = await campaignsResponse.json()
    allCampaigns = [...allCampaigns, ...(campaignsData.data || [])]
    
    // Check for next page
    nextUrl = campaignsData.paging?.next || null
  }
  
  // Get account-level spend for accurate total
  const accountInsightsUrl = datePreset === 'lifetime'
    ? `${FACEBOOK_GRAPH_URL}/${accountId}/insights?fields=spend&date_preset=maximum&access_token=${accessToken}`
    : `${FACEBOOK_GRAPH_URL}/${accountId}/insights?fields=spend${timeRange}&access_token=${accessToken}`
  
  const accountInsightsResponse = await fetch(accountInsightsUrl)
  const accountInsightsData = await accountInsightsResponse.json()
  const accountTotalSpend = accountInsightsData.data?.[0]?.spend || '0'
  
  // Get spend for each campaign (batch to avoid rate limits)
  const batchSize = 50
  const campaignsWithSpend: Array<Record<string, unknown>> = []
  
  for (let i = 0; i < allCampaigns.length; i += batchSize) {
    const batch = allCampaigns.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(async (campaign) => {
        try {
          const insightsUrl = datePreset === 'lifetime'
            ? `${FACEBOOK_GRAPH_URL}/${campaign.id}/insights?fields=spend,impressions,clicks,reach&date_preset=maximum&access_token=${accessToken}`
            : `${FACEBOOK_GRAPH_URL}/${campaign.id}/insights?fields=spend,impressions,clicks,reach${timeRange}&access_token=${accessToken}`
          
          const insightsResponse = await fetch(insightsUrl)
          const insightsData = await insightsResponse.json()
          
          const insights = insightsData.data?.[0] || {}
          
          return {
            ...campaign,
            spend: insights.spend || '0',
            impressions: insights.impressions || '0',
            clicks: insights.clicks || '0',
            reach: insights.reach || '0',
          }
        } catch {
          return {
            ...campaign,
            spend: '0',
            impressions: '0',
            clicks: '0',
            reach: '0',
          }
        }
      })
    )
    campaignsWithSpend.push(...batchResults)
  }
  
  // Sort by spend descending
  campaignsWithSpend.sort((a, b) => parseFloat(b.spend as string) - parseFloat(a.spend as string))
  
  return NextResponse.json({ 
    data: campaignsWithSpend,
    accountTotalSpend // Include accurate account-level spend
  })
}

async function getAccountSpend(
  accessToken: string, 
  accountId: string | null,
  datePreset: string,
  since: string | null,
  until: string | null
) {
  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
  }
  
  // Build time range params
  let timeRange = ''
  if (since && until) {
    timeRange = `&time_range={"since":"${since}","until":"${until}"}`
  } else if (datePreset !== 'lifetime') {
    timeRange = `&date_preset=${datePreset}`
  } else {
    timeRange = '&date_preset=maximum'
  }
  
  const response = await fetch(
    `${FACEBOOK_GRAPH_URL}/${accountId}/insights?fields=spend,impressions,clicks,reach${timeRange}&access_token=${accessToken}`
  )
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Failed to fetch account spend')
  }
  
  const data = await response.json()
  return NextResponse.json(data)
}
