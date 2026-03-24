import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function toSlug(name) {
  return name.toLowerCase().trim()
    .replace(/['']/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function main() {
  const { data: localities } = await supabase
    .from('localities')
    .select('name')
    .eq('is_active', true)
    .order('name')

  const imgDir = path.join(process.cwd(), 'public', 'images', 'regions')
  const existingFiles = new Set(fs.readdirSync(imgDir).map(f => f.replace('.jpg', '')))

  const missing = []
  for (const loc of localities) {
    const slug = toSlug(loc.name)
    if (!existingFiles.has(slug)) {
      missing.push({ name: loc.name, slug })
    }
  }

  console.log(`Total localities: ${localities.length}`)
  console.log(`Existing images: ${existingFiles.size}`)
  console.log(`Missing: ${missing.length}`)
  console.log('---MISSING---')
  for (const m of missing) {
    console.log(`${m.name}|${m.slug}`)
  }
}

main()
