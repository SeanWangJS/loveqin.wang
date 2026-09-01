import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { getTimeTemperature } from '../../utils/timeTemperature';

interface GroundReflectorProps {
  windowLength?: number; // 滑动视窗长度，默认 160 单位
  trackWidth?: number;   // 反射地砖宽度，默认 24 单位
}

/**
 * 概念设计图同款：【高精抛光地砖镜面网格 + 中央能量光轨发光圆盘节点 (Polished Grid Floor & Energy Track)】
 */
export const GroundReflector: React.FC<GroundReflectorProps> = ({
  windowLength = 160,
  trackWidth = 24,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const instancedNodesRef = useRef<THREE.InstancedMesh>(null);
  const instancedCrossLinesRef = useRef<THREE.InstancedMesh>(null);
  const activeRingRef = useRef<THREE.Group>(null);

  const qualityTier = useGalleryStore((s) => s.qualityTier);
  const activeYear = useGalleryStore((s) => s.activeYear);
  const cameraZ = useGalleryStore((s) => s.cameraZ);

  const theme = useMemo(() => getTimeTemperature(activeYear), [activeYear]);

  // 沿走廊 Z 轴排列的圆形能量节点与地砖横向网格刻度
  const nodeSpacing = 3.6;
  const nodeCount = Math.ceil(windowLength / nodeSpacing);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 随相机移动更新局部视窗与光盘阵列
  useFrame(() => {
    const baseZ = Math.floor(cameraZ / 10) * 10;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 更新中央圆形能量节点（圆盘）
    if (instancedNodesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const z = 20 - i * nodeSpacing;
        dummy.position.set(0, -1.97, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(0.22, 0.22, 1);
        dummy.updateMatrix();
        instancedNodesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedNodesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 更新地面抛光方格细线 (网格感)
    if (instancedCrossLinesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const z = 20 - i * nodeSpacing;
        dummy.position.set(0, -1.98, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(trackWidth * 0.9, 0.02, 1);
        dummy.updateMatrix();
        instancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 更新当前相机焦点处的高亮双层能量光环 (Active Node Ring)
    if (activeRingRef.current) {
      // 焦点处于相机前方 10 单位处
      const focusZ = cameraZ - 10;
      const snapZ = Math.round(focusZ / nodeSpacing) * nodeSpacing;
      activeRingRef.current.position.set(0, -1.96, snapZ);
    }
  });

  return (
    <>
      {/* 1. 随相机平滑移动的局部高精镜面反射地板 */}
      <group ref={groupRef} position={[0, -2.0, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -windowLength / 2 + 20]}>
          <planeGeometry args={[trackWidth, windowLength]} />
          {qualityTier !== 'low' ? (
            <MeshReflectorMaterial
              blur={[90, 25]}
              resolution={qualityTier === 'high' ? 512 : 256}
              mirror={0.42}
              mixStrength={1.5}
              roughness={0.36}
              depthScale={1.0}
              minDepthThreshold={0.4}
              maxDepthThreshold={1.2}
              color="#04070d"
              metalness={0.88}
            />
          ) : (
            <meshStandardMaterial color="#04070d" roughness={0.4} metalness={0.8} />
          )}
        </mesh>

        {/* 2. 地砖微弱横向拼缝线条 */}
        <instancedMesh ref={instancedCrossLinesRef} args={[undefined, undefined, nodeCount]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial color="#172554" transparent opacity={0.3} />
        </instancedMesh>

        {/* 3. 中央能量光轨：沿途均匀排列的圆形发光光盘节点 (Node Discs) */}
        <instancedMesh ref={instancedNodesRef} args={[undefined, undefined, nodeCount]}>
          <circleGeometry args={[1, 32]} />
          <meshBasicMaterial
            color="#38bdf8"
            toneMapped={false}
            transparent
            opacity={0.85}
          />
        </instancedMesh>

        {/* 4. 中央纵向主贯穿激光光束细线 */}
        <mesh position={[0, -1.975, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.04, windowLength]} />
          <meshBasicMaterial
            color="#38bdf8"
            toneMapped={false}
            transparent
            opacity={0.7}
          />
        </mesh>
      </group>

      {/* 5. 概念图核心：当前焦点处的高亮双重发光能量圆盘 (Active Focus Disc) */}
      <group ref={activeRingRef} position={[0, -1.96, 0]}>
        {/* 内层明亮核心光盘 */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.42, 32]} />
          <meshBasicMaterial
            color="#ffffff"
            toneMapped={false}
            transparent
            opacity={0.95}
          />
        </mesh>
        {/* 外层发光扩散圆环 */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.72, 32]} />
          <meshBasicMaterial
            color={theme.pointLightColor}
            toneMapped={false}
            transparent
            opacity={0.8}
          />
        </mesh>
      </group>
    </>
  );
};
