'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef, useMemo, useEffect, useState } from 'react'
import * as THREE from 'three'

// Mouse position context for parallax effect
function useMouseParallax() {
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMouse({
        x: (e.clientX / window.innerWidth - 0.5) * 2,
        y: (e.clientY / window.innerHeight - 0.5) * 2
      })
    }
    
    const handleDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma && e.beta) {
        setMouse({
          x: (e.gamma / 45) * 0.5,
          y: (e.beta / 45) * 0.5
        })
      }
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('deviceorientation', handleDeviceOrientation)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('deviceorientation', handleDeviceOrientation)
    }
  }, [])
  
  return mouse
}

// Camera that follows mouse for parallax
function ParallaxCamera({ mouse }: { mouse: { x: number; y: number } }) {
  const { camera } = useThree()
  const targetPosition = useRef({ x: 0, y: 2, z: 12 })
  
  useFrame(() => {
    targetPosition.current.x = mouse.x * 3
    targetPosition.current.y = 2 + mouse.y * -1.5
    
    camera.position.x += (targetPosition.current.x - camera.position.x) * 0.05
    camera.position.y += (targetPosition.current.y - camera.position.y) * 0.05
    camera.lookAt(0, 0, 0)
  })
  
  return null
}

function FloatingGrid({ mouse }: { mouse: { x: number; y: number } }) {
  const gridRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (gridRef.current) {
      gridRef.current.rotation.x = Math.PI * 0.5
      gridRef.current.position.y = -3 + Math.sin(state.clock.elapsedTime * 0.3) * 0.1
      gridRef.current.position.x = mouse.x * -0.5
      gridRef.current.position.z = mouse.y * 0.3
    }
  })

  return (
    <group ref={gridRef} position={[0, -3, 0]}>
      <gridHelper args={[60, 60, '#06b6d4', '#0e7490']} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[60, 60]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.9} />
      </mesh>
    </group>
  )
}

function ParticleField({ mouse }: { mouse: { x: number; y: number } }) {
  const particlesRef = useRef<THREE.Points>(null)
  const count = 1000

  const { positions, sizes, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const siz = new Float32Array(count)
    const col = new Float32Array(count * 3)
    
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 50
      pos[i * 3 + 1] = (Math.random() - 0.5) * 30
      pos[i * 3 + 2] = (Math.random() - 0.5) * 50
      siz[i] = Math.random() * 0.08 + 0.02
      
      // Cyan to teal gradient
      const hue = 0.5 + Math.random() * 0.05
      const color = new THREE.Color().setHSL(hue, 0.8, 0.5 + Math.random() * 0.3)
      col[i * 3] = color.r
      col[i * 3 + 1] = color.g
      col[i * 3 + 2] = color.b
    }
    return { positions: pos, sizes: siz, colors: col }
  }, [])

  useFrame((state) => {
    if (particlesRef.current) {
      particlesRef.current.rotation.y = state.clock.elapsedTime * 0.03 + mouse.x * 0.2
      particlesRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1 + mouse.y * 0.1
    }
  })

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.08} vertexColors transparent opacity={0.8} sizeAttenuation />
    </points>
  )
}

function FloatingOrbs({ mouse }: { mouse: { x: number; y: number } }) {
  const groupRef = useRef<THREE.Group>(null)
  
  const orbs = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 20 - 5
      ] as [number, number, number],
      scale: Math.random() * 1.5 + 0.5,
      speed: Math.random() * 0.3 + 0.1,
      floatOffset: Math.random() * Math.PI * 2,
      color: ['#06b6d4', '#0891b2', '#0e7490', '#22d3ee'][Math.floor(Math.random() * 4)]
    }))
  }, [])

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.children.forEach((orb, i) => {
        const data = orbs[i]
        orb.position.y = data.position[1] + Math.sin(state.clock.elapsedTime * data.speed + data.floatOffset) * 1.5
        orb.position.x = data.position[0] + Math.cos(state.clock.elapsedTime * data.speed * 0.5 + data.floatOffset) * 0.5
        orb.position.x += mouse.x * (i + 1) * -0.3
        orb.position.y += mouse.y * (i + 1) * 0.2
      })
    }
  })

  return (
    <group ref={groupRef}>
      {orbs.map((orb, i) => (
        <mesh key={i} position={orb.position}>
          <sphereGeometry args={[orb.scale, 32, 32]} />
          <meshBasicMaterial color={orb.color} transparent opacity={0.15} />
        </mesh>
      ))}
    </group>
  )
}

function FloatingCubes({ mouse }: { mouse: { x: number; y: number } }) {
  const cubesRef = useRef<THREE.Group>(null)
  
  const cubes = useMemo(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 25 - 5
      ] as [number, number, number],
      scale: Math.random() * 0.4 + 0.1,
      rotationSpeed: Math.random() * 0.5 + 0.2,
      floatOffset: Math.random() * Math.PI * 2,
      depth: i / 20 // Depth layer for parallax
    }))
  }, [])

  useFrame((state) => {
    if (cubesRef.current) {
      cubesRef.current.children.forEach((cube, i) => {
        const data = cubes[i]
        cube.rotation.x = state.clock.elapsedTime * data.rotationSpeed * 0.5
        cube.rotation.y = state.clock.elapsedTime * data.rotationSpeed
        cube.position.y = data.position[1] + Math.sin(state.clock.elapsedTime + data.floatOffset) * 0.5
        // Parallax effect based on depth
        cube.position.x = data.position[0] + mouse.x * (data.depth + 0.5) * -2
        cube.position.z = data.position[2] + mouse.y * (data.depth + 0.5) * 1
      })
    }
  })

  return (
    <group ref={cubesRef}>
      {cubes.map((cube, i) => (
        <mesh key={i} position={cube.position} scale={cube.scale}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  )
}

function GlowingRings({ mouse }: { mouse: { x: number; y: number } }) {
  const ringsRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (ringsRef.current) {
      ringsRef.current.rotation.z = state.clock.elapsedTime * 0.15
      ringsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.2) * 0.3 + mouse.y * 0.3
      ringsRef.current.rotation.y = mouse.x * 0.3
      ringsRef.current.position.x = -10 + mouse.x * -2
      ringsRef.current.position.y = mouse.y * 1
    }
  })

  return (
    <group ref={ringsRef} position={[-10, 0, -12]}>
      <mesh>
        <torusGeometry args={[4, 0.03, 16, 100]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={0.5} />
      </mesh>
      <mesh rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[4.8, 0.02, 16, 100]} />
        <meshBasicMaterial color="#0e7490" transparent opacity={0.4} />
      </mesh>
      <mesh rotation={[0, Math.PI / 4, Math.PI / 5]}>
        <torusGeometry args={[5.5, 0.015, 16, 100]} />
        <meshBasicMaterial color="#0891b2" transparent opacity={0.3} />
      </mesh>
      <mesh rotation={[Math.PI / 6, Math.PI / 3, 0]}>
        <torusGeometry args={[6.2, 0.01, 16, 100]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.2} />
      </mesh>
    </group>
  )
}

function DataStreams({ mouse }: { mouse: { x: number; y: number } }) {
  const streamsRef = useRef<THREE.Group>(null)
  
  const streams = useMemo(() => {
    return Array.from({ length: 15 }, (_, i) => ({
      x: (i - 7) * 2.5,
      speed: Math.random() * 3 + 1,
      offset: Math.random() * 20,
      height: Math.random() * 0.8 + 0.3
    }))
  }, [])

  useFrame((state) => {
    if (streamsRef.current) {
      streamsRef.current.position.x = 12 + mouse.x * -3
      streamsRef.current.children.forEach((stream, i) => {
        const data = streams[i]
        const y = ((state.clock.elapsedTime * data.speed + data.offset) % 25) - 12
        stream.position.y = y
      })
    }
  })

  return (
    <group ref={streamsRef} position={[12, 0, -10]}>
      {streams.map((stream, i) => (
        <mesh key={i} position={[stream.x, 0, 0]}>
          <boxGeometry args={[0.03, stream.height, 0.03]} />
          <meshBasicMaterial color="#06b6d4" transparent opacity={0.7} />
        </mesh>
      ))}
    </group>
  )
}

function HexGrid({ mouse }: { mouse: { x: number; y: number } }) {
  const groupRef = useRef<THREE.Group>(null)
  
  const hexagons = useMemo(() => {
    const items: { x: number; y: number; z: number; scale: number; delay: number }[] = []
    for (let i = -4; i <= 4; i++) {
      for (let j = -3; j <= 3; j++) {
        const offset = j % 2 === 0 ? 0 : 0.9
        items.push({
          x: i * 1.8 + offset,
          y: j * 1.6,
          z: -15,
          scale: 0.8,
          delay: Math.random() * Math.PI * 2
        })
      }
    }
    return items
  }, [])

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.x = mouse.x * -4
      groupRef.current.position.y = mouse.y * 2
      groupRef.current.children.forEach((hex, i) => {
        const data = hexagons[i]
        const pulse = Math.sin(state.clock.elapsedTime * 2 + data.delay) * 0.5 + 0.5
        ;(hex as THREE.Mesh).material = new THREE.MeshBasicMaterial({
          color: '#06b6d4',
          wireframe: true,
          transparent: true,
          opacity: pulse * 0.3 + 0.1
        })
      })
    }
  })

  return (
    <group ref={groupRef}>
      {hexagons.map((hex, i) => (
        <mesh key={i} position={[hex.x, hex.y, hex.z]} scale={hex.scale}>
          <cylinderGeometry args={[1, 1, 0.1, 6]} />
          <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.2} />
        </mesh>
      ))}
    </group>
  )
}

function PulsingCore({ mouse }: { mouse: { x: number; y: number } }) {
  const coreRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (coreRef.current) {
      const pulse = Math.sin(state.clock.elapsedTime * 2) * 0.2 + 1
      coreRef.current.scale.setScalar(pulse)
      coreRef.current.rotation.y = state.clock.elapsedTime * 0.5
      coreRef.current.rotation.x = mouse.y * 0.5
      coreRef.current.position.x = mouse.x * -1
    }
  })

  return (
    <group ref={coreRef} position={[0, 0, -8]}>
      <mesh>
        <icosahedronGeometry args={[1.5, 1]} />
        <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.4} />
      </mesh>
      <mesh>
        <icosahedronGeometry args={[1.2, 0]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.2} />
      </mesh>
    </group>
  )
}

function Scene({ mouse }: { mouse: { x: number; y: number } }) {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 15, 50]} />
      <ambientLight intensity={0.3} />
      <ParallaxCamera mouse={mouse} />
      <FloatingGrid mouse={mouse} />
      <ParticleField mouse={mouse} />
      <FloatingOrbs mouse={mouse} />
      <FloatingCubes mouse={mouse} />
      <GlowingRings mouse={mouse} />
      <DataStreams mouse={mouse} />
      <HexGrid mouse={mouse} />
      <PulsingCore mouse={mouse} />
    </>
  )
}

function SceneWrapper() {
  const mouse = useMouseParallax()
  return <Scene mouse={mouse} />
}

export default function Futuristic3DBackground() {
  return (
    <div className="absolute inset-0 z-0">
      <Canvas
        camera={{ position: [0, 2, 12], fov: 60 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <SceneWrapper />
      </Canvas>
      {/* Gradient overlays for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/40 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-transparent to-black/50 pointer-events-none" />
      {/* Subtle vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 200px 50px rgba(0,0,0,0.8)' }} />
    </div>
  )
}
