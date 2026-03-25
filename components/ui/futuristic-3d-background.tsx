'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef, useMemo, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Float } from '@react-three/drei'

// Smooth spatial tracking for iPhone-like parallax
function useSpatialTracking() {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const targetPos = useRef({ x: 0, y: 0 })
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      targetPos.current.x = (e.clientX / window.innerWidth - 0.5) * 2
      targetPos.current.y = (e.clientY / window.innerHeight - 0.5) * 2
    }
    
    const handleDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma !== null && e.beta !== null) {
        targetPos.current.x = Math.max(-1, Math.min(1, (e.gamma || 0) / 25)) * 1.5
        targetPos.current.y = Math.max(-1, Math.min(1, ((e.beta || 0) - 45) / 25)) * 1.5
      }
    }
    
    // Smooth animation loop
    let animationId: number
    const animate = () => {
      setPosition(prev => ({
        x: prev.x + (targetPos.current.x - prev.x) * 0.08,
        y: prev.y + (targetPos.current.y - prev.y) * 0.08
      }))
      animationId = requestAnimationFrame(animate)
    }
    animate()
    
    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    window.addEventListener('deviceorientation', handleDeviceOrientation, { passive: true })
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('deviceorientation', handleDeviceOrientation)
      cancelAnimationFrame(animationId)
    }
  }, [])
  
  return position
}

// Smooth camera following
function SpatialCamera({ pos }: { pos: { x: number; y: number } }) {
  const { camera } = useThree()
  
  useFrame(() => {
    camera.position.x += (pos.x * 2.5 - camera.position.x) * 0.05
    camera.position.y += (1 + pos.y * -1.2 - camera.position.y) * 0.05
    camera.lookAt(pos.x * -0.5, pos.y * 0.2, 0)
  })
  
  return null
}

// Optimized glass material using standard material with transparency
function GlassMaterial({ color = '#083344' }: { color?: string }) {
  return (
    <meshPhysicalMaterial
      color={color}
      transparent
      opacity={0.4}
      roughness={0.05}
      metalness={0.1}
      clearcoat={1}
      clearcoatRoughness={0.1}
      envMapIntensity={1}
      ior={1.5}
      thickness={1}
      transmission={0.9}
    />
  )
}

// Central glass sphere with smooth morph
function CentralGlobe({ pos }: { pos: { x: number; y: number } }) {
  const meshRef = useRef<THREE.Mesh>(null)
  
  useFrame((state) => {
    if (meshRef.current) {
      const t = state.clock.elapsedTime
      meshRef.current.rotation.x = t * 0.1 + pos.y * 0.3
      meshRef.current.rotation.y = t * 0.15 + pos.x * 0.3
      meshRef.current.position.x = pos.x * -1.5
      meshRef.current.position.y = pos.y * 0.8
      meshRef.current.scale.setScalar(2 + Math.sin(t * 0.5) * 0.1)
    }
  })

  return (
    <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.3}>
      <mesh ref={meshRef} position={[0, 0, -3]}>
        <icosahedronGeometry args={[1, 3]} />
        <GlassMaterial color="#0c4a6e" />
      </mesh>
    </Float>
  )
}

// Floating orbs at different depths
function FloatingOrbs({ pos }: { pos: { x: number; y: number } }) {
  const groupRef = useRef<THREE.Group>(null)
  
  const orbs = useMemo(() => 
    Array.from({ length: 8 }, (_, i) => ({
      pos: [
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 10,
        -3 - Math.random() * 12
      ] as [number, number, number],
      scale: 0.3 + Math.random() * 0.6,
      speed: 0.1 + Math.random() * 0.2,
      offset: Math.random() * Math.PI * 2,
      depth: 0.3 + Math.random() * 0.7
    })), [])

  useFrame((state) => {
    if (groupRef.current) {
      const t = state.clock.elapsedTime
      groupRef.current.children.forEach((child, i) => {
        const orb = orbs[i]
        child.position.y = orb.pos[1] + Math.sin(t * orb.speed + orb.offset) * 1.5
        child.position.x = orb.pos[0] + pos.x * orb.depth * -2
        child.rotation.x = t * 0.1
        child.rotation.z = t * 0.15
      })
    }
  })

  return (
    <group ref={groupRef}>
      {orbs.map((orb, i) => (
        <mesh key={i} position={orb.pos} scale={orb.scale}>
          <sphereGeometry args={[1, 24, 24]} />
          <GlassMaterial color="#164e63" />
        </mesh>
      ))}
    </group>
  )
}

// Animated rings
function GlassRings({ pos }: { pos: { x: number; y: number } }) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (groupRef.current) {
      const t = state.clock.elapsedTime
      groupRef.current.rotation.z = t * 0.1
      groupRef.current.rotation.x = pos.y * 0.3
      groupRef.current.rotation.y = pos.x * 0.3
      groupRef.current.position.x = -6 + pos.x * -2
      groupRef.current.position.y = pos.y * 0.8
    }
  })

  return (
    <group ref={groupRef} position={[-6, 0, -6]}>
      {[2.5, 3.5, 4.5].map((r, i) => (
        <mesh key={i} rotation={[i * 0.5, i * 0.3, i * 0.2]}>
          <torusGeometry args={[r, 0.08, 16, 64]} />
          <GlassMaterial color="#22d3ee" />
        </mesh>
      ))}
    </group>
  )
}

// Optimized particles using instanced mesh
function Particles({ pos }: { pos: { x: number; y: number } }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const count = 200
  
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      pos: [
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 30 - 5
      ],
      speed: 0.2 + Math.random() * 0.5,
      offset: Math.random() * Math.PI * 2,
      depth: 0.2 + Math.random() * 0.8
    }))
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state) => {
    if (meshRef.current) {
      const t = state.clock.elapsedTime
      particles.forEach((p, i) => {
        dummy.position.set(
          p.pos[0] + pos.x * p.depth * -1.5,
          p.pos[1] + Math.sin(t * p.speed + p.offset) * 0.5 + pos.y * p.depth * 0.8,
          p.pos[2]
        )
        dummy.scale.setScalar(0.03 + p.depth * 0.04)
        dummy.updateMatrix()
        meshRef.current!.setMatrixAt(i, dummy.matrix)
      })
      meshRef.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.7} />
    </instancedMesh>
  )
}

// Grid floor
function GridFloor({ pos }: { pos: { x: number; y: number } }) {
  const gridRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (gridRef.current) {
      gridRef.current.position.x = pos.x * -0.4
      gridRef.current.position.z = pos.y * 0.3
      gridRef.current.position.y = -4 + Math.sin(state.clock.elapsedTime * 0.2) * 0.05
    }
  })

  return (
    <group ref={gridRef} position={[0, -4, 0]} rotation={[Math.PI * 0.5, 0, 0]}>
      <gridHelper args={[50, 50, '#0e7490', '#052e3d']} rotation={[Math.PI * 0.5, 0, 0]} />
    </group>
  )
}

// Lights
function Lights() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={0.6} color="#06b6d4" />
      <pointLight position={[-10, -5, -10]} intensity={0.4} color="#0891b2" />
      <pointLight position={[0, 8, 5]} intensity={0.5} color="#22d3ee" />
    </>
  )
}

function Scene({ pos }: { pos: { x: number; y: number } }) {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000508', 12, 40]} />
      <SpatialCamera pos={pos} />
      <Lights />
      <CentralGlobe pos={pos} />
      <FloatingOrbs pos={pos} />
      <GlassRings pos={pos} />
      <Particles pos={pos} />
      <GridFloor pos={pos} />
    </>
  )
}

function SceneWrapper() {
  const position = useSpatialTracking()
  return <Scene pos={position} />
}

export default function Futuristic3DBackground() {
  const [hasError, setHasError] = useState(false)
  
  return (
    <div className="absolute inset-0 z-0" style={{ backgroundColor: '#000000' }}>
      {/* Solid black base - guaranteed dark */}
      <div className="absolute inset-0" style={{ backgroundColor: '#000000' }} />
      
      {/* Dark gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0a] via-[#000000] to-[#051015]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(6,182,212,0.15),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(8,51,68,0.3),transparent_60%)]" />
      
      {/* Animated gradient orbs for depth when 3D fails */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-cyan-500/5 blur-[100px] animate-pulse" style={{ animationDuration: '4s' }} />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-blue-500/5 blur-[80px] animate-pulse" style={{ animationDuration: '6s', animationDelay: '2s' }} />
      
      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(6,182,212,0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgba(6,182,212,0.3) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}
      />
      
      {/* 3D Canvas - on top of fallback */}
      {!hasError && (
        <div className="absolute inset-0">
          <Canvas
            camera={{ position: [0, 1, 10], fov: 55 }}
            dpr={[1, 1.5]}
            gl={{ 
              antialias: true, 
              alpha: false,
              powerPreference: 'high-performance',
              stencil: false,
              depth: true,
              failIfMajorPerformanceCaveat: false
            }}
            performance={{ min: 0.5 }}
            onCreated={({ gl }) => {
              gl.setClearColor('#000000')
            }}
            onError={() => setHasError(true)}
          >
            <SceneWrapper />
          </Canvas>
        </div>
      )}
      
      {/* Depth overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/20 via-transparent to-black/30 pointer-events-none" />
      {/* Strong vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 200px 80px rgba(0,0,0,0.9)' }} />
    </div>
  )
}
