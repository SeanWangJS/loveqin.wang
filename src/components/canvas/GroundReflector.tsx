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

/** 生成柔和高斯光核纹理（消除硬边，呈现平整光学质感） */
function getCoreGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(224, 242, 254, 0.95)'); // 白热亮核
  gradient.addColorStop(0.25, 'rgba(56, 189, 248, 0.75)'); // 冰蓝过渡
  gradient.addColorStop(0.65, 'rgba(14, 165, 233, 0.25)'); // 柔和衰减
  gradient.addColorStop(1, 'rgba(2, 132, 199, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 生成地面漫射光池纹理（宽广柔和的深海蓝氛围光） */
function getFloorPoolTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(14, 165, 233, 0.35)');
  gradient.addColorStop(0.35, 'rgba(2, 132, 199, 0.16)');
  gradient.addColorStop(0.75, 'rgba(3, 105, 161, 0.05)');
  gradient.addColorStop(1, 'rgba(2, 132, 199, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 概念设计图 1:1 现代电影级：【深色抛光黑玻璃 + 贴地嵌入式精密光学光圈 (Flat Optical Aperture Nodes)】
 * 1. 彻底剔除 80 年代玩具感：
 *    - 废除粗厚 3D 悬浮球（Sphere）和立体大圆环（Torus）
 *    - 全面采用平整贴地的 2D 纳米级光学光斑（Flat Ring + Soft Gaussian Core + Ambient Pool）
 * 2. 严格受控的屏幕空间亮度（第 3.1 节规范）：
 *    - 光核峰值亮度 ≤ 0.80，绝不喧宾夺主抢夺照片注意力
 *    - 远景节点自然收缩为纤细导引光斑，近景呈现宛如高级镜头光圈般细腻层次
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
  const coreGlowTexture = useMemo(() => getCoreGlowTexture(), []);
  const floorPoolTexture = useMemo(() => getFloorPoolTexture(), []);

  // 实时 60 FPS 无闪烁连续渲染
  useFrame((state) => {
    const currentCamZ = state.camera.position.z;

    // 严格按 nodeSpacing 整数倍平滑步进
    const baseZ = Math.floor(currentCamZ / nodeSpacing) * nodeSpacing;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 1. 更新平整贴地精密光学光圈（Flat Precision Optical Ring）
    if (instancedNodesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        const worldZ = baseZ + localZ;
        const distFromCam = currentCamZ - worldZ;

        // 连续物理距离计算缩放：近处清晰舒展，远景柔和微缩
        const distFade = THREE.MathUtils.clamp((distFromCam - 3.5) / 65, 0, 1);
        const nodeScale = THREE.MathUtils.lerp(0.34, 0.05, Math.pow(distFade, 0.65));

        // 仅在近中景展示完整外光圈，远景平滑隐藏外环，避免远端像素拥挤
        const ringScale = distFade > 0.65 ? 0.0001 : nodeScale;

        dummy.position.set(0, 0.020, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(ringScale, ringScale, 1);
        dummy.updateMatrix();
        instancedNodesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedNodesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. 更新平整贴地光核与地面柔光扩散池
    if (instancedNodeCoresRef.current && instancedNodeGlowsRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        const worldZ = baseZ + localZ;
        const distFromCam = currentCamZ - worldZ;

        const distFade = THREE.MathUtils.clamp((distFromCam - 3.5) / 65, 0, 1);
        const nodeScale = THREE.MathUtils.lerp(0.34, 0.05, Math.pow(distFade, 0.65));

        // 贴地高斯平滑微晶光核（扁平 2D 圆盘，彻底告别 3D 大实心球）
        dummy.position.set(0, 0.022, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 0.42, nodeScale * 0.42, 1);
        dummy.updateMatrix();
        instancedNodeCoresRef.current.setMatrixAt(i, dummy.matrix);

        // 地面漫射氛围光晕池（贴合黑玻璃地砖柔和晕染）
        dummy.position.set(0, 0.016, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 4.6, nodeScale * 4.6, 1);
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
        dummy.position.set(0, 0.018, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(trackWidth * 0.96, 0.022, 1);
        dummy.updateMatrix();
        instancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 4. 地砖纵向发光拼缝
    if (instancedLongitudinalLinesRef.current) {
      for (let i = 0; i < tileColumnCount; i++) {
        const x = -trackWidth * 0.42 + (trackWidth * 0.84 / (tileColumnCount - 1)) * i;
        dummy.position.set(x, 0.018, 20 - windowLength / 2);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(0.020, windowLength, 1);
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
          opacity={0.34}
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
          opacity={0.30}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 4. 现代扁平嵌入式光学精密外环（Flat Optical Aperture Ring，彻底替换 3D 粗圆环） */}
      <instancedMesh ref={instancedNodesRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <ringGeometry args={[0.78, 0.84, 48]} />
        <meshBasicMaterial
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.65}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 5. 现代微晶高斯平滑光核（Flat Optical Core，彻底替换 3D 实心球） */}
      <instancedMesh ref={instancedNodeCoresRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={coreGlowTexture}
          color="#bae6fd"
          toneMapped={false}
          transparent
          opacity={0.80}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 6. 地面漫射氛围光晕池（贴合黑玻璃地砖柔和晕染） */}
      <instancedMesh ref={instancedNodeGlowsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={floorPoolTexture}
          color="#0284c7"
          toneMapped={false}
          transparent
          opacity={0.35}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 7. 中央纵向贯穿激光光轨（纤细锐利核心） */}
      <mesh position={[0, 0.021, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.16, windowLength]} />
        <meshBasicMaterial
          color="#0284c7"
          toneMapped={false}
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.022, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.024, windowLength]} />
        <meshBasicMaterial
          color="#7dd3fc"
          toneMapped={false}
          transparent
          opacity={0.60}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};
