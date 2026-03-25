'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef, useMemo, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'

// Enhanced spatial tracking for iPhone-like parallax effect
function useSpatialTracking() {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [hasPermission, setHasPermission] = useState(false)
  const smoothPosition = useRef({ x: 0, y: 0 })
  
  // Request permission for device orientation on iOS 13+
  const requestPermission = useCallback(async () => {
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const permission = await (DeviceOrientationEvent as any).requestPermission()
        setHasPermission(permission === 'granted')
      } catch {
        setHasPermission(false)
      }
    } else {
      setHasPermission(true)
    }
  }, [])
  
  useEffect(() => {
    requestPermission()
    
    // Mouse tracking for desktop - enhanced sensitivity
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2.5
      const y = (e.clientY / window.innerHeight - 0.5) * 2.5
      smoothPosition.current.x = x
      smoothPosition.current.y = y
    }
    
    // Device orientation for mobile - iPhone spatial effect
    const handleDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (!hasPermission) return
      if (e.gamma !== null && e.beta !== null) {
        // Gamma: left/right tilt (-90 to 90), Beta: front/back tilt (-180 to 180)
        const x = Math.max(-1, Math.min(1, (e.gamma || 0) / 30))
        const y = Math.max(-1, Math.min(1, ((e.beta || 0) - 45) / 30))
        smoothPosition.current.x = x * 1.5
        smoothPosition.current.y = y * 1.5
      }
    }
    
    // Smooth animation loop
    let animationId: number
    const animate = () => {
      setPosition(prev => ({
        x: prev.x + (smoothPosition.current.x - prev.x) * 0.08,
        y: prev.y + (smoothPosition.current.y - prev.y) * 0.08
      }))
      animationId = requestAnimationFrame(animate)
    }
    animate()
    
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('deviceorientation', handleDeviceOrientation)
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('deviceorientation', handleDeviceOrientation)
      cancelAnimationFrame(animationId)
    }
  }, [hasPermission, requestPermission])
  
  return position
}

// Camera with spatial movement
function SpatialCamera({ position: spatialPos }: { position: { x: number; y: number } }) {
  const { camera } = useThree()
  
  useFrame(() => {
    // Camera moves opposite to input for spatial depth effect
    camera.position.x = spatialPos.x * 4
    camera.position.y = 2 + spatialPos.y * -2
    camera.position.z = 12 + Math.abs(spatialPos.x) * 0.5
    camera.lookAt(spatialPos.x * -1, spatialPos.y * 0.5, 0)
  })
  
  return null
}

// Floating grid floor with depth
function FloatingGrid({ position: pos }: { position: { x: number; y: number } }) {
  const gridRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (gridRef.current) {
      gridRef.current.position.x = pos.x * -0.8
      gridRef.current.position.z = pos.y * 0.5
      gridRef.current.position.y = -3.5 + Math.sin(state.clock.elapsedTime * 0.3) * 0.15
    }
  })

  return (
    <group ref={gridRef} position={[0, -3.5, 0]} rotation={[Math.PI * 0.5, 0, 0]}>
      <gridHelper args={[80, 80, '#06b6d4', '#0e7490']} rotation={[Math.PI * 0.5, 0, 0]} />
      <mesh rotation={[0, 0, 0]} position={[0, 0, -0.01]}>
        <planeGeometry args={[80, 80]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.95} />
      </mesh>
    </group>
  )
}

// Particles with layered depth for parallax
function ParticleField({ position: pos }: { position: { x: number; y: number } }) {
  const nearRef = useRef<THREE.Points>(null)
  const midRef = useRef<THREE.Points>(null)
  const farRef = useRef<THREE.Points>(null)

  const createParticles = (count: number, spread: number) => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spread
      positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.6
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread
      
      const hue = 0.5 + Math.random() * 0.05
      const color = new THREE.Color().setHSL(hue, 0.9, 0.5 + Math.random() * 0.4)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    return { positions, colors }
  }

  const near = useMemo(() => createParticles(200, 25), [])
  const mid = useMemo(() => createParticles(400, 40), [])
  const far = useMemo(() => createParticles(600, 60), [])

  useFrame((state) => {
    const time = state.clock.elapsedTime
    
    // Near layer - moves most with spatial input (foreground)
    if (nearRef.current) {
      nearRef.current.position.x = pos.x * -3
      nearRef.current.position.y = pos.y * 2
      nearRef.current.rotation.y = time * 0.02
    }
    
    // Mid layer - moves medium
    if (midRef.current) {
      midRef.current.position.x = pos.x * -1.5
      midRef.current.position.y = pos.y * 1
      midRef.current.rotation.y = time * 0.015
    }
    
    // Far layer - moves least (background)
    if (farRef.current) {
      farRef.current.position.x = pos.x * -0.5
      farRef.current.position.y = pos.y * 0.3
      farRef.current.rotation.y = time * 0.01
    }
  })

  return (
    <>
      <points ref={nearRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={200} array={near.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={200} array={near.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.15} vertexColors transparent opacity={1} sizeAttenuation />
      </points>
      <points ref={midRef} position={[0, 0, -10]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={400} array={mid.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={400} array={mid.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.1} vertexColors transparent opacity={0.7} sizeAttenuation />
      </points>
      <points ref={farRef} position={[0, 0, -20]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={600} array={far.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={600} array={far.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.06} vertexColors transparent opacity={0.4} sizeAttenuation />
      </points>
    </>
  )
}

// Floating cubes with depth layers
function FloatingCubes({ position: pos }: { position: { x: number; y: number } }) {
  const layersRef = useRef<THREE.Group[]>([])
  
  const layers = useMemo(() => {
    return [
      { depth: 0, count: 8, spread: 15, parallax: 2.5 },  // Near
      { depth: -8, count: 12, spread: 25, parallax: 1.5 }, // Mid
      { depth: -16, count: 15, spread: 35, parallax: 0.8 } // Far
    ].map(layer => ({
      ...layer,
      cubes: Array.from({ length: layer.count }, () => ({
        position: [
          (Math.random() - 0.5) * layer.spread,
          (Math.random() - 0.5) * layer.spread * 0.5,
          (Math.random() - 0.5) * 10
        ] as [number, number, number],
        scale: Math.random() * 0.5 + 0.2,
        rotSpeed: Math.random() * 0.5 + 0.2,
        floatOffset: Math.random() * Math.PI * 2
      }))
    }))
  }, [])

  useFrame((state) => {
    layersRef.current.forEach((group, layerIdx) => {
      if (group) {
        const layer = layers[layerIdx]
        group.position.x = pos.x * -layer.parallax
        group.position.y = pos.y * layer.parallax * 0.5
        
        group.children.forEach((cube, i) => {
          const data = layer.cubes[i]
          cube.rotation.x = state.clock.elapsedTime * data.rotSpeed * 0.5
          cube.rotation.y = state.clock.elapsedTime * data.rotSpeed
          cube.position.y = data.position[1] + Math.sin(state.clock.elapsedTime + data.floatOffset) * 0.8
        })
      }
    })
  })

  return (
    <>
      {layers.map((layer, layerIdx) => (
        <group 
          key={layerIdx} 
          ref={el => { if (el) layersRef.current[layerIdx] = el }}
          position={[0, 0, layer.depth]}
        >
          {layer.cubes.map((cube, i) => (
            <mesh key={i} position={cube.position} scale={cube.scale}>
              <boxGeometry args={[1, 1, 1]} />
              <meshBasicMaterial 
                color="#06b6d4" 
                wireframe 
                transparent 
                opacity={0.6 - layerIdx * 0.15} 
              />
            </mesh>
          ))}
        </group>
      ))}
    </>
  )
}

// Glowing orbs with spatial depth
function FloatingOrbs({ position: pos }: { position: { x: number; y: number } }) {
  const groupRef = useRef<THREE.Group>(null)
  
  const orbs = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 20 - 8
      ] as [number, number, number],
      scale: Math.random() * 2 + 0.8,
      speed: Math.random() * 0.4 + 0.15,
      floatOffset: Math.random() * Math.PI * 2,
      color: ['#06b6d4', '#0891b2', '#0e7490', '#22d3ee', '#67e8f9'][Math.floor(Math.random() * 5)],
      depth: Math.random()
    }))
  }, [])

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.children.forEach((orb, i) => {
        const data = orbs[i]
        orb.position.y = data.position[1] + Math.sin(state.clock.elapsedTime * data.speed + data.floatOffset) * 2
        orb.position.x = data.position[0] + Math.cos(state.clock.elapsedTime * data.speed * 0.5 + data.floatOffset) * 1
        // Spatial parallax based on depth
        orb.position.x += pos.x * (2 - data.depth * 1.5) * -1
        orb.position.y += pos.y * (2 - data.depth * 1.5) * 0.5
      })
    }
  })

  return (
    <group ref={groupRef}>
      {orbs.map((orb, i) => (
        <mesh key={i} position={orb.position}>
          <sphereGeometry args={[orb.scale, 32, 32]} />
          <meshBasicMaterial color={orb.color} transparent opacity={0.12} />
        </mesh>
      ))}
    </group>
  )
}

// Rotating rings with spatial tilt
function GlowingRings({ position: pos }: { position: { x: number; y: number } }) {
  const ringsRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (ringsRef.current) {
      ringsRef.current.rotation.z = state.clock.elapsedTime * 0.2
      ringsRef.current.rotation.x = pos.y * 0.6 + Math.sin(state.clock.elapsedTime * 0.3) * 0.2
      ringsRef.current.rotation.y = pos.x * 0.6
      ringsRef.current.position.x = -12 + pos.x * -3
      ringsRef.current.position.y = pos.y * 1.5
    }
  })

  return (
    <group ref={ringsRef} position={[-12, 0, -15]}>
      {[4, 5, 6, 7, 8].map((radius, i) => (
        <mesh key={i} rotation={[i * 0.3, i * 0.2, i * 0.1]}>
          <torusGeometry args={[radius, 0.03 - i * 0.005, 16, 100]} />
          <meshBasicMaterial color="#06b6d4" transparent opacity={0.5 - i * 0.08} />
        </mesh>
      ))}
    </group>
  )
}

// Pulsing core with spatial rotation
function PulsingCore({ position: pos }: { position: { x: number; y: number } }) {
  const coreRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (coreRef.current) {
      const pulse = Math.sin(state.clock.elapsedTime * 2) * 0.25 + 1
      coreRef.current.scale.setScalar(pulse)
      coreRef.current.rotation.y = state.clock.elapsedTime * 0.6 + pos.x * 1
      coreRef.current.rotation.x = pos.y * 0.8
      coreRef.current.position.x = pos.x * -1.5
      coreRef.current.position.y = pos.y * 0.8
    }
  })

  return (
    <group ref={coreRef} position={[0, 0, -10]}>
      <mesh>
        <icosahedronGeometry args={[2, 1]} />
        <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.5} />
      </mesh>
      <mesh scale={0.85}>
        <icosahedronGeometry args={[2, 0]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.25} />
      </mesh>
      <mesh scale={0.6}>
        <sphereGeometry args={[2, 32, 32]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.1} />
      </mesh>
    </group>
  )
}

// Hexagon grid background
function HexGrid({ position: pos }: { position: { x: number; y: number } }) {
  const groupRef = useRef<THREE.Group>(null)
  
  const hexagons = useMemo(() => {
    const items: { x: number; y: number; delay: number }[] = []
    for (let i = -6; i <= 6; i++) {
      for (let j = -4; j <= 4; j++) {
        const offset = j % 2 === 0 ? 0 : 1.1
        items.push({
          x: i * 2.2 + offset,
          y: j * 1.9,
          delay: Math.random() * Math.PI * 2
        })
      }
    }
    return items
  }, [])

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.x = pos.x * -5
      groupRef.current.position.y = pos.y * 2.5
      
      groupRef.current.children.forEach((hex, i) => {
        const data = hexagons[i]
        const pulse = Math.sin(state.clock.elapsedTime * 1.5 + data.delay) * 0.5 + 0.5
        const mat = (hex as THREE.Mesh).material as THREE.MeshBasicMaterial
        mat.opacity = pulse * 0.25 + 0.05
      })
    }
  })

  return (
    <group ref={groupRef} position={[0, 0, -20]}>
      {hexagons.map((hex, i) => (
        <mesh key={i} position={[hex.x, hex.y, 0]}>
          <cylinderGeometry args={[1, 1, 0.05, 6]} />
          <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.15} />
        </mesh>
      ))}
    </group>
  )
}

// Data streams
function DataStreams({ position: pos }: { position: { x: number; y: number } }) {
  const streamsRef = useRef<THREE.Group>(null)
  
  const streams = useMemo(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      x: (i - 10) * 1.8,
      speed: Math.random() * 4 + 2,
      offset: Math.random() * 30,
      height: Math.random() * 1.2 + 0.4
    }))
  }, [])

  useFrame((state) => {
    if (streamsRef.current) {
      streamsRef.current.position.x = 15 + pos.x * -4
      streamsRef.current.position.y = pos.y * 1
      
      streamsRef.current.children.forEach((stream, i) => {
        const data = streams[i]
        const y = ((state.clock.elapsedTime * data.speed + data.offset) % 30) - 15
        stream.position.y = y
      })
    }
  })

  return (
    <group ref={streamsRef} position={[15, 0, -12]}>
      {streams.map((stream, i) => (
        <mesh key={i} position={[stream.x, 0, 0]}>
          <boxGeometry args={[0.04, stream.height, 0.04]} />
          <meshBasicMaterial color="#06b6d4" transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function Scene({ position }: { position: { x: number; y: number } }) {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 20, 60]} />
      <SpatialCamera position={position} />
      <FloatingGrid position={position} />
      <ParticleField position={position} />
      <FloatingCubes position={position} />
      <FloatingOrbs position={position} />
      <GlowingRings position={position} />
      <PulsingCore position={position} />
      <HexGrid position={position} />
      <DataStreams position={position} />
    </>
  )
}

function SceneWrapper() {
  const position = useSpatialTracking()
  return <Scene position={position} />
}

export default function Futuristic3DBackground() {
  return (
    <div className="absolute inset-0 z-0">
      <Canvas
        camera={{ position: [0, 2, 12], fov: 65 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <SceneWrapper />
      </Canvas>
      {/* Depth overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/50 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-black/40 pointer-events-none" />
      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 250px 80px rgba(0,0,0,0.9)' }} />
    </div>
  )
}
