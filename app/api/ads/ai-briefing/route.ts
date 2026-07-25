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
        'You brief the team on the state of the ads dashboard in ONE energetic paragraph (120-180 words) ' +
        'followed by a short list of the 2-4 most urgent actions. Use plenty of fitting emojis. ' +
        'Money is Mauritian Rupees, written like "Rs 118". Cost/client zones: green under Rs 50 (scale these up!), ' +
        'amber Rs 51-75 (watch), red above Rs 75 (fix or kill). Breaking items are products still needing a budget ' +
        'edit today. Riders have daily client targets. Be specific: name the actual products and riders from the ' +
        'data, cite their numbers. Speak with cat personality (a "meow" or paw pun here and there, never overdone). ' +
        'Never invent data not in the snapshot.',
      prompt:
        'Here is the current wall snapshot as JSON. Give the team your briefing:\n\n' +
        JSON.stringify(snapshot).slice(0, 24000),
    })

    return NextResponse.json({ success: true, briefing: text, generatedAt: new Date().toISOString() })
  } catch (error) {
    console.error('ai-briefing error:', error)
    return NextResponse.json({ success: false, error: 'Briefing failed' }, { status: 500 })
  }
}
