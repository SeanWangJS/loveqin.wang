import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { YearPortalInfo } from '../../utils/spatialMapping';

interface TimePortalGateProps {
  portal: YearPortalInfo;
  cameraZ: number;
}

// 纯本地 Canvas 动态生成发光文字贴图（0 网络依赖、0 Suspense 阻塞）
function createYearBillboardTexture(year: number, count: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 512, 256);

  // 霓虹发光文字
  ctx.shadowColor = '#38bdf8';
  ctx.shadowBlur = 25;

  ctx.fillStyle = '#e0f2fe';
  ctx.font = '900 100px monospace, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${year}`, 256, 95);

  // 副标
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 30px monospace, sans-serif';
  ctx.fillText(`· ${count} MEMORIES ·`, 256, 185);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const TimePortalGate: React.FC<TimePortalGateProps> = ({ portal, cameraZ }) => {
  const outerRingRef = useRef<THREE.Mesh>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  // 记忆化本地 Canvas 贴图
  const textTexture = useMemo(() => {
    return createYearBillboardTexture(portal.year, portal.photoCount);
  }, [portal.year, portal.photoCount]);

  // 视口外剔除：仅在相机前后 95 个单位内渲染
  const zDiff = Math.abs(cameraZ - portal.z);
  if (zDiff > 95) return null;

  useFrame((_, delta) => {
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z += delta * 0.3;
    }
    if (outerRingRef.current) {
      outerRingRef.current.rotation.z -= delta * 0.15;
    }
  });

  return (
    <group ref={groupRef} position={[0, 0.2, portal.z]}>
      {/* 外层主发光同心圆环 */}
      <mesh ref={outerRingRef} position={[0, 0, 0]}>
        <ringGeometry args={[3.8, 4.0, 48]} />
        <meshBasicMaterial
          color="#38bdf8"
          transparent
          opacity={0.65}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 内层反向旋转装饰圆环 */}
      <mesh ref={innerRingRef} position={[0, 0, 0.02]}>
        <ringGeometry args={[3.2, 3.3, 36]} />
        <meshBasicMaterial
          color="#67e8f9"
          transparent
          opacity={0.45}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 左右两侧光束引导柱 */}
      <mesh position={[-4.5, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 6, 12]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} />
      </mesh>
      <mesh position={[4.5, 0, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 6, 12]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} />
      </mesh>

      {/* 悬浮发光年份立体广告牌（CanvasTexture，秒级渲染，零网络阻塞） */}
      <mesh position={[0, 3.6, 0]}>
        <planeGeometry args={[4.2, 2.1]} />
        <meshBasicMaterial
          map={textTexture}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};
