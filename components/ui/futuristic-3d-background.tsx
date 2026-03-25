'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useRef, useMemo, useEffect, useState, useCallback } from 'react'
import * as THREE from 'three'
import { MeshTransmissionMaterial, Float, Environment } from '@react-three/drei'

// Enhanced spatial tracking for iPhone-like parallax effect
function useSpatialTracking() {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [hasPermission, setHasPermission] = useState(false)
  const smoothPosition = useRef({ x: 0, y: 0 })
  
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
    
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2.5
      const y = (e.clientY / window.innerHeight - 0.5) * 2.5
      smoothPosition.current.x = x
      smoothPosition.current.y = y
    }
    
    const handleDeviceOrientation = (e: DeviceOrientationEvent) => {
      if (!hasPermission) return
      if (e.gamma !== null && e.beta !== null) {
        const x = Math.max(-1, Math.min(1, (e.gamma || 0) / 30))
        const y = Math.max(-1, Math.min(1, ((e.beta || 0) - 45) / 30))
        smoothPosition.current.x = x * 1.5
        smoothPosition.current.y = y * 1.5
      }
    }
    
    let animationId: number
    const animate = () => {
      setPosition(prev => ({
        x: prev.x + (smoothPosition.current.x - prev.x) * 0.06,
        y: prev.y + (smoothPosition.current.y - prev.y) * 0.06
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
    camera.position.x = spatialPos.x * 3
    camera.position.y = 1 + spatialPos.y * -1.5
    camera.position.z = 10 + Math.abs(spatialPos.x) * 0.3
    camera.lookAt(spatialPos.x * -0.8, spatialPos.y * 0.3, 0)
  })
  
  return null
}

// Liquid Glass Blob - Main attraction
function LiquidGlassBlob({ position: pos }: { position: { x: number; y: number } }) {
  const blobRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<any>(null)
  
  useFrame((state) => {
    if (blobRef.current) {
      const time = state.clock.elapsedTime
      blobRef.current.rotation.x = time * 0.15 + pos.y * 0.5
      blobRef.current.rotation.y = time * 0.2 + pos.x * 0.5
      blobRef.current.position.x = pos.x * -2
      blobRef.current.position.y = pos.y * 1.2
      
      // Morph the geometry for liquid effect
      const positions = blobRef.current.geometry.attributes.position
      const original = (blobRef.current.geometry as any).originalPositions
      
      if (!original) {
        (blobRef.current.geometry as any).originalPositions = positions.array.slice()
      } else {
        for (let i = 0; i < positions.count; i++) {
          const ox = original[i * 3]
          const oy = original[i * 3 + 1]
          const oz = original[i * 3 + 2]
          
          const noise = Math.sin(ox * 2 + time) * Math.cos(oy * 2 + time * 1.2) * Math.sin(oz * 2 + time * 0.8) * 0.15
          
          positions.array[i * 3] = ox + ox * noise
          positions.array[i * 3 + 1] = oy + oy * noise
          positions.array[i * 3 + 2] = oz + oz * noise
        }
        positions.needsUpdate = true
      }
    }
  })

  return (
    <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
      <mesh ref={blobRef} position={[0, 0, -2]} scale={2.5}>
        <icosahedronGeometry args={[1, 8]} />
        <MeshTransmissionMaterial
          ref={materialRef}
          backside
          samples={16}
          resolution={512}
          transmission={0.95}
          roughness={0.05}
          thickness={0.5}
          ior={1.5}
          chromaticAberration={0.15}
          anisotropy={0.3}
          distortion={0.3}
          distortionScale={0.5}
          temporalDistortion={0.1}
          clearcoat={1}
          attenuationDistance={0.5}
          attenuationColor="#06b6d4"
          color="#083344"
        />
      </mesh>
    </Float>
  )
}

// Floating glass orbs
function GlassOrbs({ position: pos }: { position: { x: number; y: number } }) {
  const groupRef = useRef<THREE.Group>(null)
  
  const orbs = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 15 - 5
      ] as [number, number, number],
      scale: Math.random() * 0.8 + 0.4,
      speed: Math.random() * 0.3 + 0.1,
      floatOffset: Math.random() * Math.PI * 2,
      depth: Math.random()
    }))
  }, [])

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.children.forEach((orb, i) => {
        const data = orbs[i]
        const time = state.clock.elapsedTime
        orb.position.y = data.position[1] + Math.sin(time * data.speed + data.floatOffset) * 2
        orb.position.x = data.position[0] + pos.x * (2.5 - data.depth * 2) * -1
        orb.position.y += pos.y * (2 - data.depth * 1.5) * 0.5
        orb.rotation.x = time * 0.2
        orb.rotation.y = time * 0.3
      })
    }
  })

  return (
    <group ref={groupRef}>
      {orbs.map((orb, i) => (
        <mesh key={i} position={orb.position} scale={orb.scale}>
          <sphereGeometry args={[1, 64, 64]} />
          <MeshTransmissionMaterial
            backside
            samples={8}
            resolution={256}
            transmission={0.9}
            roughness={0.1}
            thickness={0.3}
            ior={1.4}
            chromaticAberration={0.1}
            clearcoat={1}
            attenuationDistance={0.8}
            attenuationColor="#0891b2"
            color="#0c4a6e"
          />
        </mesh>
      ))}
    </group>
  )
}

// Glass torus rings
function GlassRings({ position: pos }: { position: { x: number; y: number } }) {
  const ringsRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (ringsRef.current) {
      const time = state.clock.elapsedTime
      ringsRef.current.rotation.z = time * 0.15
      ringsRef.current.rotation.x = pos.y * 0.4 + Math.sin(time * 0.2) * 0.15
      ringsRef.current.rotation.y = pos.x * 0.4
      ringsRef.current.position.x = -8 + pos.x * -2.5
      ringsRef.current.position.y = pos.y * 1.2
    }
  })

  return (
    <group ref={ringsRef} position={[-8, 0, -8]}>
      {[3, 4, 5].map((radius, i) => (
        <mesh key={i} rotation={[i * 0.4, i * 0.3, i * 0.2]}>
          <torusGeometry args={[radius, 0.15, 32, 100]} />
          <MeshTransmissionMaterial
            backside
            samples={8}
            resolution={256}
            transmission={0.85}
            roughness={0.15}
            thickness={0.2}
            ior={1.3}
            chromaticAberration={0.08}
            clearcoat={1}
            attenuationDistance={1}
            attenuationColor="#22d3ee"
            color="#164e63"
          />
        </mesh>
      ))}
    </group>
  )
}

// Particles with glow
function GlowParticles({ position: pos }: { position: { x: number; y: number } }) {
  const nearRef = useRef<THREE.Points>(null)
  const farRef = useRef<THREE.Points>(null)

  const createParticles = (count: number, spread: number) => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spread
      positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.5
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread
      
      const hue = 0.5 + Math.random() * 0.08
      const color = new THREE.Color().setHSL(hue, 0.8, 0.6 + Math.random() * 0.3)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    return { positions, colors }
  }

  const near = useMemo(() => createParticles(150, 25), [])
  const far = useMemo(() => createParticles(300, 50), [])

  useFrame((state) => {
    const time = state.clock.elapsedTime
    
    if (nearRef.current) {
      nearRef.current.position.x = pos.x * -2.5
      nearRef.current.position.y = pos.y * 1.5
      nearRef.current.rotation.y = time * 0.02
    }
    
    if (farRef.current) {
      farRef.current.position.x = pos.x * -1
      farRef.current.position.y = pos.y * 0.5
      farRef.current.rotation.y = time * 0.01
    }
  })

  return (
    <>
      <points ref={nearRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={150} array={near.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={150} array={near.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.12} vertexColors transparent opacity={0.9} sizeAttenuation />
      </points>
      <points ref={farRef} position={[0, 0, -15]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" count={300} array={far.positions} itemSize={3} />
          <bufferAttribute attach="attributes-color" count={300} array={far.colors} itemSize={3} />
        </bufferGeometry>
        <pointsMaterial size={0.06} vertexColors transparent opacity={0.5} sizeAttenuation />
      </points>
    </>
  )
}

// Wireframe grid floor
function GridFloor({ position: pos }: { position: { x: number; y: number } }) {
  const gridRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (gridRef.current) {
      gridRef.current.position.x = pos.x * -0.6
      gridRef.current.position.z = pos.y * 0.4
      gridRef.current.position.y = -4 + Math.sin(state.clock.elapsedTime * 0.3) * 0.1
    }
  })

  return (
    <group ref={gridRef} position={[0, -4, 0]} rotation={[Math.PI * 0.5, 0, 0]}>
      <gridHelper args={[60, 60, '#0891b2', '#083344']} rotation={[Math.PI * 0.5, 0, 0]} />
      <mesh rotation={[0, 0, 0]} position={[0, 0, -0.01]}>
        <planeGeometry args={[60, 60]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.97} />
      </mesh>
    </group>
  )
}

// Ambient light sources
function LightSources() {
  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={0.8} color="#06b6d4" />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#0891b2" />
      <pointLight position={[0, 5, 5]} intensity={0.6} color="#22d3ee" />
      <spotLight
        position={[0, 15, 0]}
        angle={0.4}
        penumbra={1}
        intensity={0.8}
        color="#06b6d4"
      />
    </>
  )
}

function Scene({ position }: { position: { x: number; y: number } }) {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000508', 15, 45]} />
      <Environment preset="night" />
      <SpatialCamera position={position} />
      <LightSources />
      <LiquidGlassBlob position={position} />
      <GlassOrbs position={position} />
      <GlassRings position={position} />
      <GlowParticles position={position} />
      <GridFloor position={position} />
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
        camera={{ position: [0, 1, 10], fov: 60 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <SceneWrapper />
      </Canvas>
      {/* Subtle overlays for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-950/20 via-transparent to-black/30 pointer-events-none" />
      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 200px 60px rgba(0,0,0,0.85)' }} />
    </div>
  )
}
