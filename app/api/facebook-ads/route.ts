import { NextResponse } from 'next/server'
import { fbGet, fbGetAll } from '@/lib/facebook/graph'

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
  // Ad account metadata changes rarely - cache aggressively (10 min)
  const data = await fbGet(
    `${FACEBOOK_GRAPH_URL}/me/adaccounts?fields=id,name,account_status,currency,amount_spent,balance&access_token=${accessToken}`,
    { cacheTtl: 10 * 60 * 1000 },
  )
  return NextResponse.json(data)
}

// Lightweight campaign list for pickers (e.g. Campaign Creator) - names only,
// no per-campaign insights. The full 'campaigns' action makes one insights
// call per campaign, which takes minutes on accounts with hundreds of them.
async function getCampaignsList(accessToken: string, accountId: string | null) {
  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
  }

  const campaigns = await fbGetAll<{ id: string; name: string; status: string; objective: string; created_time: string }>(
    `${FACEBOOK_GRAPH_URL}/${accountId}/campaigns?fields=id,name,status,objective,created_time&access_token=${accessToken}&limit=500`,
    { cacheTtl: 5 * 60 * 1000 },
  )

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
  
  // Insights are requested through FIELD EXPANSION on the campaigns listing,
  // so one page of 500 campaigns costs ONE call instead of 500 per-campaign
  // insights calls. This is what was exhausting the app's hourly quota.
  let insightsExpansion: string
  if (since && until) {
    insightsExpansion = `insights.time_range({"since":"${since}","until":"${until}"}){spend,impressions,clicks,reach}`
  } else {
    insightsExpansion = `insights.date_preset(${datePreset === 'lifetime' ? 'maximum' : datePreset}){spend,impressions,clicks,reach}`
  }

  const firstUrl =
    `${FACEBOOK_GRAPH_URL}/${accountId}/campaigns?fields=id,name,status,objective,created_time,` +
    `lifetime_budget,daily_budget,budget_remaining,start_time,stop_time,${encodeURIComponent(insightsExpansion)}` +
    `&access_token=${accessToken}&limit=500`

  type CampaignRow = {
    id: string; name: string; status: string; objective: string; created_time: string
    lifetime_budget?: string; daily_budget?: string; budget_remaining?: string
    start_time?: string; stop_time?: string
    insights?: { data?: Array<{ spend?: string; impressions?: string; clicks?: string; reach?: string }> }
  }
  const allCampaigns = await fbGetAll<CampaignRow>(firstUrl, { cacheTtl: 5 * 60 * 1000 })

  // Account-level spend for the accurate total (single call, cached)
  let timeRange = ''
  if (since && until) {
    timeRange = `&time_range={"since":"${since}","until":"${until}"}`
  } else {
    timeRange = `&date_preset=${datePreset === 'lifetime' ? 'maximum' : datePreset}`
  }
  let accountTotalSpend = '0'
  try {
    const accountInsights = await fbGet<{ data?: Array<{ spend?: string }> }>(
      `${FACEBOOK_GRAPH_URL}/${accountId}/insights?fields=spend${timeRange}&access_token=${accessToken}`,
      { cacheTtl: 5 * 60 * 1000 },
    )
    accountTotalSpend = accountInsights.data?.[0]?.spend || '0'
  } catch {
    // Non-critical - the per-campaign data still renders
  }

  const campaignsWithSpend = allCampaigns.map((campaign) => {
    const insights = campaign.insights?.data?.[0] || {}
    const { insights: _drop, ...rest } = campaign
    return {
      ...rest,
      spend: insights.spend || '0',
      impressions: insights.impressions || '0',
      clicks: insights.clicks || '0',
      reach: insights.reach || '0',
    }
  })

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
  
  const data = await fbGet(
    `${FACEBOOK_GRAPH_URL}/${accountId}/insights?fields=spend,impressions,clicks,reach${timeRange}&access_token=${accessToken}`,
    { cacheTtl: 5 * 60 * 1000 },
  )
  return NextResponse.json(data)
}
