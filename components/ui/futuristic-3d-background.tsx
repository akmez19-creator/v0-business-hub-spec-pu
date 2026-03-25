'use client'

export default function Futuristic3DBackground() {
  return (
    <div className="absolute inset-0 z-0 bg-black">
      {/* Pure black base */}
      <div className="absolute inset-0 bg-black" />
      
      {/* Very subtle cyan ambient glow - static, not animated */}
      <div className="absolute top-0 right-0 w-[500px] h-[300px] bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.06),transparent_70%)]" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[250px] bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.04),transparent_70%)]" />
      
      {/* Perspective grid floor - static spatial effect */}
      <div 
        className="absolute inset-x-0 bottom-0 h-[45%] opacity-[0.06]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(6,182,212,0.6) 1px, transparent 1px),
            linear-gradient(90deg, rgba(6,182,212,0.6) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
          transform: 'perspective(400px) rotateX(65deg)',
          transformOrigin: 'bottom',
          maskImage: 'linear-gradient(to top, black 20%, transparent 100%)'
        }}
      />
      
      {/* Tiny static stars/dots for depth */}
      <div className="absolute top-[12%] left-[18%] w-1 h-1 rounded-full bg-white/15" />
      <div className="absolute top-[22%] right-[12%] w-0.5 h-0.5 rounded-full bg-cyan-400/25" />
      <div className="absolute top-[35%] left-[8%] w-0.5 h-0.5 rounded-full bg-white/10" />
      <div className="absolute top-[18%] right-[30%] w-0.5 h-0.5 rounded-full bg-white/12" />
      <div className="absolute top-[45%] right-[8%] w-1 h-1 rounded-full bg-cyan-400/15" />
      <div className="absolute top-[28%] left-[40%] w-0.5 h-0.5 rounded-full bg-white/8" />
      <div className="absolute top-[55%] left-[15%] w-0.5 h-0.5 rounded-full bg-cyan-400/12" />
      <div className="absolute top-[8%] left-[55%] w-1 h-1 rounded-full bg-white/10" />
      
      {/* Subtle vignette for depth */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 120px 40px rgba(0,0,0,0.7)' }} />
    </div>
  )
}
