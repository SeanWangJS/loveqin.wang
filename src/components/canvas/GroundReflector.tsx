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

/** 生成透镜中心高精聚光晶核贴图：中心高亮度白热光芒，向边缘平滑过渡至电光蓝，同轴融合 */
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

/** 生成紧凑微光漫射池贴图：严格控制光圈半径，紧凑内敛，绝不大面积洗白地面 */
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

/** 生成地砖拼缝交点微晶星芒贴图：极细纳米十字光斑，宛如高级蓝宝石玻璃拼角上的光学微芒 */
function getIntersectionGlintTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;

  // 1. 微型高斯中心光点
  const radGrad = context.createRadialGradient(32, 32, 0, 32, 32, 28);
  radGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  radGrad.addColorStop(0.25, 'rgba(186, 230, 253, 0.80)');
  radGrad.addColorStop(0.55, 'rgba(14, 165, 233, 0.25)');
  radGrad.addColorStop(1, 'rgba(2, 132, 199, 0)');
  context.fillStyle = radGrad;
  context.fillRect(0, 0, 64, 64);

  // 2. 细腻微晶十字轻芒（沿拼缝十字轴微微渗出柔和微光）
  const horizGrad = context.createLinearGradient(0, 32, 64, 32);
  horizGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
  horizGrad.addColorStop(0.5, 'rgba(224, 242, 254, 0.75)');
  horizGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
  context.fillStyle = horizGrad;
  context.fillRect(0, 31, 64, 2);

  const vertGrad = context.createLinearGradient(32, 0, 32, 64);
  vertGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
  vertGrad.addColorStop(0.5, 'rgba(224, 242, 254, 0.75)');
  vertGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
  context.fillStyle = vertGrad;
  context.fillRect(31, 0, 2, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 概念设计图 1:1 纯正现代电影级：【中央 3D 嵌入式微晶透镜 + 地砖线条节点呼吸渗光 Shader (Node-Bleeding Seam Glow)】
 * 1. 地板线条呼吸发光特性：
 *    - 绝非死板实体粗光带，而是真实的“光学渗染微辉光”
 *    - 越靠近交点光度越强（交点处达到饱满电光蓝与高光），中点则自然衰减收拢至几乎不发光（纯黑地砖）
 * 2. 视觉优先级与景深渐隐：
 *    - 远景线条优雅退去，近景呈现出概念图同款精致、呼吸感极强的光学地砖网络
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
  const instancedIntersectionsRef = useRef<THREE.InstancedMesh>(null);
  const instancedCrossLinesRef = useRef<THREE.InstancedMesh>(null);
  const instancedLongitudinalLinesRef = useRef<THREE.InstancedMesh>(null);

  const qualityTier = useGalleryStore((s) => s.qualityTier);

  // 概念图比例：大块科技地砖间距（5.4 单位一格，大气舒展）
  const nodeSpacing = 5.4;
  const nodeCount = Math.ceil(windowLength / nodeSpacing);
  const tileColumnCount = 5; // 5 条纵向微缝（中轴为 2，两侧为 0, 1, 3, 4）
  const satelliteCount = nodeCount * 4; // 两侧 4 条纵线与各横线的交点总数

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lensCoreTexture = useMemo(() => getLensCoreTexture(), []);
  const compactPoolTexture = useMemo(() => getCompactPoolTexture(), []);
  const intersectionGlintTexture = useMemo(() => getIntersectionGlintTexture(), []);

  // 列间距 (X 轴节点间距)
  const colSpacing = (trackWidth * 0.84) / (tileColumnCount - 1);

  // 1. 横向地砖缝呼吸微光 Shader：越靠近交点越亮，中点几乎不发光
  const crossLineShaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColSpacing: { value: colSpacing },
        uCamZ: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING
            vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
          #else
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
          #endif
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        uniform float uColSpacing;
        uniform float uCamZ;
        void main() {
          float x = vWorldPosition.x;
          // 计算到最近交点列的绝对距离（交点位于 0, +-uColSpacing, +-2*uColSpacing）
          float d = abs(mod(x + 0.5 * uColSpacing, uColSpacing) - 0.5 * uColSpacing);
          float u = clamp(d / (0.5 * uColSpacing), 0.0, 1.0); // 0 at node, 1 at midpoint
          
          // 核心特性：越靠近交点光度越强，中点几乎不发光（以指数曲线平滑衰减）：
          float glow = pow(1.0 - u, 2.6);
          
          // 距离相机透视平滑衰减
          float distFromCam = uCamZ - vWorldPosition.z;
          float depthFade = clamp(1.0 - (distFromCam - 3.5) / 46.0, 0.0, 1.0);
          
          // 超出最外侧立柱外的平滑隐退
          float edgeFade = smoothstep(uColSpacing * 2.25, uColSpacing * 1.95, abs(x));
          
          vec3 coreColor = vec3(0.48, 0.88, 1.0); // 亮冰蓝辉光
          vec3 darkColor = vec3(0.04, 0.12, 0.22); // 暗底缝
          vec3 col = mix(darkColor, coreColor, glow);
          
          // 中点透明度极低（仅 0.02 几乎不可见），交点附近达到 0.70 纯净发光
          float alpha = (0.02 + glow * 0.70) * depthFade * edgeFade;
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [colSpacing]);

  // 2. 纵向地砖缝呼吸微光 Shader：越靠近交点越亮，中点几乎不发光
  const longitudinalLineShaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uNodeSpacing: { value: nodeSpacing },
        uCamZ: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING
            vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
          #else
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
          #endif
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        uniform float uNodeSpacing;
        uniform float uCamZ;
        void main() {
          float z = vWorldPosition.z;
          // 计算到最近交点横排的绝对距离（交点位于 20 - j * uNodeSpacing）
          float dZ = abs(mod(z - 20.0 + 0.5 * uNodeSpacing, uNodeSpacing) - 0.5 * uNodeSpacing);
          float v = clamp(dZ / (0.5 * uNodeSpacing), 0.0, 1.0); // 0 at node, 1 at midpoint
          
          // 越靠近交点越亮，中点几乎不发光：
          float glow = pow(1.0 - v, 2.6);
          
          float distFromCam = uCamZ - z;
          float depthFade = clamp(1.0 - (distFromCam - 3.5) / 50.0, 0.0, 1.0);
          
          vec3 coreColor = vec3(0.48, 0.88, 1.0);
          vec3 darkColor = vec3(0.04, 0.12, 0.22);
          vec3 col = mix(darkColor, coreColor, glow);
          
          // 中点透明度极低（0.02），交点处达到 0.65 辉光
          float alpha = (0.02 + glow * 0.65) * depthFade;
          
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [nodeSpacing]);

  // 实时 60 FPS 无闪烁连续渲染
  useFrame((state) => {
    const currentCamZ = state.camera.position.z;

    // 严格按 nodeSpacing 整数倍平滑步进
    const baseZ = Math.floor(currentCamZ / nodeSpacing) * nodeSpacing;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 实时更新 Shader 的相机深度 Uniform
    crossLineShaderMaterial.uniforms.uCamZ.value = currentCamZ;
    longitudinalLineShaderMaterial.uniforms.uCamZ.value = currentCamZ;

    // 1. 更新中央 3D 立体微晶透镜、同轴强光核、金属嵌座与紧凑地面光晕
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

        // B. 同轴聚光白热晶核（紧密平铺在透镜顶部表面，与透镜 100% 同心融合，无浮空杂点）
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

    // 2. 更新地砖横纵拼缝交点上的微晶光学引晶点（Satellite Optical Glints）
    if (instancedIntersectionsRef.current) {
      let idx = 0;
      for (let j = 0; j < nodeCount; j++) {
        const localZ = 20 - j * nodeSpacing;
        const worldZ = baseZ + localZ;
        const distFromCam = currentCamZ - worldZ;

        // 仅在近中景（距离相机 3.5 ~ 34 米内）呈现细腻的微晶交点星芒，远景平滑隐退保持纯净黑镜
        const fade = THREE.MathUtils.clamp(1.0 - (distFromCam - 3.5) / 28, 0, 1);
        const glintScale = fade > 0.01 ? 0.30 * Math.pow(fade, 1.3) : 0.0001;

        for (let col = 0; col < 4; col++) {
          const colIndex = col < 2 ? col : col + 1; // 对应列 0, 1, 3, 4 (跳过中轴 2)
          const x = -trackWidth * 0.42 + (trackWidth * 0.84 / (tileColumnCount - 1)) * colIndex;

          dummy.position.set(x, 0.010, localZ);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.set(glintScale, glintScale, 1);
          dummy.updateMatrix();
          instancedIntersectionsRef.current.setMatrixAt(idx++, dummy.matrix);
        }
      }
      instancedIntersectionsRef.current.instanceMatrix.needsUpdate = true;
    }

    // 3. 地砖横向呼吸发光拼缝（跨越走廊全宽）
    if (instancedCrossLinesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        dummy.position.set(0, 0.009, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(trackWidth * 0.96, 0.012, 1);
        dummy.updateMatrix();
        instancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 4. 地砖纵向呼吸发光拼缝
    if (instancedLongitudinalLinesRef.current) {
      for (let i = 0; i < tileColumnCount; i++) {
        const x = -trackWidth * 0.42 + (trackWidth * 0.84 / (tileColumnCount - 1)) * i;
        dummy.position.set(x, 0.009, 20 - windowLength / 2);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(0.012, windowLength, 1);
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

      {/* 2. 地砖横向拼缝：越靠近交点越亮、中点几乎不发光的非实体呼吸微光 Shader */}
      <instancedMesh
        ref={instancedCrossLinesRef}
        args={[undefined, undefined, nodeCount]}
        material={crossLineShaderMaterial}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
      </instancedMesh>

      {/* 3. 地砖纵向拼缝：越靠近交点越亮、中点几乎不发光的非实体呼吸微光 Shader */}
      <instancedMesh
        ref={instancedLongitudinalLinesRef}
        args={[undefined, undefined, tileColumnCount]}
        material={longitudinalLineShaderMaterial}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
      </instancedMesh>

      {/* 4. 拼缝交点微晶光学引晶点（精细微光星芒，概念图同款微细节） */}
      <instancedMesh ref={instancedIntersectionsRef} args={[undefined, undefined, satelliteCount]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={intersectionGlintTexture}
          color="#bae6fd"
          toneMapped={false}
          transparent
          opacity={0.62}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 5. 底部金属/微晶嵌座环（Dark Chrome Bezel，精密底座质感） */}
      <instancedMesh ref={instancedBezelRimsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false}>
        <ringGeometry args={[0.26, 0.32, 32]} />
        <meshStandardMaterial
          color="#0a1a2b"
          roughness={0.25}
          metalness={0.85}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 6. 3D 微晶光学透镜主体（Precision Beveled Crystal Lens） */}
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

      {/* 7. 同心一体化极高亮白热能量晶核（100% 贴合透镜顶部，强光无浮空杂点） */}
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

      {/* 8. 紧凑内敛地面微光漫射池（紧凑包裹信标，绝不大面积泛滥洗白地面） */}
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
    </group>
  );
};
