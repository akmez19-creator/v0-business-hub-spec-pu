import { NextResponse } from 'next/server'

// Mauritius region coordinates for weather lookup
const MAURITIUS_REGIONS: Record<string, { lat: number; lng: number }> = {
  'Port Louis': { lat: -20.1609, lng: 57.5012 },
  'Curepipe': { lat: -20.3163, lng: 57.5236 },
  'Quatre Bornes': { lat: -20.2674, lng: 57.4791 },
  'Vacoas': { lat: -20.2981, lng: 57.4781 },
  'Rose Hill': { lat: -20.2455, lng: 57.4684 },
  'Beau Bassin': { lat: -20.2282, lng: 57.4684 },
  'Mahebourg': { lat: -20.4081, lng: 57.7000 },
  'Flacq': { lat: -20.1919, lng: 57.7142 },
  'Goodlands': { lat: -20.0363, lng: 57.6503 },
  'Triolet': { lat: -20.0574, lng: 57.5489 },
  'Moka': { lat: -20.2199, lng: 57.4960 },
  'Pamplemousses': { lat: -20.1012, lng: 57.5756 },
  'Grand Baie': { lat: -20.0129, lng: 57.5801 },
  'Flic en Flac': { lat: -20.2737, lng: 57.3687 },
  'Tamarin': { lat: -20.3259, lng: 57.3696 },
  'Wooton': { lat: -20.3281, lng: 57.5189 },
  'La Marie': { lat: -20.3052, lng: 57.5056 },
}

// WMO weather code to condition mapping
function weatherCodeToCondition(code: number): { condition: string; icon: string; isRain: boolean; isSnow: boolean; isFog: boolean; isCloudy: boolean; isThunder: boolean } {
  if (code === 0) return { condition: 'Clear', icon: '☀️', isRain: false, isSnow: false, isFog: false, isCloudy: false, isThunder: false }
  if (code <= 3) return { condition: 'Cloudy', icon: '⛅', isRain: false, isSnow: false, isFog: false, isCloudy: true, isThunder: false }
  if (code <= 48) return { condition: 'Foggy', icon: '🌫️', isRain: false, isSnow: false, isFog: true, isCloudy: true, isThunder: false }
  if (code <= 57) return { condition: 'Drizzle', icon: '🌦️', isRain: true, isSnow: false, isFog: false, isCloudy: true, isThunder: false }
  if (code <= 67) return { condition: 'Rain', icon: '🌧️', isRain: true, isSnow: false, isFog: false, isCloudy: true, isThunder: false }
  if (code <= 77) return { condition: 'Snow', icon: '🌨️', isRain: false, isSnow: true, isFog: false, isCloudy: true, isThunder: false }
  if (code <= 82) return { condition: 'Heavy Rain', icon: '⛈️', isRain: true, isSnow: false, isFog: false, isCloudy: true, isThunder: false }
  if (code <= 86) return { condition: 'Snow Showers', icon: '🌨️', isRain: false, isSnow: true, isFog: false, isCloudy: true, isThunder: false }
  if (code <= 99) return { condition: 'Thunderstorm', icon: '⛈️', isRain: true, isSnow: false, isFog: false, isCloudy: true, isThunder: true }
  return { condition: 'Unknown', icon: '🌡️', isRain: false, isSnow: false, isFog: false, isCloudy: false, isThunder: false }
}

export async function GET() {
  try {
    // Mauritius center coordinates for main weather
    const mainLat = -20.2
    const mainLng = 57.5

    // Fetch current weather from Open-Meteo (free, no API key)
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${mainLat}&longitude=${mainLng}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,apparent_temperature,is_day,cloud_cover,precipitation&timezone=Indian/Mauritius`

    const res = await fetch(url, { next: { revalidate: 600 } }) // cache 10min
    const data = await res.json()

    const current = data.current
    const weatherInfo = weatherCodeToCondition(current.weather_code)

    // Determine Mapbox light preset based on actual time
    const mauritiusHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Indian/Mauritius' })).getHours()
    let lightPreset: string
    if (mauritiusHour >= 6 && mauritiusHour < 8) lightPreset = 'dawn'
    else if (mauritiusHour >= 8 && mauritiusHour < 17) lightPreset = 'day'
    else if (mauritiusHour >= 17 && mauritiusHour < 19) lightPreset = 'dusk'
    else lightPreset = 'night'

    // Fetch weather for all regions (batch coordinates)
    const regionEntries = Object.entries(MAURITIUS_REGIONS)
    const lats = regionEntries.map(([, r]) => r.lat).join(',')
    const lngs = regionEntries.map(([, r]) => r.lng).join(',')

    const regionUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,precipitation&timezone=Indian/Mauritius`
    const regionRes = await fetch(regionUrl, { next: { revalidate: 600 } })
    const regionData = await regionRes.json()

    // Build per-region weather data
    const regions: Record<string, any> = {}
    regionEntries.forEach(([name, coords], i) => {
      const rd = Array.isArray(regionData) ? regionData[i] : regionData
      const rc = rd?.current || current
      const rw = weatherCodeToCondition(rc.weather_code)
      regions[name] = {
        name,
        lat: coords.lat,
        lng: coords.lng,
        temperature: rc.temperature_2m,
        humidity: rc.relative_humidity_2m,
        windSpeed: rc.wind_speed_10m,
        precipitation: rc.precipitation || 0,
        weatherCode: rc.weather_code,
        ...rw,
      }
    })

    return NextResponse.json({
      // Main weather
      temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      windDirection: current.wind_direction_10m,
      cloudCover: current.cloud_cover,
      precipitation: current.precipitation,
      isDay: current.is_day === 1,
      weatherCode: current.weather_code,
      ...weatherInfo,
      lightPreset,
      mauritiusHour,
      // Per-region
      regions,
    })
  } catch (error) {
    console.error('Weather API error:', error)
    return NextResponse.json({
      temperature: 25,
      condition: 'Clear',
      icon: '☀️',
      isRain: false,
      isSnow: false,
      isFog: false,
      isCloudy: false,
      isThunder: false,
      lightPreset: 'day',
      mauritiusHour: 12,
      regions: {},
    })
  }
}
