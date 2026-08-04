import { resolveImageBytes } from '../lib/product-master/poster-engine.ts'
import { scoreProductImage, weightedTotal, qualityLabel } from '../lib/product-master/image-quality.ts'

const imgs = [
  ['PNG (Car Restorer Cream)', 'https://jipgjluquclfetldetzd.supabase.co/storage/v1/object/public/product-images/1776323047352-0u0zg59zdejl.png'],
  ['SVG-wrapped (Car Brush)', 'https://jipgjluquclfetldetzd.supabase.co/storage/v1/object/public/product-images/1776263377683-pb3x6ec8ck.svg+xml'],
]

// pure-function sanity first
console.log('weightedTotal all-10 =', weightedTotal({ clarity: 10, framing: 10, lighting: 10, background: 10, textFree: 10 }), '(expect 100)')
console.log('weightedTotal all-0  =', weightedTotal({ clarity: 0, framing: 0, lighting: 0, background: 0, textFree: 0 }), '(expect 0)')
console.log('textFree=0 else 10   =', weightedTotal({ clarity: 10, framing: 10, lighting: 10, background: 10, textFree: 0 }), '(expect 76, foreign text is heavily penalised)')
console.log('label(82)=', qualityLabel(82), ' label(30)=', qualityLabel(30))
console.log()

for (const [label, url] of imgs) {
  try {
    const bytes = await resolveImageBytes(url)
    console.log(`${label}: decoded ${bytes.length} bytes`)
    const v = await scoreProductImage(bytes)
    console.log(`  scores:`, JSON.stringify(v.scores))
    console.log(`  total: ${v.total}/100 (${qualityLabel(v.total)})`)
    console.log(`  reason: ${v.reason}`)
  } catch (e) {
    console.log(`${label}: ERROR -> ${e instanceof Error ? e.message : e}`)
  }
  console.log()
}
