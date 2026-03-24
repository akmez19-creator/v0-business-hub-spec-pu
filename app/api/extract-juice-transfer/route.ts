import { generateText, Output } from 'ai'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Schema for extracted MCB Juice transfer details
const transferSchema = z.object({
  transactionReference: z.string().nullable().describe('The transaction reference number (e.g., FT25342DSH15\\BNK)'),
  amount: z.number().nullable().describe('The transaction amount in MUR (absolute value, without negative sign)'),
  recipientName: z.string().nullable().describe('The recipient name or business name'),
  transactionDate: z.string().nullable().describe('The transaction date in YYYY-MM-DD format'),
  transactionType: z.string().nullable().describe('The transaction type (e.g., Outgoing, Incoming)'),
})

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('screenshot') as File

    if (!file) {
      return NextResponse.json({ error: 'No screenshot provided' }, { status: 400 })
    }

    // Convert file to Uint8Array for AI SDK
    const bytes = await file.arrayBuffer()
    const uint8Array = new Uint8Array(bytes)

    // Use AI to extract transaction details from the screenshot
    const { output } = await generateText({
      model: 'openai/gpt-4o',
      output: Output.object({ schema: transferSchema }),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: uint8Array,
              mimeType: file.type || 'image/jpeg',
            },
            {
              type: 'text',
              text: `Extract the MCB Juice transfer details from this screenshot.
              
Look for these specific fields:
1. Transaction reference - usually starts with "FT" and ends with "\\BNK" (e.g., "FT25342DSH15\\BNK")
2. Transaction amount - the MUR amount shown (e.g., "MUR -14,174.00" means 14174)
3. Recipient name - the business name after the pipe symbol (e.g., "HOT SALES MARKETING LTD")
4. Transaction date - in the format shown (convert to YYYY-MM-DD)
5. Transaction type - "Outgoing" or "Incoming"

IMPORTANT: 
- The amount MUST be a positive number. If the screen shows "MUR -14,174.00", return 14174 (not -14174).
- Remove commas from amounts: "14,174.00" becomes 14174`,
            },
          ],
        },
      ],
    })

    // Get the extracted data
    const extractedData = output
    
    if (!extractedData) {
      return NextResponse.json({
        success: true,
        data: {
          transactionReference: null,
          amount: null,
          recipientName: null,
          transactionDate: null,
          transactionType: null,
        },
      })
    }

    // Ensure amount is always positive (outgoing transfers show as negative)
    if (extractedData.amount !== null && extractedData.amount !== undefined) {
      extractedData.amount = Math.abs(extractedData.amount)
    }

    return NextResponse.json({
      success: true,
      data: extractedData,
    })
  } catch (error) {
    console.error('Error extracting transfer details:', error)
    return NextResponse.json(
      { error: 'Failed to extract transfer details' },
      { status: 500 }
    )
  }
}
