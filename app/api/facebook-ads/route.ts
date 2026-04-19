import { NextResponse } from 'next/server'

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'accounts'
  const accountId = searchParams.get('accountId')
  
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
        return await getCampaigns(accessToken, accountId)
      case 'adsets':
        return await getAdSets(accessToken, accountId)
      case 'ads':
        return await getAds(accessToken, accountId)
      case 'insights':
        return await getInsights(accessToken, accountId)
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

async function getCampaigns(accessToken: string, accountId: string | null) {
  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
  }
  
  const response = await fetch(
    `${FACEBOOK_GRAPH_URL}/${accountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,created_time,updated_time,start_time,stop_time&access_token=${accessToken}`
  )
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Failed to fetch campaigns')
  }
  
  const data = await response.json()
  return NextResponse.json(data)
}

async function getAdSets(accessToken: string, accountId: string | null) {
  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
  }
  
  const response = await fetch(
    `${FACEBOOK_GRAPH_URL}/${accountId}/adsets?fields=id,name,status,campaign_id,daily_budget,lifetime_budget,targeting,optimization_goal&access_token=${accessToken}`
  )
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Failed to fetch ad sets')
  }
  
  const data = await response.json()
  return NextResponse.json(data)
}

async function getAds(accessToken: string, accountId: string | null) {
  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
  }
  
  const response = await fetch(
    `${FACEBOOK_GRAPH_URL}/${accountId}/ads?fields=id,name,status,adset_id,campaign_id,creative{id,name,thumbnail_url,object_story_spec},created_time,updated_time&access_token=${accessToken}`
  )
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Failed to fetch ads')
  }
  
  const data = await response.json()
  return NextResponse.json(data)
}

async function getInsights(accessToken: string, accountId: string | null) {
  if (!accountId) {
    return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
  }
  
  const response = await fetch(
    `${FACEBOOK_GRAPH_URL}/${accountId}/insights?fields=impressions,clicks,spend,reach,cpc,cpm,ctr,actions&date_preset=last_7d&access_token=${accessToken}`
  )
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error?.message || 'Failed to fetch insights')
  }
  
  const data = await response.json()
  return NextResponse.json(data)
}
