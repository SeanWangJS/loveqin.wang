import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { getTimeTemperature } from '../../utils/timeTemperature';
import { GALLERY_GEOMETRY } from '../../config/galleryGeometry';

interface GalleryWallsProps {
  wallWidth?: number; // 左右墙壁距离中心半宽，默认 6.5
  windowLength?: number;
}

/**
 * 概念设计图同款：【深邃科技画廊侧墙与水平微光光纤/激光线条 (Gallery Architectural Walls)】
 * 赋予长廊真实的建筑实体感，彻底消除空旷虚空，衬托照片与地砖的悬浮通透质感
 */
export const GalleryWalls: React.FC<GalleryWallsProps> = ({
  wallWidth = GALLERY_GEOMETRY.wallHalfWidth,
  windowLength = 160,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const leftLinesRef = useRef<THREE.InstancedMesh>(null);
  const rightLinesRef = useRef<THREE.InstancedMesh>(null);
  const leftPanelsRef = useRef<THREE.InstancedMesh>(null);
  const rightPanelsRef = useRef<THREE.InstancedMesh>(null);

  const activeYear = useGalleryStore((s) => s.activeYear);
  const theme = useMemo(() => getTimeTemperature(activeYear), [activeYear]);

  // 墙面水平光纤条带的 Y 坐标高度分布
  const LINE_HEIGHTS = useMemo(() => [-1.35, -0.75, -0.15, 0.45, 1.05, 1.65, 2.25, 2.85, 3.45], []);
  const segmentsPerLine = Math.ceil(windowLength / 14);
  const lineCount = LINE_HEIGHTS.length * segmentsPerLine;

  // 沿走廊 Z 轴均匀排列的墙面板分块 (每块 12 单位长)
  const panelStep = 12;
  const panelCount = Math.ceil(windowLength / panelStep);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 随相机平滑滑动的视窗局部
  useFrame((state) => {
    const cameraZ = state.camera.position.z;
    const baseZ = Math.floor(cameraZ / 10) * 10;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 更新左侧与右侧墙面水平流光线
    if (leftLinesRef.current && rightLinesRef.current) {
      let lineIndex = 0;
      for (let heightIndex = 0; heightIndex < LINE_HEIGHTS.length; heightIndex++) {
        const y = LINE_HEIGHTS[heightIndex];
        for (let segmentIndex = 0; segmentIndex < segmentsPerLine; segmentIndex++) {
          const segmentLength = 3.4 + ((heightIndex + segmentIndex) % 4) * 1.15;
          const stagger = ((heightIndex * 3.7 + segmentIndex * 1.9) % 6) - 3;
          const z = 20 - segmentIndex * 14 + stagger;

          dummy.position.set(-wallWidth + 0.05, y, z);
          dummy.rotation.set(Math.PI / 2, 0, 0);
          dummy.scale.set(1, segmentLength, 1);
          dummy.updateMatrix();
          leftLinesRef.current.setMatrixAt(lineIndex, dummy.matrix);

          dummy.position.set(wallWidth - 0.05, y, z - 3.5);
          dummy.updateMatrix();
          rightLinesRef.current.setMatrixAt(lineIndex, dummy.matrix);
          lineIndex += 1;
        }
      }
      leftLinesRef.current.instanceMatrix.needsUpdate = true;
      rightLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 更新左侧与右侧深色面板分缝
    if (leftPanelsRef.current && rightPanelsRef.current) {
      for (let i = 0; i < panelCount; i++) {
        const z = 20 - i * panelStep;

        // 左墙面板细缝
        dummy.position.set(-wallWidth + 0.02, 1.2, z);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.scale.set(1, 5.5, 1);
        dummy.updateMatrix();
        leftPanelsRef.current.setMatrixAt(i, dummy.matrix);

        // 右墙面板细缝
        dummy.position.set(wallWidth - 0.02, 1.2, z);
        dummy.rotation.set(0, -Math.PI / 2, 0);
        dummy.scale.set(1, 5.5, 1);
        dummy.updateMatrix();
        rightPanelsRef.current.setMatrixAt(i, dummy.matrix);
      }
      leftPanelsRef.current.instanceMatrix.needsUpdate = true;
      rightPanelsRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef}>
      {/* 1. 左侧深色微晶科技墙面基板 */}
      <mesh position={[-wallWidth, GALLERY_GEOMETRY.wallCenterY, -windowLength / 2 + 20]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[windowLength, GALLERY_GEOMETRY.wallHeight]} />
        <meshPhysicalMaterial
          color="#08121b"
          roughness={0.46}
          metalness={0.34}
          clearcoat={0.28}
          clearcoatRoughness={0.38}
        />
      </mesh>

      {/* 2. 右侧深色微晶科技墙面基板 */}
      <mesh position={[wallWidth, GALLERY_GEOMETRY.wallCenterY, -windowLength / 2 + 20]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[windowLength, GALLERY_GEOMETRY.wallHeight]} />
        <meshPhysicalMaterial
          color="#08121b"
          roughness={0.46}
          metalness={0.34}
          clearcoat={0.28}
          clearcoatRoughness={0.38}
        />
      </mesh>

      <mesh position={[0, GALLERY_GEOMETRY.ceilingY, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[wallWidth * 2, windowLength]} />
        <meshStandardMaterial
          color="#02050a"
          roughness={0.72}
          metalness={0.18}
        />
      </mesh>

      <mesh position={[-wallWidth * 0.68, GALLERY_GEOMETRY.ceilingY - 0.04, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.035, windowLength]} />
        <meshBasicMaterial color={theme.pointLightColor} toneMapped={false} transparent opacity={0.45} />
      </mesh>

      <mesh position={[wallWidth * 0.68, GALLERY_GEOMETRY.ceilingY - 0.04, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.035, windowLength]} />
        <meshBasicMaterial color={theme.pointLightColor} toneMapped={false} transparent opacity={0.45} />
      </mesh>

      {/* 3. 左侧墙面水平微光光纤条带（Emissive 发光） */}
      <instancedMesh ref={leftLinesRef} args={[undefined, undefined, lineCount]}>
        <cylinderGeometry args={[0.009, 0.009, 1, 6]} />
        <meshStandardMaterial
          color="#4b7187"
          emissive={theme.pointLightColor}
          emissiveIntensity={0.42}
          toneMapped={false}
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 4. 右侧墙面水平微光光纤条带 */}
      <instancedMesh ref={rightLinesRef} args={[undefined, undefined, lineCount]}>
        <cylinderGeometry args={[0.009, 0.009, 1, 6]} />
        <meshStandardMaterial
          color="#4b7187"
          emissive={theme.pointLightColor}
          emissiveIntensity={0.42}
          toneMapped={false}
          transparent
          opacity={0.22}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 5. 墙面板垂直嵌缝线条（微弱冷灰线，增强建筑网格感） */}
      <instancedMesh ref={leftPanelsRef} args={[undefined, undefined, panelCount]}>
        <planeGeometry args={[0.015, 1]} />
        <meshBasicMaterial color="#263746" transparent opacity={0.18} depthWrite={false} />
      </instancedMesh>

      <instancedMesh ref={rightPanelsRef} args={[undefined, undefined, panelCount]}>
        <planeGeometry args={[0.015, 1]} />
        <meshBasicMaterial color="#263746" transparent opacity={0.18} depthWrite={false} />
      </instancedMesh>
    </group>
  );
};
