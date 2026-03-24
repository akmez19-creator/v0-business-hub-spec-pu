import { generateText, Output } from 'ai'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

const nicSchema = z.object({
  surname: z.string().nullable(),
  firstName: z.string().nullable(),
  surnameAtBirth: z.string().nullable(),
  gender: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  idNumber: z.string().nullable(),
})

export async function POST(request: NextRequest) {
  try {
    const { imageUrl } = await request.json()

    if (!imageUrl) {
      return NextResponse.json({ error: 'No image URL provided' }, { status: 400 })
    }

    const result = await generateText({
      model: 'openai/gpt-4o',
      output: Output.object({ schema: nicSchema }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are an OCR system that extracts data from Republic of Mauritius National Identity Cards.

Extract the following fields from this NIC card image:
- surname: The person's surname (family name)
- firstName: The person's first name(s)
- surnameAtBirth: The surname at birth (if visible, otherwise null)
- gender: "M" or "F"
- dateOfBirth: In format "DD MMM YYYY" (e.g. "03 Aug 2001")
- idNumber: The full ID number (e.g. "S0308012908207")

Return ONLY the extracted data as JSON. If a field is not readable, return null for it.`,
            },
            {
              type: 'image',
              image: imageUrl,
            },
          ],
        },
      ],
    })

    return NextResponse.json({
      data: result.output,
    })
  } catch (error) {
    console.error('NIC scan error:', error)
    return NextResponse.json({ error: 'Failed to scan NIC card' }, { status: 500 })
  }
}
