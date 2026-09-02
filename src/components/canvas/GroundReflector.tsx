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
  gradient.addColorStop(0, 'rgba(56, 189, 248, 0.55)');
  gradient.addColorStop(0.2, 'rgba(14, 165, 233, 0.32)');
  gradient.addColorStop(0.5, 'rgba(2, 132, 199, 0.12)');
  gradient.addColorStop(1, 'rgba(2, 132, 199, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 概念设计图 1:1 高保真：【黑玻璃地砖发光拼缝 + 纯正柔和镜面倒影 + 无闪烁平滑能量光晕】
 * 1. 彻底根除闪烁 Bug：
 *    - 直接从 state.camera.position.z 实时读取每帧真实相机位置，废除节流延迟
 *    - 节点缩放由绝对物理世界距离（distFromCam）平滑连续驱动，杜绝索引跳跃突变
 *    - 严格多层 Y 轴毫米级间隙，杜绝任何 Z-fighting 深度冲突闪烁
 * 2. 镜面倒影与发光科技网格完美呈现
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

  // 概念图比例：大块科技地砖间距（5.4 单位一格，大气舒展）
  const nodeSpacing = 5.4;
  const nodeCount = Math.ceil(windowLength / nodeSpacing);
  const tileColumnCount = 5; // 5 条纵向光轨划分大块地砖

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const radialGlowTexture = useMemo(() => getRadialGlowTexture(), []);

  // 实时 60 FPS 无闪烁更新
  useFrame((state) => {
    const currentCamZ = state.camera.position.z;

    // 严格按 nodeSpacing 整数倍平滑步进
    const baseZ = Math.floor(currentCamZ / nodeSpacing) * nodeSpacing;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 1. 更新中央发光能量节点外环（基于物理真实相机距离连续计算缩放，彻底杜绝闪烁突变）
    if (instancedNodesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        const worldZ = baseZ + localZ;
        const distFromCam = currentCamZ - worldZ;

        // 核心消除闪烁：连续距离插值（4~80 米平滑渐缩），杜绝数组索引突变
        const distFade = THREE.MathUtils.clamp((distFromCam - 3.5) / 70, 0, 1);
        const nodeScale = THREE.MathUtils.lerp(0.38, 0.08, Math.pow(distFade, 0.65));

        dummy.position.set(0, 0.045, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale, nodeScale, nodeScale);
        dummy.updateMatrix();
        instancedNodesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedNodesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. 更新中央能量核与地面扩散光晕池
    if (instancedNodeCoresRef.current && instancedNodeGlowsRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        const worldZ = baseZ + localZ;
        const distFromCam = currentCamZ - worldZ;

        const distFade = THREE.MathUtils.clamp((distFromCam - 3.5) / 70, 0, 1);
        const nodeScale = THREE.MathUtils.lerp(0.38, 0.08, Math.pow(distFade, 0.65));

        // 核心高光球
        dummy.position.set(0, 0.085, localZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(nodeScale * 0.45, nodeScale * 0.45, nodeScale * 0.45);
        dummy.updateMatrix();
        instancedNodeCoresRef.current.setMatrixAt(i, dummy.matrix);

        // 地面漫射光晕圆盘
        dummy.position.set(0, 0.026, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 5.8, nodeScale * 5.8, 1);
        dummy.updateMatrix();
        instancedNodeGlowsRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedNodeCoresRef.current.instanceMatrix.needsUpdate = true;
      instancedNodeGlowsRef.current.instanceMatrix.needsUpdate = true;
    }

    // 3. 地砖横向发光拼缝（跨越走廊全宽）
    if (instancedCrossLinesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        dummy.position.set(0, 0.020, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(trackWidth * 0.96, 0.024, 1);
        dummy.updateMatrix();
        instancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 4. 地砖纵向发光拼缝
    if (instancedLongitudinalLinesRef.current) {
      for (let i = 0; i < tileColumnCount; i++) {
        const x = -trackWidth * 0.42 + (trackWidth * 0.84 / (tileColumnCount - 1)) * i;
        dummy.position.set(x, 0.020, 20 - windowLength / 2);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(0.022, windowLength, 1);
        dummy.updateMatrix();
        instancedLongitudinalLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedLongitudinalLinesRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} position={[0, GALLERY_GEOMETRY.floorY, 0]}>
      {/* 1. 概念图同款：深色抛光黑玻璃地砖 + 清晰通透倒影 (Obsidian Glass Reflector) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -windowLength / 2 + 20]}>
        <planeGeometry args={[trackWidth, windowLength]} />
        {qualityTier === 'low' ? (
          <meshStandardMaterial color="#040810" roughness={0.42} metalness={0.24} />
        ) : (
          <MeshReflectorMaterial
            blur={[150, 40]}
            resolution={512}
            mirror={0.65}
            mixBlur={0.6}
            mixStrength={2.6}
            roughness={0.16}
            metalness={0.22}
            depthScale={1.4}
            minDepthThreshold={0.2}
            maxDepthThreshold={1.8}
            color="#040810"
            distortion={0}
          />
        )}
      </mesh>

      {/* 2. 地砖横向发光拼缝（微发光冰蓝细线，概念图核心光效） */}
      <instancedMesh ref={instancedCrossLinesRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="#1e4d7a"
          toneMapped={false}
          transparent
          opacity={0.38}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 3. 地砖纵向发光拼缝（纵深导引线） */}
      <instancedMesh ref={instancedLongitudinalLinesRef} args={[undefined, undefined, tileColumnCount]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="#1a4268"
          toneMapped={false}
          transparent
          opacity={0.34}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 4. 中央发光能量节点外环 */}
      <instancedMesh ref={instancedNodesRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <torusGeometry args={[0.8, 0.08, 12, 36]} />
        <meshBasicMaterial
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.82}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 5. 中央发光能量节点核心与扩散光晕池 */}
      <instancedMesh ref={instancedNodeCoresRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial
          color="#bae6fd"
          toneMapped={false}
          transparent
          opacity={0.92}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>
      <instancedMesh ref={instancedNodeGlowsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={radialGlowTexture}
          color="#0284c7"
          toneMapped={false}
          transparent
          opacity={0.42}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 6. 中央纵向贯穿激光光轨（纤细锐利核心） */}
      <mesh position={[0, 0.024, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.18, windowLength]} />
        <meshBasicMaterial
          color="#0284c7"
          toneMapped={false}
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.025, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.028, windowLength]} />
        <meshBasicMaterial
          color="#7dd3fc"
          toneMapped={false}
          transparent
          opacity={0.65}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};
