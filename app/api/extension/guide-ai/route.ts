import { createOpenAI } from '@ai-sdk/openai'
import { generateText, Output } from 'ai'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Do NOT use the edge runtime with the AI SDK.
export const runtime = 'nodejs'

/**
 * The project's own OpenAI key, exactly as /api/extension/ai-reply does.
 *
 * The AI Gateway is not usable on this account - it answers with "free tier"
 * rate-limit rejections - so routing this through the gateway would make the
 * guide fail intermittently for no visible reason. Keep this in step with
 * ai-reply and inbox/ai-assist.
 */
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Refresh-Token',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

/** Validate the extension's bearer token. Mirrors the other extension routes. */
async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const accessToken = authHeader.replace('Bearer ', '')

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const {
    data: { user },
    error,
  } = await adminSupabase.auth.getUser(accessToken)
  if (error || !user) return null
  return { user, supabase: adminSupabase }
}

/**
 * One interactive control on the page, as seen by the content script.
 *
 * `i` is the index into the content script's own element map. The model never
 * sees selectors or markup - it picks a control by index, and the content
 * script resolves that back to the real element. That keeps the model unable
 * to invent a selector that matches nothing.
 */
interface PageElement {
  i: number
  tag?: string
  role?: string
  text?: string
  hint?: string
}

const Plan = z.object({
  answer: z.string().describe('One or two sentences answering the user, in plain English.'),
  steps: z
    .array(
      z.object({
        title: z.string().describe('Short imperative instruction, e.g. "Click Add to cart".'),
        why: z.string().describe('One-line reason or warning. Use an empty string if there is nothing to add.'),
        target: z
          .number()
          .nullable()
          .describe('Index i of the control from the ELEMENTS list, or null if no control applies.'),
        action: z
          .enum(['click', 'fill', 'look'])
          .describe('click = press it, fill = type into it, look = just point at it.'),
        value: z.string().describe('Text to type when action is fill, otherwise an empty string.'),
      }),
    )
    .max(8),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await getUserFromToken(request)
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401, headers: corsHeaders },
      )
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'AI is not configured on the server.' },
        { status: 500, headers: corsHeaders },
      )
    }

    const body = await request.json()
    const question: string = typeof body.question === 'string' ? body.question.trim().slice(0, 400) : ''
    const url: string = typeof body.url === 'string' ? body.url.slice(0, 300) : ''
    const title: string = typeof body.title === 'string' ? body.title.slice(0, 200) : ''
    const pageText: string = typeof body.pageText === 'string' ? body.pageText.slice(0, 3000) : ''
    const rawElements: PageElement[] = Array.isArray(body.elements) ? body.elements : []

    // Earlier turns of this conversation, oldest first. The client already
    // trims this, but it arrives from an extension on an arbitrary page, so
    // cap it again here rather than trusting the caller with prompt size.
    const history: { role: 'user' | 'assistant'; content: string }[] = (
      Array.isArray(body.history) ? body.history : []
    )
      .slice(-8)
      .map((m: { role?: unknown; content?: unknown }) => ({
        role: m?.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: typeof m?.content === 'string' ? m.content.slice(0, 700) : '',
      }))
      .filter((m: { content: string }) => m.content.length > 0)

    if (!question) {
      return NextResponse.json(
        { success: false, error: 'Ask a question first.' },
        { status: 400, headers: corsHeaders },
      )
    }

    // Cap the element list. A busy page can expose thousands of controls, and an
    // unbounded prompt is both slow and expensive.
    const elements = rawElements.slice(0, 120).map(e => ({
      i: Number(e.i),
      tag: String(e.tag || '').slice(0, 12),
      role: String(e.role || '').slice(0, 16),
      text: String(e.text || '').slice(0, 70),
      hint: String(e.hint || '').slice(0, 70),
    }))

    const elementList = elements
      .map(e => `${e.i}. <${e.tag}${e.role ? ` role=${e.role}` : ''}> "${e.text}"${e.hint ? ` (${e.hint})` : ''}`)
      .join('\n')

    const system = [
      'You are an on-page browser co-pilot for a Mauritian retail and import business (Akmez).',
      'The user is looking at the web page described below and wants to get something done on it.',
      'Many pages they use are in Chinese (1688.com, Alibaba) - always answer in ENGLISH and explain what the Chinese labels mean.',
      '',
      'You are given a numbered list of the interactive controls that are currently VISIBLE on the page.',
      'Return a short ordered plan. For every step that involves a control, set "target" to that control\'s number from the list.',
      'Only use numbers that appear in the list. If no control fits a step, set target to null and explain in the title.',
      'Use action "click" to press a control, "fill" to type into an input (put the text in "value"), and "look" to simply point at something.',
      'Prefer 2-5 steps. Be concrete and specific to THIS page - never give generic advice like "find the button".',
      'If the page does not let the user do what they asked, say so plainly in "answer" and return no steps.',
      '',
      'This is an ongoing conversation. If earlier turns are supplied, treat the new question as a follow-up:',
      'resolve references like "that one", "and then?" or "do the second instead" against what was already said.',
      'The user may have navigated since - the ELEMENTS list is always the page in front of them right now,',
      'so never point at a control just because it existed earlier in the conversation.',
    ].join('\n')

    const prompt = [
      `PAGE TITLE: ${title}`,
      `PAGE URL: ${url}`,
      '',
      'ELEMENTS (number. tag "visible text" (extra hint)):',
      elementList || '(no interactive controls detected)',
      '',
      pageText ? `PAGE TEXT EXCERPT:\n${pageText}` : '',
      '',
      // The conversation so far, so a follow-up like "and then?" or "do the
      // second one instead" resolves against what was already said. The page
      // context above is always current, so an older turn never overrides
      // what is actually on screen right now.
      history.length
        ? `CONVERSATION SO FAR (oldest first):\n${history
            .map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`)
            .join('\n')}`
        : '',
      '',
      `USER NOW ASKS: ${question}`,
    ]
      .filter(Boolean)
      .join('\n')

    const { output } = await generateText({
      model: openai('gpt-4.1'),
      maxRetries: 1,
      system,
      prompt,
      output: Output.object({ schema: Plan }),
    })
    const plan = output as z.infer<typeof Plan>

    // Drop any step pointing at a control the content script never sent: the
    // model occasionally invents an index, and spotlighting the wrong element
    // is worse than showing one step fewer.
    const valid = new Set(elements.map(e => e.i))
    const steps = (plan?.steps || []).filter(s => s.target === null || valid.has(Number(s.target)))

    return NextResponse.json({ success: true, answer: plan?.answer || '', steps }, { headers: corsHeaders })
  } catch (error) {
    console.error('[v0] guide-ai error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error)?.message || 'AI request failed' },
      { status: 500, headers: corsHeaders },
    )
  }
}
