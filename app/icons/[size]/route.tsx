import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size } = await params
  const sizeNum = parseInt(size, 10) || 512

  return new ImageResponse(
    (
      <div
        style={{
          width: sizeNum,
          height: sizeNum,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0a1628 0%, #0f2847 100%)',
          borderRadius: sizeNum * 0.18,
        }}
      >
        <svg
          width={sizeNum * 0.7}
          height={sizeNum * 0.7}
          viewBox="0 0 100 100"
          fill="none"
        >
          {/* Truck body */}
          <rect x="10" y="35" width="50" height="35" rx="4" fill="#06b6d4" />
          {/* Truck cabin */}
          <path d="M60 45 L80 45 L80 70 L60 70 Z" fill="#0891b2" />
          <path d="M60 45 L70 30 L80 30 L80 45 Z" fill="#22d3ee" />
          {/* Window */}
          <rect x="62" y="32" width="15" height="10" rx="2" fill="#0a1628" opacity="0.6" />
          {/* Wheels */}
          <circle cx="25" cy="70" r="10" fill="#1e293b" />
          <circle cx="25" cy="70" r="6" fill="#334155" />
          <circle cx="25" cy="70" r="2" fill="#06b6d4" />
          <circle cx="70" cy="70" r="10" fill="#1e293b" />
          <circle cx="70" cy="70" r="6" fill="#334155" />
          <circle cx="70" cy="70" r="2" fill="#06b6d4" />
          {/* Boxes */}
          <rect x="15" y="40" width="12" height="12" rx="2" fill="#f59e0b" />
          <rect x="30" y="43" width="10" height="10" rx="2" fill="#10b981" />
          <rect x="43" y="38" width="14" height="14" rx="2" fill="#8b5cf6" />
        </svg>
      </div>
    ),
    {
      width: sizeNum,
      height: sizeNum,
    }
  )
}
