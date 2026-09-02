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
 * 概念设计图 1:1 纯正现代电影级：【双层视差透明微晶黑玻璃地板 (Dual-Layer Parallax Glass Floor)】
 * 1. 上层玻璃表层 (Y = 0.00)：
 *    - 88% 抛光高反黑玻璃（MeshReflectorMaterial），清晰映照照片倒影
 *    - 表层 3D 嵌入式微晶透镜、高亮光核与表层呼吸拼缝
 * 2. 下层玻璃结构基底 (Y = -0.38，约 38cm 物理夹胶层深度)：
 *    - 完整复制一层微缝、交点星芒与微光信标，沉在下层内部
 *    - 整体透明度调为低饱和幽深蓝（alpha ≈ 0.25），呈现若隐若现的内部折射层
 *    - 随着相机推进行驶或视角旋转，上下两层产生极其真实的物理透视视差（Parallax），瞬间爆发出沉重、通透的 40cm 厚玻璃质感！
 */
export const GroundReflector: React.FC<GroundReflectorProps> = ({
  windowLength = 160,
  trackWidth = GALLERY_GEOMETRY.floorWidth,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  
  // 上表层实例引用
  const instancedLensesRef = useRef<THREE.InstancedMesh>(null);
  const instancedHotCoresRef = useRef<THREE.InstancedMesh>(null);
  const instancedBezelRimsRef = useRef<THREE.InstancedMesh>(null);
  const instancedPoolsRef = useRef<THREE.InstancedMesh>(null);
  const instancedIntersectionsRef = useRef<THREE.InstancedMesh>(null);
  const instancedCrossLinesRef = useRef<THREE.InstancedMesh>(null);
  const instancedLongitudinalLinesRef = useRef<THREE.InstancedMesh>(null);

  // 下层基底实例引用（用于构建 38cm 双层视差）
  const subInstancedCrossLinesRef = useRef<THREE.InstancedMesh>(null);
  const subInstancedLongitudinalLinesRef = useRef<THREE.InstancedMesh>(null);
  const subInstancedIntersectionsRef = useRef<THREE.InstancedMesh>(null);
  const subInstancedBeaconsRef = useRef<THREE.InstancedMesh>(null);

  const qualityTier = useGalleryStore((s) => s.qualityTier);

  // 概念图比例：大块科技地砖间距（5.4 单位一格，大气舒展）
  const nodeSpacing = 5.4;
  const nodeCount = Math.ceil(windowLength / nodeSpacing);
  const tileColumnCount = 5; // 5 条纵向微缝（中轴为 2，两侧为 0, 1, 3, 4）
  const satelliteCount = nodeCount * 4; // 两侧 4 条纵线与各横线的交点总数

  // 双层玻璃物理深度差：扩大 3 倍以上深潜距离（下沉 1.25 单位，提供极具张力的深空视差）
  const subLayerY = -1.25;

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const lensCoreTexture = useMemo(() => getLensCoreTexture(), []);
  const compactPoolTexture = useMemo(() => getCompactPoolTexture(), []);
  const intersectionGlintTexture = useMemo(() => getIntersectionGlintTexture(), []);

  // 列间距 (X 轴节点间距)
  const colSpacing = (trackWidth * 0.84) / (tileColumnCount - 1);

  // 1. 上层横向地砖缝呼吸微光 Shader
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
          float d = abs(mod(x + 0.5 * uColSpacing, uColSpacing) - 0.5 * uColSpacing);
          float u = clamp(d / (0.5 * uColSpacing), 0.0, 1.0);
          float glow = pow(1.0 - u, 2.6);
          float distFromCam = uCamZ - vWorldPosition.z;
          float depthFade = clamp(1.0 - (distFromCam - 3.5) / 46.0, 0.0, 1.0);
          float edgeFade = smoothstep(uColSpacing * 2.25, uColSpacing * 1.95, abs(x));
          vec3 coreColor = vec3(0.48, 0.88, 1.0);
          vec3 darkColor = vec3(0.04, 0.12, 0.22);
          vec3 col = mix(darkColor, coreColor, glow);
          float alpha = (0.02 + glow * 0.70) * depthFade * edgeFade;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [colSpacing]);

  // 2. 上层纵向地砖缝呼吸微光 Shader
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
          float dZ = abs(mod(z - 20.0 + 0.5 * uNodeSpacing, uNodeSpacing) - 0.5 * uNodeSpacing);
          float v = clamp(dZ / (0.5 * uNodeSpacing), 0.0, 1.0);
          float glow = pow(1.0 - v, 2.6);
          float distFromCam = uCamZ - z;
          float depthFade = clamp(1.0 - (distFromCam - 3.5) / 50.0, 0.0, 1.0);
          vec3 coreColor = vec3(0.48, 0.88, 1.0);
          vec3 darkColor = vec3(0.04, 0.12, 0.22);
          vec3 col = mix(darkColor, coreColor, glow);
          float alpha = (0.02 + glow * 0.65) * depthFade;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [nodeSpacing]);

  // 3. 下层横向微光 Shader（38cm 深处透射视差层）
  const subCrossLineShaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColSpacing: { value: colSpacing },
        uCamZ: { value: 0 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
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
        varying vec3 vWorldPosition;
        uniform float uColSpacing;
        uniform float uCamZ;
        void main() {
          float x = vWorldPosition.x;
          float d = abs(mod(x + 0.5 * uColSpacing, uColSpacing) - 0.5 * uColSpacing);
          float u = clamp(d / (0.5 * uColSpacing), 0.0, 1.0);
          float glow = pow(1.0 - u, 2.4);
          float distFromCam = uCamZ - vWorldPosition.z;
          float depthFade = clamp(1.0 - (distFromCam - 3.5) / 42.0, 0.0, 1.0);
          float edgeFade = smoothstep(uColSpacing * 2.25, uColSpacing * 1.95, abs(x));
          vec3 col = vec3(0.12, 0.58, 0.95); // 鲜明深海冰蓝
          float alpha = (0.02 + glow * 0.75) * depthFade * edgeFade;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, [colSpacing]);

  // 4. 下层纵向微光 Shader
  const subLongitudinalLineShaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uNodeSpacing: { value: nodeSpacing },
        uCamZ: { value: 0 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
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
        varying vec3 vWorldPosition;
        uniform float uNodeSpacing;
        uniform float uCamZ;
        void main() {
          float z = vWorldPosition.z;
          float dZ = abs(mod(z - 20.0 + 0.5 * uNodeSpacing, uNodeSpacing) - 0.5 * uNodeSpacing);
          float v = clamp(dZ / (0.5 * uNodeSpacing), 0.0, 1.0);
          float glow = pow(1.0 - v, 2.4);
          float distFromCam = uCamZ - z;
          float depthFade = clamp(1.0 - (distFromCam - 3.5) / 42.0, 0.0, 1.0);
          vec3 col = vec3(0.06, 0.38, 0.68);
          float alpha = (0.01 + glow * 0.28) * depthFade;
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

    // 实时更新全部 Shader 的相机深度 Uniform
    crossLineShaderMaterial.uniforms.uCamZ.value = currentCamZ;
    longitudinalLineShaderMaterial.uniforms.uCamZ.value = currentCamZ;
    subCrossLineShaderMaterial.uniforms.uCamZ.value = currentCamZ;
    subLongitudinalLineShaderMaterial.uniforms.uCamZ.value = currentCamZ;

    // 1. 更新上层中央 3D 微晶透镜与下层微缩信标
    if (
      instancedLensesRef.current &&
      instancedHotCoresRef.current &&
      instancedBezelRimsRef.current &&
      instancedPoolsRef.current &&
      subInstancedBeaconsRef.current
    ) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        const worldZ = baseZ + localZ;
        const distFromCam = currentCamZ - worldZ;

        // 连续物理距离平滑渐缩
        const distFade = THREE.MathUtils.clamp((distFromCam - 3.5) / 75, 0, 1);
        const nodeScale = THREE.MathUtils.lerp(0.38, 0.06, Math.pow(distFade, 0.65));

        // A. 上层：3D 精密微凸晶体透镜 (Y = 0.014)
        dummy.position.set(0, 0.014, localZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(nodeScale, nodeScale * 0.28, nodeScale);
        dummy.updateMatrix();
        instancedLensesRef.current.setMatrixAt(i, dummy.matrix);

        // B. 上层：同轴聚光白热晶核 (Y = 0.015)
        dummy.position.set(0, 0.015, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 0.72, nodeScale * 0.72, 1);
        dummy.updateMatrix();
        instancedHotCoresRef.current.setMatrixAt(i, dummy.matrix);

        // C. 上层：地砖微晶金属嵌座环 (Y = 0.012)
        dummy.position.set(0, 0.012, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 1.08, nodeScale * 1.08, 1);
        dummy.updateMatrix();
        instancedBezelRimsRef.current.setMatrixAt(i, dummy.matrix);

        // D. 上层：紧凑内敛地面电光蓝微晕池 (Y = 0.011)
        dummy.position.set(0, 0.011, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 1.6, nodeScale * 1.6, 1);
        dummy.updateMatrix();
        instancedPoolsRef.current.setMatrixAt(i, dummy.matrix);

        // E. 下层：1.25m 深处的微晶次级信标光点 (Y = subLayerY, 产生强烈纵深视差)
        dummy.position.set(0, subLayerY + 0.005, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(nodeScale * 0.95, nodeScale * 0.95, 1);
        dummy.updateMatrix();
        subInstancedBeaconsRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedLensesRef.current.instanceMatrix.needsUpdate = true;
      instancedHotCoresRef.current.instanceMatrix.needsUpdate = true;
      instancedBezelRimsRef.current.instanceMatrix.needsUpdate = true;
      instancedPoolsRef.current.instanceMatrix.needsUpdate = true;
      subInstancedBeaconsRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. 更新地砖横纵拼缝交点（上层星芒 + 下层深处次级星芒）
    if (instancedIntersectionsRef.current && subInstancedIntersectionsRef.current) {
      let idx = 0;
      for (let j = 0; j < nodeCount; j++) {
        const localZ = 20 - j * nodeSpacing;
        const worldZ = baseZ + localZ;
        const distFromCam = currentCamZ - worldZ;

        const fade = THREE.MathUtils.clamp(1.0 - (distFromCam - 3.5) / 28, 0, 1);
        const glintScale = fade > 0.01 ? 0.30 * Math.pow(fade, 1.3) : 0.0001;

        for (let col = 0; col < 4; col++) {
          const colIndex = col < 2 ? col : col + 1;
          const x = -trackWidth * 0.42 + (trackWidth * 0.84 / (tileColumnCount - 1)) * colIndex;

          // 上层交点星芒 (Y = 0.010)
          dummy.position.set(x, 0.010, localZ);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.set(glintScale, glintScale, 1);
          dummy.updateMatrix();
          instancedIntersectionsRef.current.setMatrixAt(idx, dummy.matrix);

          // 下层交点次级星芒 (Y = subLayerY, 产生视差)
          dummy.position.set(x, subLayerY + 0.004, localZ);
          dummy.scale.set(glintScale * 0.90, glintScale * 0.90, 1);
          dummy.updateMatrix();
          subInstancedIntersectionsRef.current.setMatrixAt(idx, dummy.matrix);

          idx++;
        }
      }
      instancedIntersectionsRef.current.instanceMatrix.needsUpdate = true;
      subInstancedIntersectionsRef.current.instanceMatrix.needsUpdate = true;
    }

    // 3. 更新横向地砖缝（上层实线 + 下层深处微线）
    if (instancedCrossLinesRef.current && subInstancedCrossLinesRef.current) {
      for (let i = 0; i < nodeCount; i++) {
        const localZ = 20 - i * nodeSpacing;
        
        // 上层横线 (Y = 0.009)
        dummy.position.set(0, 0.009, localZ);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(trackWidth * 0.96, 0.012, 1);
        dummy.updateMatrix();
        instancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);

        // 下层横线 (Y = subLayerY + 0.002, 视差层)
        dummy.position.set(0, subLayerY + 0.002, localZ);
        dummy.scale.set(trackWidth * 0.96, 0.016, 1);
        dummy.updateMatrix();
        subInstancedCrossLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
      subInstancedCrossLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 4. 更新纵向地砖缝（上层实线 + 下层深处微线）
    if (instancedLongitudinalLinesRef.current && subInstancedLongitudinalLinesRef.current) {
      for (let i = 0; i < tileColumnCount; i++) {
        const x = -trackWidth * 0.42 + (trackWidth * 0.84 / (tileColumnCount - 1)) * i;

        // 上层纵线 (Y = 0.009)
        dummy.position.set(x, 0.009, 20 - windowLength / 2);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(0.012, windowLength, 1);
        dummy.updateMatrix();
        instancedLongitudinalLinesRef.current.setMatrixAt(i, dummy.matrix);

        // 下层纵线 (Y = subLayerY + 0.002, 视差层)
        dummy.position.set(x, subLayerY + 0.002, 20 - windowLength / 2);
        dummy.scale.set(0.016, windowLength, 1);
        dummy.updateMatrix();
        subInstancedLongitudinalLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      instancedLongitudinalLinesRef.current.instanceMatrix.needsUpdate = true;
      subInstancedLongitudinalLinesRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} position={[0, GALLERY_GEOMETRY.floorY, 0]}>
      {/* ==================== A. 下层结构基底 (Sub-Surface Layer: renderOrder 1~2) ==================== */}
      {/* 底部深空沉浸吸收板 (renderOrder = 1) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, subLayerY - 0.01, -windowLength / 2 + 20]} renderOrder={1}>
        <planeGeometry args={[trackWidth, windowLength]} />
        <meshBasicMaterial color="#020509" depthWrite={false} />
      </mesh>

      {/* 下层横向呼吸拼缝 (renderOrder = 2) */}
      <instancedMesh
        ref={subInstancedCrossLinesRef}
        args={[undefined, undefined, nodeCount]}
        material={subCrossLineShaderMaterial}
        frustumCulled={false}
        renderOrder={2}
      >
        <planeGeometry args={[1, 1]} />
      </instancedMesh>

      {/* 下层纵向呼吸拼缝 (renderOrder = 2) */}
      <instancedMesh
        ref={subInstancedLongitudinalLinesRef}
        args={[undefined, undefined, tileColumnCount]}
        material={subLongitudinalLineShaderMaterial}
        frustumCulled={false}
        renderOrder={2}
      >
        <planeGeometry args={[1, 1]} />
      </instancedMesh>

      {/* 下层交点次级星芒 (renderOrder = 2) */}
      <instancedMesh ref={subInstancedIntersectionsRef} args={[undefined, undefined, satelliteCount]} frustumCulled={false} renderOrder={2}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          map={intersectionGlintTexture}
          color="#38bdf8"
          toneMapped={false}
          transparent
          opacity={0.65}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 下层微缩次级信标光点 (renderOrder = 2) */}
      <instancedMesh ref={subInstancedBeaconsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false} renderOrder={2}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial
          map={compactPoolTexture}
          color="#0ea5e9"
          toneMapped={false}
          transparent
          opacity={0.60}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </instancedMesh>

      {/* ==================== B. 上层高反黑玻璃 (Surface Layer: renderOrder 3) ==================== */}
      {/* 1. 概念图同款：深色抛光黑玻璃地砖 + 清晰通透倒影 (Obsidian Glass Reflector)
             renderOrder = 3 确保 100% 在下层之后渲染，对下层所有线条和节点施加精确的 88% 不透明度遮掩！ */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -windowLength / 2 + 20]} renderOrder={3}>
        <planeGeometry args={[trackWidth, windowLength]} />
        {qualityTier === 'low' ? (
          <meshStandardMaterial color="#040810" roughness={0.42} metalness={0.24} transparent opacity={0.88} />
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
            transparent
            opacity={0.88}
            depthWrite={false}
          />
        )}
      </mesh>

      {/* ==================== C. 上层表面微结构 (Surface Elements: renderOrder 4) ==================== */}
      {/* 2. 上层横向地砖缝呼吸微光 */}
      <instancedMesh
        ref={instancedCrossLinesRef}
        args={[undefined, undefined, nodeCount]}
        material={crossLineShaderMaterial}
        frustumCulled={false}
        renderOrder={4}
      >
        <planeGeometry args={[1, 1]} />
      </instancedMesh>

      {/* 3. 上层纵向地砖缝呼吸微光 */}
      <instancedMesh
        ref={instancedLongitudinalLinesRef}
        args={[undefined, undefined, tileColumnCount]}
        material={longitudinalLineShaderMaterial}
        frustumCulled={false}
        renderOrder={4}
      >
        <planeGeometry args={[1, 1]} />
      </instancedMesh>

      {/* 4. 上层拼缝交点微晶星芒 */}
      <instancedMesh ref={instancedIntersectionsRef} args={[undefined, undefined, satelliteCount]} frustumCulled={false} renderOrder={4}>
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

      {/* 5. 上层底部金属/微晶嵌座环 */}
      <instancedMesh ref={instancedBezelRimsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false} renderOrder={4}>
        <ringGeometry args={[0.26, 0.32, 32]} />
        <meshStandardMaterial
          color="#0a1a2b"
          roughness={0.25}
          metalness={0.85}
          depthWrite={false}
        />
      </instancedMesh>

      {/* 6. 上层 3D 微晶光学透镜主体 */}
      <instancedMesh ref={instancedLensesRef} args={[undefined, undefined, nodeCount]} frustumCulled={false} renderOrder={4}>
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

      {/* 7. 上层同心一体化极高亮白热能量晶核 */}
      <instancedMesh ref={instancedHotCoresRef} args={[undefined, undefined, nodeCount]} frustumCulled={false} renderOrder={4}>
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

      {/* 8. 上层紧凑内敛地面微光漫射池 */}
      <instancedMesh ref={instancedPoolsRef} args={[undefined, undefined, nodeCount]} frustumCulled={false} renderOrder={4}>
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
