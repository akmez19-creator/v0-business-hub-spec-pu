'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { useRef, useMemo } from 'react'
import * as THREE from 'three'

function FloatingGrid() {
  const gridRef = useRef<THREE.Group>(null)
  
  useFrame((state) => {
    if (gridRef.current) {
      gridRef.current.rotation.x = Math.PI * 0.5
      gridRef.current.position.y = -2 + Math.sin(state.clock.elapsedTime * 0.3) * 0.1
    }
  })

  return (
    <group ref={gridRef} position={[0, -2, 0]}>
      <gridHelper args={[40, 40, '#0891b2', '#0891b2']} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

function ParticleField() {
  const particlesRef = useRef<THREE.Points>(null)
  const count = 500

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30
      pos[i * 3 + 1] = (Math.random() - 0.5) * 20
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30
    }
    return pos
  }, [])

  useFrame((state) => {
    if (particlesRef.current) {
      particlesRef.current.rotation.y = state.clock.elapsedTime * 0.02
      particlesRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.05
    }
  })

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        color="#06b6d4"
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  )
}

function FloatingCubes() {
  const cubesRef = useRef<THREE.Group>(null)
  
  const cubes = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 15 - 5
      ] as [number, number, number],
      scale: Math.random() * 0.3 + 0.1,
      rotationSpeed: Math.random() * 0.5 + 0.2,
      floatOffset: Math.random() * Math.PI * 2
    }))
  }, [])

  useFrame((state) => {
    if (cubesRef.current) {
      cubesRef.current.children.forEach((cube, i) => {
        const data = cubes[i]
        cube.rotation.x = state.clock.elapsedTime * data.rotationSpeed * 0.5
        cube.rotation.y = state.clock.elapsedTime * data.rotationSpeed
        cube.position.y = data.position[1] + Math.sin(state.clock.elapsedTime + data.floatOffset) * 0.3
      })
    }
  })

  return (
    <group ref={cubesRef}>
      {cubes.map((cube, i) => (
        <mesh key={i} position={cube.position} scale={cube.scale}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#06b6d4"
            wireframe
            transparent
            opacity={0.3}
          />
        </mesh>
      ))}
    </group>
  )
}

function GlowingRings() {
  const ringsRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (ringsRef.current) {
      ringsRef.current.rotation.z = state.clock.elapsedTime * 0.1
      ringsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.2) * 0.2
    }
  })

  return (
    <group ref={ringsRef} position={[-8, 0, -10]}>
      <mesh>
        <torusGeometry args={[3, 0.02, 16, 100]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={0.4} />
      </mesh>
      <mesh rotation={[Math.PI / 4, 0, 0]}>
        <torusGeometry args={[3.5, 0.015, 16, 100]} />
        <meshBasicMaterial color="#0e7490" transparent opacity={0.3} />
      </mesh>
      <mesh rotation={[0, Math.PI / 4, Math.PI / 6]}>
        <torusGeometry args={[4, 0.01, 16, 100]} />
        <meshBasicMaterial color="#0891b2" transparent opacity={0.2} />
      </mesh>
    </group>
  )
}

function DataStreams() {
  const streamsRef = useRef<THREE.Group>(null)
  
  const streams = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => ({
      x: (i - 4) * 3,
      speed: Math.random() * 2 + 1,
      offset: Math.random() * 10
    }))
  }, [])

  useFrame((state) => {
    if (streamsRef.current) {
      streamsRef.current.children.forEach((stream, i) => {
        const data = streams[i]
        const y = ((state.clock.elapsedTime * data.speed + data.offset) % 20) - 10
        stream.position.y = y
      })
    }
  })

  return (
    <group ref={streamsRef} position={[10, 0, -8]}>
      {streams.map((stream, i) => (
        <mesh key={i} position={[stream.x, 0, 0]}>
          <boxGeometry args={[0.02, 0.5, 0.02]} />
          <meshBasicMaterial color="#06b6d4" transparent opacity={0.6} />
        </mesh>
      ))}
    </group>
  )
}

function Scene() {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 10, 40]} />
      <ambientLight intensity={0.2} />
      <FloatingGrid />
      <ParticleField />
      <FloatingCubes />
      <GlowingRings />
      <DataStreams />
    </>
  )
}

export default function Futuristic3DBackground() {
  return (
    <div className="absolute inset-0 z-0">
      <Canvas
        camera={{ position: [0, 2, 12], fov: 60 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene />
      </Canvas>
      {/* Gradient overlays for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/50 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-transparent to-black/60 pointer-events-none" />
    </div>
  )
}
