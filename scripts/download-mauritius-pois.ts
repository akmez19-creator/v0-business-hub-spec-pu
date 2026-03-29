// Script to download POI data from OpenStreetMap for Mauritius
// Run with: npx ts-node scripts/download-mauritius-pois.ts

const OVERPASS_API = 'https://overpass-api.de/api/interpreter'

// Mauritius bounding box
const BBOX = '-20.5257,-57.3076,-19.9696,57.7965' // south,west,north,east

// Query for common POIs in Mauritius
const OVERPASS_QUERY = `
[out:json][timeout:300];
area["ISO3166-1"="MU"]->.mauritius;
(
  // Education
  node["amenity"="school"](area.mauritius);
  way["amenity"="school"](area.mauritius);
  node["amenity"="college"](area.mauritius);
  node["amenity"="university"](area.mauritius);
  
  // Religious
  node["amenity"="place_of_worship"](area.mauritius);
  way["amenity"="place_of_worship"](area.mauritius);
  
  // Food & Shopping
  node["amenity"="restaurant"](area.mauritius);
  node["amenity"="cafe"](area.mauritius);
  node["amenity"="fast_food"](area.mauritius);
  node["shop"](area.mauritius);
  
  // Health
  node["amenity"="hospital"](area.mauritius);
  node["amenity"="clinic"](area.mauritius);
  node["amenity"="pharmacy"](area.mauritius);
  
  // Services
  node["amenity"="bank"](area.mauritius);
  node["amenity"="atm"](area.mauritius);
  node["amenity"="post_office"](area.mauritius);
  node["amenity"="police"](area.mauritius);
  node["amenity"="fuel"](area.mauritius);
  
  // Transport
  node["amenity"="bus_station"](area.mauritius);
  node["public_transport"="station"](area.mauritius);
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
}

function categorize(tags: Record<string, string>): { type: string; category: string } {
  if (tags.amenity === 'school' || tags.amenity === 'college' || tags.amenity === 'university') {
    return { type: 'education', category: tags.amenity }
  }
  if (tags.amenity === 'place_of_worship') {
    const religion = tags.religion || 'unknown'
    return { type: 'worship', category: religion }
  }
  if (tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'fast_food') {
    return { type: 'food', category: tags.amenity }
  }
  if (tags.shop) {
    return { type: 'shop', category: tags.shop }
  }
  if (tags.amenity === 'hospital' || tags.amenity === 'clinic' || tags.amenity === 'pharmacy') {
    return { type: 'health', category: tags.amenity }
  }
  if (tags.amenity === 'bank' || tags.amenity === 'atm') {
    return { type: 'finance', category: tags.amenity }
  }
  if (tags.amenity === 'fuel') {
    return { type: 'fuel', category: 'petrol_station' }
  }
  if (tags.amenity === 'police') {
    return { type: 'emergency', category: 'police' }
  }
  if (tags.amenity === 'post_office') {
    return { type: 'services', category: 'post_office' }
  }
  if (tags.amenity === 'bus_station' || tags.public_transport) {
    return { type: 'transport', category: 'bus_station' }
  }
  return { type: 'other', category: tags.amenity || 'unknown' }
}

async function downloadPOIs() {
  console.log('Downloading Mauritius POIs from OpenStreetMap...')
  
  const response = await fetch(OVERPASS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(OVERPASS_QUERY)}`
  })
  
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`)
  }
  
  const data = await response.json()
  console.log(`Got ${data.elements.length} raw elements`)
  
  const pois: POI[] = []
  
  for (const el of data.elements as OSMElement[]) {
    const lat = el.lat || el.center?.lat
    const lon = el.lon || el.center?.lon
    
    if (!lat || !lon || !el.tags) continue
    
    const name = el.tags.name || el.tags['name:en'] || el.tags['name:fr'] || ''
    if (!name) continue // Skip unnamed POIs
    
    const { type, category } = categorize(el.tags)
    
    pois.push({
      id: `osm-${el.type}-${el.id}`,
      name,
      type,
      category,
      lat,
      lng: lon
    })
  }
  
  console.log(`Processed ${pois.length} named POIs`)
  
  // Group by type for stats
  const byType = pois.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  console.log('POIs by type:', byType)
  
  return pois
}

// Export for use
export { downloadPOIs, type POI }

// Run if executed directly
if (require.main === module) {
  downloadPOIs()
    .then(pois => {
      console.log(JSON.stringify(pois, null, 2))
    })
    .catch(console.error)
}
