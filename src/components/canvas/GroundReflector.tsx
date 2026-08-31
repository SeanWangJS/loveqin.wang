import React, { useMemo, useRef } from 'react';
import { MeshReflectorMaterial } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';

export const GroundReflector: React.FC = () => {
  const qualityTier = useGalleryStore((s) => s.qualityTier);
  const cameraZ = useGalleryStore((s) => s.cameraZ);
  const instancedDotsRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  // 局部滑动窗口长度：围绕相机前后 160 个单位，极大减轻 GPU 反射计算压力
  const windowLength = 160;
  const dotSpacing = 3;
  const dotCount = Math.floor(windowLength / dotSpacing);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(() => {
    // 地面随相机 Z 轴平滑滑动，实现无限延伸视觉
    if (groupRef.current) {
      groupRef.current.position.z = cameraZ - 40;
    }

    if (!instancedDotsRef.current) return;
    // 计算局部光轨蓝点
    const baseZ = Math.floor((cameraZ + 40) / dotSpacing) * dotSpacing;

    for (let i = 0; i < dotCount; i++) {
      const z = baseZ - i * dotSpacing;
      dummy.position.set(0, -1.95, z);
      dummy.rotation.x = -Math.PI / 2;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instancedDotsRef.current.setMatrixAt(i, dummy.matrix);
    }
    instancedDotsRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {/* 随相机移动的动态反射地面 */}
      <group ref={groupRef} position={[0, -2.0, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[26, windowLength]} />
          {qualityTier !== 'low' ? (
            <MeshReflectorMaterial
              blur={[120, 40]}
              resolution={qualityTier === 'high' ? 512 : 256}
              mirror={0.45}
              mixStrength={1.5}
              roughness={0.45}
              depthScale={1.0}
              minDepthThreshold={0.4}
              maxDepthThreshold={1.2}
              color="#080b10"
              metalness={0.7}
            />
          ) : (
            <meshStandardMaterial
              color="#080b10"
              roughness={0.6}
              metalness={0.3}
            />
          )}
        </mesh>

        {/* 中央光轨细线 */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <planeGeometry args={[0.06, windowLength]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} />
        </mesh>
      </group>

      {/* 中央发光蓝点（全局绝对坐标 InstancedMesh） */}
      <instancedMesh
        ref={instancedDotsRef}
        args={[undefined, undefined, dotCount]}
      >
        <circleGeometry args={[0.12, 12]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.8} />
      </instancedMesh>
    </>
  );
};
