import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { GALLERY_GEOMETRY } from '../../config/galleryGeometry';

interface GroundReflectorProps {
  windowLength?: number;
  trackWidth?: number;
}

function getRadialGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(56, 189, 248, 0.2)');
  gradient.addColorStop(0.12, 'rgba(56, 189, 248, 0.14)');
  gradient.addColorStop(0.42, 'rgba(56, 189, 248, 0.07)');
  gradient.addColorStop(1, 'rgba(56, 189, 248, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 概念设计图同款：【高精镜面反射抛光地砖 + 中央能量微光光轨 (Ground Mirror & Track)】
 * 严谨修正图层 Y 轴高度：所有光轨、节点与网格必须严格位于反射地面上层（Y = 0.005）
 */
export const GroundReflector: React.FC<GroundReflectorProps> = ({
  windowLength = 160,
  trackWidth = GALLERY_GEOMETRY.floorWidth,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const instancedNodesRef = useRef<THREE.InstancedMesh>(null);
  const instancedNodeCoresRef = useRef<THREE.InstancedMesh>(null);
  const instancedNodeGlowsRef = useRef<THREE.InstancedMesh>(null);
  const instancedCrossLinesRef = useRef<THREE.InstancedMesh>(null);
  const instancedLongitudinalLinesRef = useRef<THREE.InstancedMesh>(null);

  const qualityTier = useGalleryStore((s) => s.qualityTier);
  const cameraZ = useGalleryStore((s) => s.cameraZ);

  // 沿走廊 Z 轴排列的微光节点与微弱地砖方格刻度
  const nodeSpacing = 3.6;
  const nodeCount = Math.ceil(windowLength / nodeSpacing);
  const tileColumnCount = 5;

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const radialGlowTexture = useMemo(() => getRadialGlowTexture(), []);

  useFrame(() => {
    // 严格按 nodeSpacing 整数倍平滑步进，确保网格轮转时节点与拼缝 100% 精确重合，杜绝跳动
    const baseZ = Math.floor(cameraZ / nodeSpacing) * nodeSpacing;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 更新中央发光能量节点（置于地面上层 Y = 0.008）
    if (instancedNodesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const z = 20 - i * nodeSpacing;
        const progress = i / Math.max(1, nodeCount - 1);
        const nodeScale = THREE.MathUtils.lerp(0.22, 0.07, progress);
        dummy.position.set(0, 0.045, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale, nodeScale, nodeScale);
        dummy.updateMatrix();
        instancedNodesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedNodesRef.current.instanceMatrix.needsUpdate = true;
    }

    if (instancedNodeCoresRef.current && instancedNodeGlowsRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const z = 20 - i * nodeSpacing;
        const progress = i / Math.max(1, nodeCount - 1);
        const nodeScale = THREE.MathUtils.lerp(0.22, 0.07, progress);

        dummy.position.set(0, 0.09, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(nodeScale * 0.38, nodeScale * 0.38, nodeScale * 0.38);
        dummy.updateMatrix();
        instancedNodeCoresRef.current.setMatrixAt(i, dummy.matrix);

        dummy.position.y = 0.012;
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 4.2, nodeScale * 4.2, 1);
        dummy.updateMatrix();
        instancedNodeGlowsRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedNodeCoresRef.current.instanceMatrix.needsUpdate = true;
      instancedNodeGlowsRef.current.instanceMatrix.needsUpdate = true;
    }

    // 地砖微弱横向拼缝细线（置于地面上层 Y = 0.004）
    if (instancedCrossLinesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const z = 20 - i * nodeSpacing;
        dummy.position.set(0, 0.012, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(trackWidth * 0.9, 0.018, 0.018);
        dummy.updateMatrix();
        instancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    if (instancedLongitudinalLinesRef.current) {
      for (let i = 0; i < tileColumnCount; i++) {
        const x = -trackWidth / 2 + (trackWidth / (tileColumnCount - 1)) * i;
        dummy.position.set(x, 0.012, 20 - windowLength / 2);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.018, 0.018, windowLength);
        dummy.updateMatrix();
        instancedLongitudinalLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedLongitudinalLinesRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} position={[0, GALLERY_GEOMETRY.floorY, 0]}>
      {/* 1. 概念设计图同款：深色抛光黑玻璃地砖 + 柔和朦胧倒影 (Polished Obsidian Glass Reflector) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -windowLength / 2 + 20]}>
        <planeGeometry args={[trackWidth, windowLength]} />
        {qualityTier === 'low' ? (
          <meshStandardMaterial color="#040810" roughness={0.52} metalness={0.24} />
        ) : (
          <MeshReflectorMaterial
            blur={[400, 100]}
            resolution={512}
            mirror={0.45}
            mixBlur={1.0}
            mixStrength={1.6}
            roughness={0.32}
            metalness={0.22}
            depthScale={1.2}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color="#040810"
            distortion={0}
          />
        )}
      </mesh>

      {/* 2. 地砖横向拼缝细线 */}
      <instancedMesh ref={instancedCrossLinesRef} args={[undefined, undefined, nodeCount]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#101c29" transparent opacity={0.14} />
      </instancedMesh>

      {/* 3. 地砖纵向拼缝细线 */}
      <instancedMesh ref={instancedLongitudinalLinesRef} args={[undefined, undefined, tileColumnCount]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#101c29" transparent opacity={0.10} />
      </instancedMesh>

      {/* 4. 中央能量节点外环 */}
      <instancedMesh ref={instancedNodesRef} args={[undefined, undefined, nodeCount]}>
        <torusGeometry args={[0.8, 0.1, 8, 32]} />
        <meshStandardMaterial
          color="#2b9dcc"
          toneMapped={false}
          transparent
          opacity={0.38}
          blending={THREE.NormalBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 5. 中央能量节点核心与柔光 */}
      <instancedMesh ref={instancedNodeCoresRef} args={[undefined, undefined, nodeCount]}>
        <sphereGeometry args={[1, 16, 10]} />
        <meshBasicMaterial
          color="#43b6de"
          toneMapped={false}
          transparent
          opacity={0.26}
          blending={THREE.NormalBlending}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh ref={instancedNodeGlowsRef} args={[undefined, undefined, nodeCount]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={radialGlowTexture}
          color="#1594c1"
          toneMapped={false}
          transparent
          opacity={0.16}
          blending={THREE.NormalBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 6. 中央纵向贯穿激光光轨 */}
      <mesh position={[0, 0.005, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.16, windowLength]} />
        <meshBasicMaterial
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.05}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.006, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.025, windowLength]} />
        <meshBasicMaterial
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.34}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};
