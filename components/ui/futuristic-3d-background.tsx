'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { useRef, useMemo, useEffect, useState } from 'react'
import * as THREE from 'three'

// Dark matter particles - monochromatic, subtle movement
function DarkMatterParticles() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const count = 300
  
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      pos: [
        (Math.random() - 0.5) * 50,
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 40 - 10
      ],
      speed: 0.05 + Math.random() * 0.15,
      offset: Math.random() * Math.PI * 2,
      size: 0.02 + Math.random() * 0.06
    }))
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state) => {
    if (meshRef.current) {
      const t = state.clock.elapsedTime
      particles.forEach((p, i) => {
        // Slow drifting motion like dark matter
        dummy.position.set(
          p.pos[0] + Math.sin(t * p.speed * 0.5 + p.offset) * 2,
          p.pos[1] + Math.cos(t * p.speed * 0.3 + p.offset) * 1.5,
          p.pos[2] + Math.sin(t * p.speed * 0.4 + p.offset * 2) * 1
        )
        dummy.scale.setScalar(p.size)
        dummy.updateMatrix()
        meshRef.current!.setMatrixAt(i, dummy.matrix)
      })
      meshRef.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={0.15} />
    </instancedMesh>
  )
}

// Larger dark matter wisps - very subtle
function DarkMatterWisps() {
  const groupRef = useRef<THREE.Group>(null)
  
  const wisps = useMemo(() => 
    Array.from({ length: 6 }, (_, i) => ({
      pos: [
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 15,
        -8 - Math.random() * 15
      ] as [number, number, number],
      scale: 1.5 + Math.random() * 2,
      speed: 0.02 + Math.random() * 0.03,
      offset: Math.random() * Math.PI * 2
    })), [])

  useFrame((state) => {
    if (groupRef.current) {
      const t = state.clock.elapsedTime
      groupRef.current.children.forEach((child, i) => {
        const wisp = wisps[i]
        child.position.y = wisp.pos[1] + Math.sin(t * wisp.speed + wisp.offset) * 3
        child.position.x = wisp.pos[0] + Math.cos(t * wisp.speed * 0.7 + wisp.offset) * 2
        child.rotation.z = t * 0.02
      })
    }
  })

  return (
    <group ref={groupRef}>
      {wisps.map((wisp, i) => (
        <mesh key={i} position={wisp.pos} scale={wisp.scale}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color="#0a1520" transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  )
}

// Slow rotating nebula/dust clouds
function DarkNebula() {
  const meshRef = useRef<THREE.Mesh>(null)
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.z = state.clock.elapsedTime * 0.01
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.02) * 0.1
    }
  })

  return (
    <mesh ref={meshRef} position={[0, 0, -20]}>
      <planeGeometry args={[60, 60]} />
      <meshBasicMaterial transparent opacity={0.08}>
        <canvasTexture 
          attach="map" 
          image={(() => {
            if (typeof window === 'undefined') return null
            const canvas = document.createElement('canvas')
            canvas.width = 512
            canvas.height = 512
            const ctx = canvas.getContext('2d')
            if (ctx) {
              // Create dark swirling pattern
              const gradient = ctx.createRadialGradient(256, 256, 0, 256, 256, 256)
              gradient.addColorStop(0, 'rgba(6, 182, 212, 0.1)')
              gradient.addColorStop(0.3, 'rgba(8, 51, 68, 0.08)')
              gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.05)')
              gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
              ctx.fillStyle = gradient
              ctx.fillRect(0, 0, 512, 512)
            }
            return canvas
          })() as HTMLCanvasElement}
        />
      </meshBasicMaterial>
    </mesh>
  )
}

// Grid floor with slow drift
function GridFloor() {
  const gridRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (gridRef.current) {
      gridRef.current.position.y = -5 + Math.sin(state.clock.elapsedTime * 0.1) * 0.2
    }
  })

  return (
    <group ref={gridRef} position={[0, -5, 0]} rotation={[Math.PI * 0.5, 0, 0]}>
      <gridHelper args={[60, 40, '#082f49', '#0c1a24']} rotation={[Math.PI * 0.5, 0, 0]} />
    </group>
  )
}

function Scene() {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000205', 15, 50]} />
      <ambientLight intensity={0.1} />
      <DarkMatterParticles />
      <DarkMatterWisps />
      <DarkNebula />
      <GridFloor />
    </>
  )
}

export default function Futuristic3DBackground() {
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])
  
  return (
    <div className="absolute inset-0 z-0 bg-black">
      {/* Pure black base - always visible */}
      <div className="absolute inset-0 bg-black" />
      
      {/* Very subtle ambient glows */}
      <div className="absolute top-0 right-0 w-[400px] h-[300px] bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.04),transparent_70%)]" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[200px] bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.03),transparent_70%)]" />
      
      {/* 3D Canvas - dark matter effect */}
      {mounted && (
        <div className="absolute inset-0">
          <Canvas
            camera={{ position: [0, 0, 15], fov: 60 }}
            dpr={[1, 1.5]}
            gl={{ 
              antialias: true, 
              alpha: false,
              powerPreference: 'high-performance',
              failIfMajorPerformanceCaveat: false
            }}
            onCreated={({ gl }) => {
              gl.setClearColor('#000000')
            }}
          >
            <Scene />
          </Canvas>
        </div>
      )}
      
      {/* Vignette overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 150px 60px rgba(0,0,0,0.8)' }} />
    </div>
  )
}
