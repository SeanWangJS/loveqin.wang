import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';

interface GroundReflectorProps {
  windowLength?: number;
  trackWidth?: number;
}

/**
 * 概念设计图同款：【高精镜面反射抛光地砖 + 中央能量微光光轨 (Ground Mirror & Track)】
 * 严谨修正图层 Y 轴高度：所有光轨、节点与网格必须严格位于反射地面上层（Y = 0.005）
 */
export const GroundReflector: React.FC<GroundReflectorProps> = ({
  windowLength = 160,
  trackWidth = 24,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const instancedNodesRef = useRef<THREE.InstancedMesh>(null);
  const instancedCrossLinesRef = useRef<THREE.InstancedMesh>(null);

  const qualityTier = useGalleryStore((s) => s.qualityTier);
  const cameraZ = useGalleryStore((s) => s.cameraZ);

  // 沿走廊 Z 轴排列的微光节点与微弱地砖方格刻度
  const nodeSpacing = 3.6;
  const nodeCount = Math.ceil(windowLength / nodeSpacing);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    const baseZ = Math.floor(cameraZ / 10) * 10;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 更新中央发光能量节点（置于地面上层 Y = 0.008）
    if (instancedNodesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const z = 20 - i * nodeSpacing;
        dummy.position.set(0, 0.008, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(0.24, 0.24, 1);
        dummy.updateMatrix();
        instancedNodesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedNodesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 地砖微弱横向拼缝细线（置于地面上层 Y = 0.004）
    if (instancedCrossLinesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const z = 20 - i * nodeSpacing;
        dummy.position.set(0, 0.004, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(trackWidth * 0.9, 0.02, 1);
        dummy.updateMatrix();
        instancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} position={[0, -2.0, 0]}>
      {/* 1. 高精镜面反射地板（深蓝黑高反光微晶材质，能够清晰倒映两侧照片与光轨） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -windowLength / 2 + 20]}>
        <planeGeometry args={[trackWidth, windowLength]} />
        {qualityTier !== 'low' ? (
          <MeshReflectorMaterial
            blur={[80, 20]}
            resolution={qualityTier === 'high' ? 512 : 256}
            mirror={0.65}
            mixStrength={2.5}
            roughness={0.25}
            depthScale={1.2}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color="#09101d"
            metalness={0.85}
          />
        ) : (
          <meshStandardMaterial color="#09101d" roughness={0.3} metalness={0.8} />
        )}
      </mesh>

      {/* 2. 地砖微弱横向拼缝细线（网格感） */}
      <instancedMesh ref={instancedCrossLinesRef} args={[undefined, undefined, nodeCount]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#1e3a8a" transparent opacity={0.4} />
      </instancedMesh>

      {/* 3. 中央能量光轨：发光圆形节点（圆盘） */}
      <instancedMesh ref={instancedNodesRef} args={[undefined, undefined, nodeCount]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.9}
        />
      </instancedMesh>

      {/* 4. 中央纵向贯穿激光微光细线（置于地面上层 Y = 0.006） */}
      <mesh position={[0, 0.006, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.045, windowLength]} />
        <meshBasicMaterial
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.85}
        />
      </mesh>
    </group>
  );
};
