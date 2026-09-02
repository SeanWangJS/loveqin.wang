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

/** 生成地面能量漫射光池贴图：高饱和、强穿透力、向外柔和渐变的光学光晕 */
function getRadiantPoolTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(56, 189, 248, 0.90)'); // 亮烈冰蓝中心光芒
  gradient.addColorStop(0.20, 'rgba(14, 165, 233, 0.65)'); // 高饱和电光蓝光晕
  gradient.addColorStop(0.50, 'rgba(2, 132, 199, 0.28)'); // 深海蓝扩散
  gradient.addColorStop(0.80, 'rgba(3, 105, 161, 0.08)'); // 柔和外延
  gradient.addColorStop(1, 'rgba(2, 132, 199, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 概念设计图 1:1 高保真：【立体微晶光学凸透镜信标 + 强透射能量辉光 (3D Optical Crystal Beacons)】
 * 1. 立体感强化：
 *    - 采用 3D 微凸半球晶体透镜（Dome Lens）+ 底部微晶金属嵌座（Bezel Rim）
 *    - 透镜拥有真实的弧面高光（Physical Clearcoat）与侧面立体受光阴影，彻底告别扁平贴纸感
 * 2. 强亮度与绽放辉光：
 *    - 透镜顶点植入未压缩白热光核（Un-toneMapped Pure White Core），直接穿透 Bloom 阈值迸发纯正光学星芒
 *    - 配合地面强效电光蓝辐射光池，达到与设计图完全一致的通透、强烈与立体质感
 */
export const GroundReflector: React.FC<GroundReflectorProps> = ({
  windowLength = 160,
  trackWidth = GALLERY_GEOMETRY.floorWidth,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const instancedLensesRef = useRef<THREE.InstancedMesh>(null);
  const instancedHotCoresRef = useRef<THREE.InstancedMesh>(null);
  const instancedBezelRimsRef = useRef<THREE.InstancedMesh>(null);
  const instancedPoolsRef = useRef<THREE.InstancedMesh>(null);
  const instancedCrossLinesRef = useRef<THREE.InstancedMesh>(null);
  const instancedLongitudinalLinesRef = useRef<THREE.InstancedMesh>(null);

  const qualityTier = useGalleryStore((s) => s.qualityTier);

  // 概念图比例：大块科技地砖间距（5.4 单位一格，大气舒展）
  const nodeSpacing = 5.4;
  const nodeCount = Math.ceil(windowLength / nodeSpacing);
  const tileColumnCount = 5; // 5 条纵向微缝划分大块地砖

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const radiantPoolTexture = useMemo(() => getRadiantPoolTexture(), []);

  // 实时 60 FPS 无闪烁连续渲染
  useFrame((state) => {
    const currentCamZ = state.camera.position.z;

    // 严格按 nodeSpacing 整数倍平滑步进
    const baseZ = Math.floor(currentCamZ / nodeSpacing) * nodeSpacing;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 1. 更新 3D 立体微晶透镜、白热光核、金属嵌座与地面辐射光晕
    if (
      instancedLensesRef.current &&
      instancedHotCoresRef.current &&
      instancedBezelRimsRef.current &&
      instancedPoolsRef.current
    ) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        const worldZ = baseZ + localZ;
        const distFromCam = currentCamZ - worldZ;

        // 连续物理距离平滑渐缩
        const distFade = THREE.MathUtils.clamp((distFromCam - 3.5) / 75, 0, 1);
        const nodeScale = THREE.MathUtils.lerp(0.42, 0.07, Math.pow(distFade, 0.65));

        // A. 3D 立体微晶光学半球透镜（置于地面微凸位置，形成真实弧面高光）
        dummy.position.set(0, 0.012, localZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(nodeScale, nodeScale * 0.45, nodeScale);
        dummy.updateMatrix();
        instancedLensesRef.current.setMatrixAt(i, dummy.matrix);

        // B. 透镜顶点强亮度白热能量核（极高纯白，强烈激荡 Bloom）
        dummy.position.set(0, 0.012 + nodeScale * 0.28, localZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(nodeScale * 0.38, nodeScale * 0.24, nodeScale * 0.38);
        dummy.updateMatrix();
        instancedHotCoresRef.current.setMatrixAt(i, dummy.matrix);

        // C. 地砖沉浸式微晶金属嵌座环（深沉底座，凸显透镜立体深度）
        dummy.position.set(0, 0.011, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 1.15, nodeScale * 1.15, 1);
        dummy.updateMatrix();
        instancedBezelRimsRef.current.setMatrixAt(i, dummy.matrix);

        // D. 地面强辐射电光蓝漫射光池（向四周黑玻璃大面积投射高光）
        dummy.position.set(0, 0.010, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 5.2, nodeScale * 5.2, 1);
        dummy.updateMatrix();
        instancedPoolsRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedLensesRef.current.instanceMatrix.needsUpdate = true;
      instancedHotCoresRef.current.instanceMatrix.needsUpdate = true;
      instancedBezelRimsRef.current.instanceMatrix.needsUpdate = true;
      instancedPoolsRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. 地砖横向建筑微晶拼缝（极细、沉稳、非发光粗光带）
    if (instancedCrossLinesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        dummy.position.set(0, 0.008, localZ);
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
        dummy.position.set(x, 0.008, 20 - windowLength / 2);
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

      {/* 2. 地砖横向建筑微晶拼缝（极细微缝，沉稳不抢戏） */}
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

      {/* 4. 底部金属/微晶嵌座环（Dark Chrome Bezel，赋予发光体真实的物理底座） */}
      <instancedMesh ref={instancedBezelRimsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <ringGeometry args={[0.36, 0.44, 36]} />
        <meshStandardMaterial
          color="#0d2136"
          roughness={0.28}
          metalness={0.82}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 5. 3D 立体微凸半球光学晶体透镜（Physical Optical Dome Lens） */}
      <instancedMesh ref={instancedLensesRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <sphereGeometry args={[0.38, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshPhysicalMaterial
          color="#38bdf8"
          emissive="#0284c7"
          emissiveIntensity={2.4}
          roughness={0.08}
          metalness={0.20}
          clearcoat={1.0}
          clearcoatRoughness={0.05}
          toneMapped={false}
        />
      </instancedMesh>

      {/* 6. 透镜顶点强亮度白热能量核（Pure White Hot Photon Core，极强光感） */}
      <instancedMesh ref={instancedHotCoresRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <sphereGeometry args={[0.16, 24, 16]} />
        <meshBasicMaterial
          color="#ffffff"
          toneMapped={false}
          transparent
          opacity={1.0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 7. 地面强辐射电光蓝漫射光池（向四周黑玻璃大面积投射高光晕染） */}
      <instancedMesh ref={instancedPoolsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={radiantPoolTexture}
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.58}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 8. 中央精细极细中缝导引线（微米级极细线） */}
      <mesh position={[0, 0.009, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
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
