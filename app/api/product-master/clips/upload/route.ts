import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Token issuer for direct browser -> Blob uploads of Reels Studio clips.
//
// The file deliberately does NOT pass through this route. A route handler on
// Vercel caps request bodies at 4.5MB and a TikTok clip in HD is routinely
// 10-30MB, so posting the video here would fail in production while appearing
// to work on a local machine. Instead the browser asks for a short-lived
// token and streams the file straight to Blob storage.
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        // Auth is re-checked here rather than trusted from the client: this
        // callback is what actually mints write access to the blob store
        const supabase = await createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) throw new Error('Not authenticated')

        return {
          allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
          // 200MB: comfortably above a long HD reel, low enough that a runaway
          // upload cannot quietly consume the blob store
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id }),
        }
      },
      // The database row is written by the client once the upload resolves,
      // not here. This webhook never fires on localhost, so relying on it
      // would mean clips save in production and silently vanish in dev.
      onUploadCompleted: async () => {},
    })

    return NextResponse.json(json)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 400 },
    )
  }
}
