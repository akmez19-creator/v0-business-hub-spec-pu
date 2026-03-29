import { NextResponse } from 'next/server'

const OVERPASS_API = 'https://overpass-api.de/api/interpreter'

// Query for common POIs in Mauritius
const OVERPASS_QUERY = `
[out:json][timeout:300];
area["ISO3166-1"="MU"]->.mauritius;
(
  node["amenity"="school"](area.mauritius);
  way["amenity"="school"](area.mauritius);
  node["amenity"="college"](area.mauritius);
  node["amenity"="university"](area.mauritius);
  node["amenity"="place_of_worship"](area.mauritius);
  way["amenity"="place_of_worship"](area.mauritius);
  node["amenity"="restaurant"](area.mauritius);
  node["amenity"="cafe"](area.mauritius);
  node["amenity"="fast_food"](area.mauritius);
  node["shop"](area.mauritius);
  node["amenity"="hospital"](area.mauritius);
  node["amenity"="clinic"](area.mauritius);
  node["amenity"="pharmacy"](area.mauritius);
  node["amenity"="bank"](area.mauritius);
  node["amenity"="fuel"](area.mauritius);
  node["amenity"="police"](area.mauritius);
);
out center;
`

interface OSMElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

interface POI {
  id: string
  name: string
  type: string
  category: string
  lat: number
  lng: number
  icon: string
}

function categorize(tags: Record<string, string>): { type: string; category: string; icon: string } {
  if (tags.amenity === 'school' || tags.amenity === 'college' || tags.amenity === 'university') {
    return { type: 'education', category: tags.amenity, icon: 'school' }
  }
  if (tags.amenity === 'place_of_worship') {
    const religion = tags.religion || 'unknown'
    if (religion === 'muslim') return { type: 'worship', category: 'mosque', icon: 'mosque' }
    if (religion === 'hindu') return { type: 'worship', category: 'temple', icon: 'temple' }
    if (religion === 'christian') return { type: 'worship', category: 'church', icon: 'church' }
    return { type: 'worship', category: religion, icon: 'worship' }
  }
  if (tags.amenity === 'restaurant') return { type: 'food', category: 'restaurant', icon: 'restaurant' }
  if (tags.amenity === 'cafe') return { type: 'food', category: 'cafe', icon: 'cafe' }
  if (tags.amenity === 'fast_food') return { type: 'food', category: 'fast_food', icon: 'fastfood' }
  if (tags.shop === 'supermarket') return { type: 'shop', category: 'supermarket', icon: 'shop' }
  if (tags.shop === 'convenience') return { type: 'shop', category: 'convenience', icon: 'shop' }
  if (tags.shop) return { type: 'shop', category: tags.shop, icon: 'shop' }
  if (tags.amenity === 'hospital') return { type: 'health', category: 'hospital', icon: 'hospital' }
  if (tags.amenity === 'clinic') return { type: 'health', category: 'clinic', icon: 'clinic' }
  if (tags.amenity === 'pharmacy') return { type: 'health', category: 'pharmacy', icon: 'pharmacy' }
  if (tags.amenity === 'bank') return { type: 'finance', category: 'bank', icon: 'bank' }
  if (tags.amenity === 'fuel') return { type: 'fuel', category: 'petrol', icon: 'fuel' }
  if (tags.amenity === 'police') return { type: 'emergency', category: 'police', icon: 'police' }
  return { type: 'other', category: tags.amenity || 'unknown', icon: 'marker' }
}

// Cache the POI data for 24 hours
let cachedPOIs: POI[] | null = null
let cacheTime = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours

export async function GET() {
  try {
    // Return cached data if available and fresh
    if (cachedPOIs && Date.now() - cacheTime < CACHE_DURATION) {
      return NextResponse.json({ pois: cachedPOIs, cached: true })
    }

    console.log('Fetching Mauritius POIs from OpenStreetMap...')
    
    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(OVERPASS_QUERY)}`
    })
    
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`)
    }
    
    const data = await response.json()
    console.log(`Got ${data.elements?.length || 0} raw elements from OSM`)
    
    const pois: POI[] = []
    
    for (const el of (data.elements || []) as OSMElement[]) {
      const lat = el.lat || el.center?.lat
      const lon = el.lon || el.center?.lon
      
      if (!lat || !lon || !el.tags) continue
      
      const name = el.tags.name || el.tags['name:en'] || el.tags['name:fr'] || ''
      if (!name) continue // Skip unnamed POIs
      
      const { type, category, icon } = categorize(el.tags)
      
      pois.push({
        id: `osm-${el.type}-${el.id}`,
        name,
        type,
        category,
        lat,
        lng: lon,
        icon
      })
    }
    
    console.log(`Processed ${pois.length} named POIs`)
    
    // Cache the results
    cachedPOIs = pois
    cacheTime = Date.now()
    
    return NextResponse.json({ pois, cached: false })
  } catch (error) {
    console.error('Error fetching POIs:', error)
    // Return cached data even if stale, or empty array
    if (cachedPOIs) {
      return NextResponse.json({ pois: cachedPOIs, cached: true, stale: true })
    }
    return NextResponse.json({ pois: [], error: 'Failed to fetch POIs' }, { status: 500 })
  }
}
