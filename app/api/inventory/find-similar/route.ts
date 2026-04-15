import { generateText, Output } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

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
      return Response.json({ groups: [] })
    }

    // Create a list of product names for AI analysis
    const productNames = products.map(p => ({ id: p.id, name: p.name }))

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
      prompt: `You are a product inventory expert. Analyze the following product names and find groups of products that are likely ACCIDENTAL DUPLICATES (same product entered multiple times with different spelling) due to:
- Typos (e.g., "Vaccum" vs "Vacuum")
- Case differences ONLY (e.g., "CAR VISOR" vs "Car Visor", "Knife set" vs "Knife Set")
- Spelling mistakes (e.g., "Magnifyer" vs "Magnifier")
- Abbreviations that mean the same thing (e.g., "10M Rope" vs "10 Meter Rope")
- Word order swaps (e.g., "Cleaner Vacuum" vs "Vacuum Cleaner")

CRITICAL - DO NOT group these as duplicates (they are INTENTIONAL VARIANTS):
- Products with pricing suffixes like "- B1G1", "- SPX2", "- SPX3" (these are Buy 1 Get 1, Special Price offers)
- Products with quantity prefixes like "1x", "2x", "3x" (these are different pack sizes)
- Different sizes (e.g., "3 layer" vs "4 layer", "500ml" vs "1L")
- Different colors or styles
- Different product models

Return ONLY groups with 2 or more similar products. If no similar products found, return an empty array.

Product list:
${productNames.map(p => `ID: ${p.id} | Name: "${p.name}"`).join('\n')}

Return the similar_groups array where each group contains:
- reason: Brief explanation of why these are duplicates
- product_ids: Array of product IDs that are similar`
    })

    if (!output || !output.similar_groups) {
      return Response.json({ groups: [] })
    }

    // Build detailed groups with product information
    const detailedGroups = output.similar_groups
      .filter(group => group.product_ids.length >= 2)
      .map(group => {
        const groupProducts = products.filter(p => group.product_ids.includes(p.id))
        return {
          reason: group.reason,
          count: groupProducts.length,
          ids: groupProducts.map(p => p.id),
          name_variants: groupProducts.map(p => p.name),
          products: groupProducts
        }
      })
      .filter(group => group.products.length >= 2)

    return Response.json({ groups: detailedGroups })
  } catch (error) {
    console.error('AI similarity detection error:', error)
    return Response.json({ error: 'AI analysis failed' }, { status: 500 })
  }
}
