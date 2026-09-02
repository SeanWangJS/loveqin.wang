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

/** 生成透镜中心高精聚光晶核贴图：中心高亮度白热光芒，向边缘平滑过渡至电光蓝，100% 同轴融合无任何突兀杂点 */
function getLensCoreTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)'); // 极高强度白热光子核
  gradient.addColorStop(0.28, 'rgba(186, 230, 253, 0.95)'); // 冰蓝过渡
  gradient.addColorStop(0.60, 'rgba(56, 189, 248, 0.60)'); // 电光蓝光晕
  gradient.addColorStop(1.0, 'rgba(14, 165, 233, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 生成紧凑微光漫射池贴图：严格控制光圈半径，高光强、紧凑内敛、绝不大面积洗白地面 */
function getCompactPoolTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(56, 189, 248, 0.85)'); // 强光聚焦点
  gradient.addColorStop(0.28, 'rgba(14, 165, 233, 0.50)'); // 紧凑电光蓝
  gradient.addColorStop(0.65, 'rgba(2, 132, 199, 0.12)'); // 快速衰减收拢
  gradient.addColorStop(1.0, 'rgba(2, 132, 199, 0)'); // 边缘彻底切断，绝不溢出漫延
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 概念设计图 1:1 纯正现代电影级：【3D 嵌入式微晶透镜 + 聚拢强光微孔 (Cohesive 3D Optical Lens)】
 * 1. 消除突兀白点：
 *    - 删除了脱离透镜悬浮在空中的多余球体，将白热能量核与透镜同轴一体化紧密嵌入
 * 2. 强光感与紧凑收拢：
 *    - 光核保持极高白热亮度与纯净 Bloom，但漫射光圈范围大幅收拢（由 5.2 倍大面积洗白缩小为 1.6 倍紧凑光环）
 *    - 黑玻璃地砖大面积保持深邃幽暗与清晰倒影，光效内敛、高级、深邃
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
  const lensCoreTexture = useMemo(() => getLensCoreTexture(), []);
  const compactPoolTexture = useMemo(() => getCompactPoolTexture(), []);

  // 实时 60 FPS 无闪烁连续渲染
  useFrame((state) => {
    const currentCamZ = state.camera.position.z;

    // 严格按 nodeSpacing 整数倍平滑步进
    const baseZ = Math.floor(currentCamZ / nodeSpacing) * nodeSpacing;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 1. 更新 3D 立体微晶透镜、同轴强光核、金属嵌座与紧凑地面光晕
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
        const nodeScale = THREE.MathUtils.lerp(0.38, 0.06, Math.pow(distFade, 0.65));

        // A. 3D 精密微凸晶体透镜（扁平微凸圆台柱，真实物理倒角受光与立体感）
        dummy.position.set(0, 0.014, localZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(nodeScale, nodeScale * 0.28, nodeScale);
        dummy.updateMatrix();
        instancedLensesRef.current.setMatrixAt(i, dummy.matrix);

        // B. 同轴聚光白热晶核（紧密平铺在透镜顶部表面，与透镜 100% 同心融合，彻底消除浮空杂点）
        dummy.position.set(0, 0.015, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 0.72, nodeScale * 0.72, 1);
        dummy.updateMatrix();
        instancedHotCoresRef.current.setMatrixAt(i, dummy.matrix);

        // C. 地砖微晶金属嵌座环（紧贴透镜边缘，提供物理质感）
        dummy.position.set(0, 0.012, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 1.08, nodeScale * 1.08, 1);
        dummy.updateMatrix();
        instancedBezelRimsRef.current.setMatrixAt(i, dummy.matrix);

        // D. 紧凑内敛地面电光蓝微晕池（紧紧包裹透镜基座，绝不大面积洗白地面）
        dummy.position.set(0, 0.011, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 1.6, nodeScale * 1.6, 1);
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

      {/* 4. 底部金属/微晶嵌座环（Dark Chrome Bezel，精密底座质感） */}
      <instancedMesh ref={instancedBezelRimsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <ringGeometry args={[0.26, 0.32, 32]} />
        <meshStandardMaterial
          color="#0a1a2b"
          roughness={0.25}
          metalness={0.85}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 5. 3D 微晶光学透镜主体（Precision Beveled Crystal Lens） */}
      <instancedMesh ref={instancedLensesRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <cylinderGeometry args={[0.20, 0.26, 0.025, 32]} />
        <meshPhysicalMaterial
          color="#0284c7"
          emissive="#0284c7"
          emissiveIntensity={1.2}
          roughness={0.10}
          metalness={0.20}
          clearcoat={1.0}
          clearcoatRoughness={0.08}
          toneMapped={false}
        />
      </instancedMesh>

      {/* 6. 同心一体化极高亮白热能量晶核（100% 贴合透镜顶部，强光无浮空杂点） */}
      <instancedMesh ref={instancedHotCoresRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={lensCoreTexture}
          color="#ffffff"
          toneMapped={false}
          transparent
          opacity={1.0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 7. 紧凑内敛地面微光漫射池（紧凑包裹信标，绝不大面积泛滥洗白地面） */}
      <instancedMesh ref={instancedPoolsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={compactPoolTexture}
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.45}
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
