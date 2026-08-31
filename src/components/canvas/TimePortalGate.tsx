import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { YearPortalInfo } from '../../utils/spatialMapping';

interface TimePortalGateProps {
  portal: YearPortalInfo;
  cameraZ: number;
}

/**
 * 优雅空灵的年份空间节点（地面发光同心光环 + 顶部微光拱门弧线，不遮挡卡片视线）
 */
export const TimePortalGate: React.FC<TimePortalGateProps> = ({ portal, cameraZ }) => {
  const pulseRingRef = useRef<THREE.Mesh>(null);
  const archRef = useRef<THREE.Group>(null);

  // 视口外剔除：仅在相机前后 80 个单位内渲染
  const zDiff = Math.abs(cameraZ - portal.z);
  if (zDiff > 80) return null;

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (pulseRingRef.current) {
      const scale = 1 + Math.sin(t * 1.5) * 0.08;
      pulseRingRef.current.scale.set(scale, scale, 1);
    }
  });

  return (
    <group position={[0, 0, portal.z]}>
      {/* 1. 地面年份发光节点圆环（平铺于地面反射层上方） */}
      <group position={[0, -1.94, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        {/* 地面主光环 */}
        <mesh ref={pulseRingRef}>
          <ringGeometry args={[1.2, 1.35, 48]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* 地面内圈光晕 */}
        <mesh position={[0, 0, -0.01]}>
          <circleGeometry args={[1.1, 32]} />
          <meshBasicMaterial
            color="#0284c7"
            transparent
            opacity={0.15}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* 2. 空间高处极细的微光拱形光弧（轻柔环绕，不挡卡片） */}
      <group ref={archRef} position={[0, 1.8, 0]}>
        <mesh rotation={[0, 0, 0]}>
          {/* 上半圆细弧 */}
          <ringGeometry args={[4.8, 4.88, 64, 1, 0, Math.PI]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.25}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* 3. 两侧长廊地面微光立柱指示 */}
      <mesh position={[-5.2, -0.5, 0]}>
        <boxGeometry args={[0.04, 2.8, 0.04]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.2} />
      </mesh>
      <mesh position={[5.2, -0.5, 0]}>
        <boxGeometry args={[0.04, 2.8, 0.04]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.2} />
      </mesh>
    </group>
  );
};
