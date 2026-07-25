import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'

// The cat's brain: turns a snapshot of the entire TV wall (spend, zones,
// breaking-news items, riders vs targets, recent edits) into a short punchy
// briefing paragraph with emojis. Called when the cat is clicked and
// auto-refreshed every 30 minutes by the TV dashboard.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const snapshot = await request.json()

    const { text } = await generateText({
      model: 'openai/gpt-5.4-mini',
      system:
        'You are the playful robot cat mascot of a Mauritius delivery company ads-operations TV wall. ' +
        'You brief the team on the state of the ads dashboard so it reads at a glance on a TV.\n\n' +
        'OUTPUT FORMAT - follow exactly, it is parsed by the UI:\n' +
        '- PLAIN TEXT ONLY. Absolutely no markdown: no asterisks, no **bold**, no #, no bullets with * or -.\n' +
        '- Write 3 to 5 short sections. Each section = one line "[emoji] TITLE" (title 1-3 words, uppercase), ' +
        'then 1-3 short sentences on the following lines. Blank line between sections.\n' +
        '- Suggested sections: THE DAY (overall read), WINNERS (best cost/client), PROBLEMS (red zone, ' +
        'no-client spenders, stalled), RIDERS (targets), DO NOW (2-4 concrete actions, one per line, ' +
        'each starting with an emoji).\n' +
        '- Keep every sentence under ~14 words. Total under 160 words.\n\n' +
        'CONTEXT: Money is Mauritian Rupees, written like "Rs 118". Cost/client zones: green under Rs 50 ' +
        '(scale these up!), amber Rs 51-75 (watch), red above Rs 75 (fix or kill). Breaking items are products ' +
        'still needing a budget edit today. Riders have daily client targets. Be specific: name the actual ' +
        'products and riders from the data, cite their numbers. A light cat pun is welcome, never overdone. ' +
        'Never invent data not in the snapshot.',
      prompt:
        'Here is the current wall snapshot as JSON. Give the team your briefing:\n\n' +
        JSON.stringify(snapshot).slice(0, 24000),
    })

    // Safety net: strip any markdown the model sneaks in so the TV never
    // shows raw asterisks or heading hashes
    const clean = text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#{1,4}\s*/gm, '')
      .replace(/^[-*]\s+/gm, '')

    return NextResponse.json({ success: true, briefing: clean, generatedAt: new Date().toISOString() })
  } catch (error) {
    console.error('ai-briefing error:', error)
    return NextResponse.json({ success: false, error: 'Briefing failed' }, { status: 500 })
  }
}
