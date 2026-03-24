import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { put } from '@vercel/blob'
import * as fal from '@fal-ai/serverless-client'

// Configure fal client
fal.config({
  credentials: process.env.FAL_KEY,
})

export async function POST(req: NextRequest) {
  try {
    const { name, gender, style = 'professional' } = await req.json()

    const genderHint = gender === 'F' ? 'woman' : gender === 'M' ? 'man' : 'person'

    // Style-specific prompts
    const stylePrompts: Record<string, string> = {
      professional: `Professional corporate headshot portrait of a young Mauritian ${genderHint} named ${name || 'person'}. Clean navy blue delivery company polo shirt, warm natural smile, professional studio lighting, clean solid light grey background, shoulder-up framing, sharp focus on face, photorealistic high quality corporate ID photo style. 4k, detailed, professional photography.`,
      bleach: `Young Mauritian ${genderHint} as a Bleach anime character in Tite Kubo's art style. Sharp angular jawline, detailed eyes with highlights, bold linework. Wearing black Shinigami shihakusho with white captain's haori. Confident smirk, wind-blown hair, spiritual pressure aura background in deep blue and black. Shoulder-up portrait, anime illustration, high detail.`,
      'one-piece': `Young Mauritian ${genderHint} as a One Piece anime character in Eiichiro Oda's style. Expressive features, big confident grin, bold outlines. Wearing pirate captain outfit with open vest, arms crossed. Ocean sky background. Shoulder-up portrait, anime illustration, vibrant colors.`,
      ghibli: `Young Mauritian ${genderHint} in Studio Ghibli art style. Soft watercolor aesthetic, gentle rounded features, warm expressive eyes. Peaceful expression, casual clothing, golden hour sunlight, lush green nature background. Shoulder-up portrait, hand-painted illustration.`,
      naruto: `Young Mauritian ${genderHint} as a Naruto anime character in Kishimoto's style. Wearing Konoha headband and jonin flak jacket, determined expression. Konoha village sunset background. Shoulder-up portrait, anime illustration, warm tones.`,
    }

    const prompt = stylePrompts[style] || stylePrompts.professional

    // Generate image using Fal AI
    const result = await fal.subscribe('fal-ai/flux/schnell', {
      input: {
        prompt,
        image_size: 'square_hd',
        num_inference_steps: 4,
        num_images: 1,
      },
    }) as { images?: Array<{ url: string }> }

    const imageUrl = result.images?.[0]?.url

    if (!imageUrl) {
      console.error('[v0] No image in Fal response:', result)
      return NextResponse.json({ error: 'No image generated' }, { status: 500 })
    }

    // Download image and upload to Vercel Blob for permanent storage
    const imgRes = await fetch(imageUrl)
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer())
    const mimeType = imgRes.headers.get('content-type') || 'image/png'
    
    const safeName = (name || 'user').toLowerCase().replace(/\s+/g, '-')
    const ext = mimeType.includes('jpeg') ? 'jpg' : 'png'
    const blob = await put(
      `avatars/${safeName}-${Date.now()}.${ext}`,
      imgBuffer,
      { access: 'public', contentType: mimeType }
    )

    return NextResponse.json({ url: blob.url })
  } catch (error) {
    console.error('[v0] Avatar generation error:', error)
    return NextResponse.json({ error: 'Failed to generate avatar', detail: String(error) }, { status: 500 })
  }
}
