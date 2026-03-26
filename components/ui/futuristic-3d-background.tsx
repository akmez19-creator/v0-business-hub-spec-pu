'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { useRef, useMemo, useEffect, useState } from 'react'
import * as THREE from 'three'

// High-res dark matter particles - smooth spheres with varying sizes
function DarkMatterParticles() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const count = 500 // More particles for richer effect
  
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      pos: [
        (Math.random() - 0.5) * 60,
        (Math.random() - 0.5) * 35,
        (Math.random() - 0.5) * 50 - 10
      ],
      speed: 0.03 + Math.random() * 0.1,
      offset: Math.random() * Math.PI * 2,
      size: 0.015 + Math.random() * 0.08,
      brightness: 0.1 + Math.random() * 0.2 // Varying brightness
    }))
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state) => {
    if (meshRef.current) {
      const t = state.clock.elapsedTime
      particles.forEach((p, i) => {
        // Smooth flowing motion like cosmic dust
        dummy.position.set(
          p.pos[0] + Math.sin(t * p.speed * 0.5 + p.offset) * 3,
          p.pos[1] + Math.cos(t * p.speed * 0.3 + p.offset) * 2,
          p.pos[2] + Math.sin(t * p.speed * 0.4 + p.offset * 2) * 1.5
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
      <sphereGeometry args={[1, 16, 16]} /> {/* Higher segments for smoother spheres */}
      <meshBasicMaterial color="#e0f7ff" transparent opacity={0.12} />
    </instancedMesh>
  )
}

// High-res dark matter wisps - smooth gradients
function DarkMatterWisps() {
  const groupRef = useRef<THREE.Group>(null)
  
  const wisps = useMemo(() => 
    Array.from({ length: 10 }, (_, i) => ({
      pos: [
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 20,
        -8 - Math.random() * 20
      ] as [number, number, number],
      scale: 1 + Math.random() * 3,
      speed: 0.015 + Math.random() * 0.025,
      offset: Math.random() * Math.PI * 2,
      opacity: 0.2 + Math.random() * 0.3
    })), [])

  useFrame((state) => {
    if (groupRef.current) {
      const t = state.clock.elapsedTime
      groupRef.current.children.forEach((child, i) => {
        const wisp = wisps[i]
        child.position.y = wisp.pos[1] + Math.sin(t * wisp.speed + wisp.offset) * 4
        child.position.x = wisp.pos[0] + Math.cos(t * wisp.speed * 0.7 + wisp.offset) * 3
        child.rotation.z = t * 0.015
        child.rotation.y = t * 0.01
      })
    }
  })

  return (
    <group ref={groupRef}>
      {wisps.map((wisp, i) => (
        <mesh key={i} position={wisp.pos} scale={wisp.scale}>
          <sphereGeometry args={[1, 32, 32]} /> {/* High-res spheres */}
          <meshBasicMaterial color="#061520" transparent opacity={wisp.opacity} />
        </mesh>
      ))}
    </group>
  )
}

// High-res nebula/dust clouds with detailed texture
function DarkNebula() {
  const meshRef = useRef<THREE.Mesh>(null)
  const mesh2Ref = useRef<THREE.Mesh>(null)
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.z = state.clock.elapsedTime * 0.008
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.015) * 0.08
    }
    if (mesh2Ref.current) {
      mesh2Ref.current.rotation.z = -state.clock.elapsedTime * 0.006
      mesh2Ref.current.rotation.y = Math.cos(state.clock.elapsedTime * 0.01) * 0.05
    }
  })

  const nebulaTexture = useMemo(() => {
    if (typeof window === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = 1024 // Higher resolution
    canvas.height = 1024
    const ctx = canvas.getContext('2d')
    if (ctx) {
      // Create detailed dark matter swirl pattern
      const gradient = ctx.createRadialGradient(512, 512, 0, 512, 512, 512)
      gradient.addColorStop(0, 'rgba(6, 182, 212, 0.15)')
      gradient.addColorStop(0.2, 'rgba(8, 145, 178, 0.1)')
      gradient.addColorStop(0.4, 'rgba(8, 51, 68, 0.08)')
      gradient.addColorStop(0.7, 'rgba(0, 20, 30, 0.05)')
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 1024, 1024)
      
      // Add noise/grain for texture
      for (let i = 0; i < 2000; i++) {
        const x = Math.random() * 1024
        const y = Math.random() * 1024
        const dist = Math.sqrt((x - 512) ** 2 + (y - 512) ** 2) / 512
        if (dist < 1) {
          const alpha = (1 - dist) * 0.03 * Math.random()
          ctx.fillStyle = `rgba(100, 200, 220, ${alpha})`
          ctx.fillRect(x, y, 2, 2)
        }
      }
    }
    return canvas
  }, [])

  return (
    <>
      <mesh ref={meshRef} position={[0, 0, -25]}>
        <planeGeometry args={[80, 80]} />
        <meshBasicMaterial transparent opacity={0.1} map={nebulaTexture ? new THREE.CanvasTexture(nebulaTexture) : undefined} />
      </mesh>
      <mesh ref={mesh2Ref} position={[-10, 5, -30]}>
        <planeGeometry args={[50, 50]} />
        <meshBasicMaterial transparent opacity={0.06} map={nebulaTexture ? new THREE.CanvasTexture(nebulaTexture) : undefined} />
      </mesh>
    </>
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
      
      {/* 3D Canvas - high-res dark matter effect */}
      {mounted && (
        <div className="absolute inset-0">
          <Canvas
            camera={{ position: [0, 0, 15], fov: 60 }}
            dpr={[1.5, 2]} // Higher resolution for crisp visuals
            gl={{ 
              antialias: true, 
              alpha: false,
              powerPreference: 'high-performance',
              failIfMajorPerformanceCaveat: false,
              precision: 'highp' // High precision for better quality
            }}
            onCreated={({ gl }) => {
              gl.setClearColor('#000000')
              gl.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // Match device pixel ratio
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
