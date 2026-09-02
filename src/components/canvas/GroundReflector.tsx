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

/** 生成高级电影级光学信标贴图：高斯平滑光学微孔，彻底杜绝任何矢量硬边 */
function getBeaconGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(224, 242, 254, 0.95)'); // 白热微孔核心
  gradient.addColorStop(0.18, 'rgba(56, 189, 248, 0.80)'); // 冰蓝内光圈
  gradient.addColorStop(0.45, 'rgba(14, 165, 233, 0.35)'); // 柔和渐变晕染
  gradient.addColorStop(0.78, 'rgba(2, 132, 199, 0.08)'); // 极弱边缘衰减
  gradient.addColorStop(1, 'rgba(2, 132, 199, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 生成地面微光扩散光池贴图：极弱、宽广、柔和的氛围晕染 */
function getAmbientPoolTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(14, 165, 233, 0.22)');
  gradient.addColorStop(0.35, 'rgba(2, 132, 199, 0.10)');
  gradient.addColorStop(0.70, 'rgba(3, 105, 161, 0.03)');
  gradient.addColorStop(1, 'rgba(2, 132, 199, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 概念设计图 1:1 纯正现代电影级：【深色抛光黑玻璃跑道 + 光学嵌入式信标点 (Optical Guide Beacons)】
 * 1. 彻底拔除“发光光带”与“CAD 矢量圆环”：
 *    - 删除了粗糙的 2D 矢量线圈（ringGeometry），回归概念图真实的纯粹柔和光学信标斑点
 *    - 删除了 160 米贯穿的粗厚青色激光带，还原为深邃抛光黑玻璃中极其克制、细腻的建筑微缝（Micro Seams）
 * 2. 纯正黑玻璃地砖建筑质感：
 *    - 地砖横纵拼缝采用沉稳低调的深色微缝（Normal Blending），只在节点处有极其细腻的光学浸润
 *    - 倒影通透深邃，照片在地面上形成高级的倒影投射
 */
export const GroundReflector: React.FC<GroundReflectorProps> = ({
  windowLength = 160,
  trackWidth = GALLERY_GEOMETRY.floorWidth,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const instancedBeaconsRef = useRef<THREE.InstancedMesh>(null);
  const instancedPoolsRef = useRef<THREE.InstancedMesh>(null);
  const instancedCrossLinesRef = useRef<THREE.InstancedMesh>(null);
  const instancedLongitudinalLinesRef = useRef<THREE.InstancedMesh>(null);

  const qualityTier = useGalleryStore((s) => s.qualityTier);

  // 概念图比例：大块科技地砖间距（5.4 单位一格，大气舒展）
  const nodeSpacing = 5.4;
  const nodeCount = Math.ceil(windowLength / nodeSpacing);
  const tileColumnCount = 5; // 5 条纵向微缝划分大块地砖

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const beaconTexture = useMemo(() => getBeaconGlowTexture(), []);
  const ambientPoolTexture = useMemo(() => getAmbientPoolTexture(), []);

  // 实时 60 FPS 无闪烁连续渲染
  useFrame((state) => {
    const currentCamZ = state.camera.position.z;

    // 严格按 nodeSpacing 整数倍平滑步进
    const baseZ = Math.floor(currentCamZ / nodeSpacing) * nodeSpacing;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 1. 更新中央现代光学微晶信标点（Optical Guide Beacons）
    if (instancedBeaconsRef.current && instancedPoolsRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        const worldZ = baseZ + localZ;
        const distFromCam = currentCamZ - worldZ;

        // 连续物理距离平滑渐缩
        const distFade = THREE.MathUtils.clamp((distFromCam - 3.5) / 75, 0, 1);
        const nodeScale = THREE.MathUtils.lerp(0.38, 0.06, Math.pow(distFade, 0.65));

        // 中心高斯光学信标点（贴地柔和圆盘，无任何锯齿硬边）
        dummy.position.set(0, 0.020, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale, nodeScale, 1);
        dummy.updateMatrix();
        instancedBeaconsRef.current.setMatrixAt(i, dummy.matrix);

        // 地面柔和微光漫射池（为近处节点提供柔和光斑氛围）
        dummy.position.set(0, 0.016, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 4.2, nodeScale * 4.2, 1);
        dummy.updateMatrix();
        instancedPoolsRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedBeaconsRef.current.instanceMatrix.needsUpdate = true;
      instancedPoolsRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. 地砖横向建筑微晶拼缝（极细、沉稳、非发光粗光带）
    if (instancedCrossLinesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        dummy.position.set(0, 0.014, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(trackWidth * 0.96, 0.008, 1);
        dummy.updateMatrix();
        instancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 3. 地砖纵向建筑微晶拼缝
    if (instancedLongitudinalLinesRef.current) {
      for (let i = 0; i < tileColumnCount; i++) {
        const x = -trackWidth * 0.42 + (trackWidth * 0.84 / (tileColumnCount - 1)) * i;
        dummy.position.set(x, 0.014, 20 - windowLength / 2);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(0.008, windowLength, 1);
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

      {/* 2. 地砖横向建筑微晶拼缝（极细微缝，沉稳不抢戏，告别粗光带） */}
      <instancedMesh ref={instancedCrossLinesRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="#162e45"
          transparent
          opacity={0.22}
          blending={THREE.NormalBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 3. 地砖纵向建筑微晶拼缝（极细纵深分割微缝） */}
      <instancedMesh ref={instancedLongitudinalLinesRef} args={[undefined, undefined, tileColumnCount]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="#162e45"
          transparent
          opacity={0.18}
          blending={THREE.NormalBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 4. 概念图同款：中央光学高斯微孔信标点（高精柔和光斑，彻底取代硬边矢量圆环） */}
      <instancedMesh ref={instancedBeaconsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={beaconTexture}
          color="#bae6fd"
          toneMapped={false}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 5. 地面微光漫射氛围池（仅在节点四周自然晕开，无任何突兀生硬几何体） */}
      <instancedMesh ref={instancedPoolsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={ambientPoolTexture}
          color="#0284c7"
          toneMapped={false}
          transparent
          opacity={0.30}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 6. 中央精细极细中缝导引线（微米级极细线，彻底替换原粗厚发光带） */}
      <mesh position={[0, 0.015, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.006, windowLength]} />
        <meshBasicMaterial
          color="#1e476e"
          transparent
          opacity={0.25}
          blending={THREE.NormalBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};
