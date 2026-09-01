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
 * 概念设计图同款：【深邃高光镜面反射地砖 + 极简中央微光能量光轨 (Ground Mirror & Track)】
 * 完整倒映上空悬浮的巨幅照片与柔和天光，呈现概念设计图奢华大气的镜面倒影
 */
export const GroundReflector: React.FC<GroundReflectorProps> = ({
  windowLength = 160,
  trackWidth = 28,
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

    // 更新中央发光能量节点（小巧克制，绝不喧宾夺主）
    if (instancedNodesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const z = 20 - i * nodeSpacing;
        dummy.position.set(0, -1.97, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(0.18, 0.18, 1);
        dummy.updateMatrix();
        instancedNodesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedNodesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 地砖微弱横向拼缝线条
    if (instancedCrossLinesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const z = 20 - i * nodeSpacing;
        dummy.position.set(0, -1.98, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(trackWidth * 0.85, 0.015, 1);
        dummy.updateMatrix();
        instancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} position={[0, -2.0, 0]}>
      {/* 1. 随相机平滑移动的高精奢华镜面反射地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -windowLength / 2 + 20]}>
        <planeGeometry args={[trackWidth, windowLength]} />
        {qualityTier !== 'low' ? (
          <MeshReflectorMaterial
            blur={[90, 30]}
            resolution={qualityTier === 'high' ? 512 : 256}
            mirror={0.48}
            mixStrength={1.8}
            roughness={0.32}
            depthScale={1.2}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color="#050810"
            metalness={0.9}
          />
        ) : (
          <meshStandardMaterial color="#050810" roughness={0.4} metalness={0.8} />
        )}
      </mesh>

      {/* 2. 地砖微弱横向拼缝细线 */}
      <instancedMesh ref={instancedCrossLinesRef} args={[undefined, undefined, nodeCount]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color="#1e293b" transparent opacity={0.25} />
      </instancedMesh>

      {/* 3. 中央能量光轨：沿途均匀排列的发光圆点 */}
      <instancedMesh ref={instancedNodesRef} args={[undefined, undefined, nodeCount]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.85}
        />
      </instancedMesh>

      {/* 4. 中央纵向贯穿激光微光细线 */}
      <mesh position={[0, -1.975, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.035, windowLength]} />
        <meshBasicMaterial
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.75}
        />
      </mesh>
    </group>
  );
};
