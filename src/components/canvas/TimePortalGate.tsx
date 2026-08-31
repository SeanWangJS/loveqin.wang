import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { YearPortalInfo } from '../../utils/spatialMapping';

interface TimePortalGateProps {
  portal: YearPortalInfo;
  cameraZ: number;
}

export const TimePortalGate: React.FC<TimePortalGateProps> = ({ portal, cameraZ }) => {
  const outerRingRef = useRef<THREE.Mesh>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  // 视口外剔除：仅在相机前后 110 个单位内渲染
  const zDiff = Math.abs(cameraZ - portal.z);
  if (zDiff > 110) return null;

  useFrame((_, delta) => {
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z += delta * 0.4;
    }
    if (outerRingRef.current) {
      outerRingRef.current.rotation.z -= delta * 0.2;
    }
  });

  return (
    <group ref={groupRef} position={[0, 0.2, portal.z]}>
      {/* 外层主发光同心圆环 */}
      <mesh ref={outerRingRef} position={[0, 0, 0]}>
        <ringGeometry args={[3.8, 4.0, 64]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 内层反向旋转装饰圆环 */}
      <mesh ref={innerRingRef} position={[0, 0, 0.05]}>
        <ringGeometry args={[3.2, 3.3, 48]} />
        <meshBasicMaterial
          color="#67e8f9"
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 左右两侧光束引导柱 */}
      <mesh position={[-4.5, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 6, 16]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.4} />
      </mesh>
      <mesh position={[4.5, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 6, 16]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.4} />
      </mesh>

      {/* 悬浮发光年份立体标识 */}
      <group position={[0, 4.4, 0]}>
        <Text
          color="#38bdf8"
          fontSize={1.2}
          maxWidth={10}
          lineHeight={1}
          letterSpacing={0.15}
          textAlign="center"
          font="https://fonts.gstatic.com/s/orbitron/v31/yMJMMIlzdpvBhQQL_SCW.woff"
          anchorX="center"
          anchorY="middle"
        >
          {`${portal.year}`}
        </Text>
      </group>

      {/* 底部回忆数量副标 */}
      <group position={[0, -2.4, 0]}>
        <Text
          color="#94a3b8"
          fontSize={0.32}
          letterSpacing={0.1}
          textAlign="center"
          anchorX="center"
          anchorY="middle"
        >
          {`· ${portal.photoCount} MEMORIES ·`}
        </Text>
      </group>
    </group>
  );
};
