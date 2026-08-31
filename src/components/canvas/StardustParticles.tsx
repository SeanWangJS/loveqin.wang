import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';

export const StardustParticles: React.FC<{ count?: number }> = ({ count = 300 }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const cameraZ = useGalleryStore((s) => s.cameraZ);

  const [positions, scales] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const scl = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10 + 0.5;
      pos[i * 3 + 2] = -Math.random() * 140 + 20; // 局部深度范围

      scl[i] = Math.random() * 2 + 1;
    }

    return [pos, scl];
  }, [count]);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const time = state.clock.getElapsedTime() * 0.2;
    pointsRef.current.position.z = cameraZ;
    pointsRef.current.rotation.y = Math.sin(time * 0.1) * 0.05;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
        <bufferAttribute
          attach="attributes-scale"
          args={[scales, 1]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        color="#38bdf8"
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};
