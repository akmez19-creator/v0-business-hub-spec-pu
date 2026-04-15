import { generateText, Output } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const BATCH_SIZE = 100 // Process 100 products at a time

interface Product {
  id: string
  name: string
  price: number
  category: string | null
  quantity: number
  image_url: string | null
  created_at: string
}

interface SimilarGroup {
  reason: string
  product_ids: string[]
}

async function analyzeBatch(
  batchProducts: { id: string; name: string }[],
  allProductNames: { id: string; name: string }[]
): Promise<SimilarGroup[]> {
  // For each batch, we compare against ALL products to catch cross-batch duplicates
  const { output } = await generateText({
    model: 'openai/gpt-4o-mini',
    output: Output.object({
      schema: z.object({
        similar_groups: z.array(z.object({
          reason: z.string(),
          product_ids: z.array(z.string()),
        }))
      })
    }),
    prompt: `You are a product inventory expert. Find ACCIDENTAL DUPLICATES in this batch of products.

BATCH TO ANALYZE (find duplicates for these):
${batchProducts.map(p => `ID: ${p.id} | "${p.name}"`).join('\n')}

FULL PRODUCT LIST (compare batch against these):
${allProductNames.map(p => `ID: ${p.id} | "${p.name}"`).join('\n')}

WHAT COUNTS AS DUPLICATES:
- Typos: "Vaccum" vs "Vacuum", "Magnifyer" vs "Magnifier"
- Case ONLY: "CAR VISOR" vs "Car Visor", "Knife set" vs "Knife Set"
- Abbreviations: "10M Rope" vs "10 Meter Rope"
- Word order: "Cleaner Vacuum" vs "Vacuum Cleaner"

NOT DUPLICATES (SKIP THESE - they are intentional):
- Pricing variants: "Product - B1G1", "Product - SPX2", "Product - SPX3"
- Pack sizes: "1x Product", "2x Product", "3x Product"
- Size variants: "3 layer" vs "4 layer", "500ml" vs "1L"
- Different models, colors, or styles

IMPORTANT:
- Only return groups where at least one product is from the BATCH TO ANALYZE
- Each group must have 2+ products
- Return empty array if no duplicates found

Return similar_groups with: reason (brief), product_ids (array of IDs)`
  })

  return output?.similar_groups || []
}

function deduplicateGroups(allGroups: SimilarGroup[], products: Product[]): SimilarGroup[] {
  // Merge groups that share products and deduplicate
  const productToGroup = new Map<string, Set<string>>()
  
  for (const group of allGroups) {
    const groupKey = group.product_ids.sort().join(',')
    for (const id of group.product_ids) {
      if (!productToGroup.has(id)) {
        productToGroup.set(id, new Set())
      }
      productToGroup.get(id)!.add(groupKey)
    }
  }

  // Group products by their group membership
  const seenGroups = new Set<string>()
  const finalGroups: SimilarGroup[] = []

  for (const group of allGroups) {
    const key = group.product_ids.sort().join(',')
    if (seenGroups.has(key)) continue
    seenGroups.add(key)
    
    // Verify all products exist
    const validIds = group.product_ids.filter(id => 
      products.some(p => p.id === id)
    )
    
    if (validIds.length >= 2) {
      finalGroups.push({
        reason: group.reason,
        product_ids: validIds
      })
    }
  }

  return finalGroups
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    
    // Fetch all products
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, price, category, quantity, image_url, created_at')
      .order('name')
    
    if (error || !products) {
      return Response.json({ error: 'Failed to fetch products' }, { status: 500 })
    }

    if (products.length < 2) {
      return Response.json({ groups: [], stats: { total: products.length, batches: 0 } })
    }

    const productNames = products.map(p => ({ id: p.id, name: p.name }))
    const totalBatches = Math.ceil(products.length / BATCH_SIZE)
    
    console.log(`[v0] Processing ${products.length} products in ${totalBatches} batches`)

    // Process in batches
    const allGroups: SimilarGroup[] = []
    
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batchProducts = productNames.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1
      
      console.log(`[v0] Processing batch ${batchNumber}/${totalBatches} (${batchProducts.length} products)`)
      
      try {
        const batchGroups = await analyzeBatch(batchProducts, productNames)
        allGroups.push(...batchGroups)
      } catch (batchError) {
        console.error(`[v0] Batch ${batchNumber} failed:`, batchError)
        // Continue with other batches
      }
    }

    console.log(`[v0] Found ${allGroups.length} potential groups before deduplication`)

    // Deduplicate and merge groups
    const uniqueGroups = deduplicateGroups(allGroups, products)

    console.log(`[v0] Final: ${uniqueGroups.length} unique duplicate groups`)

    // Build detailed groups with product information
    const detailedGroups = uniqueGroups.map(group => {
      const groupProducts = products.filter(p => group.product_ids.includes(p.id))
      return {
        reason: group.reason,
        count: groupProducts.length,
        ids: groupProducts.map(p => p.id),
        name_variants: groupProducts.map(p => p.name),
        products: groupProducts
      }
    }).filter(group => group.products.length >= 2)

    return Response.json({ 
      groups: detailedGroups,
      stats: {
        total: products.length,
        batches: totalBatches,
        groupsFound: detailedGroups.length
      }
    })
  } catch (error) {
    console.error('AI similarity detection error:', error)
    return Response.json({ error: 'AI analysis failed' }, { status: 500 })
  }
}
