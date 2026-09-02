import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { getTimeTemperature } from '../../utils/timeTemperature';
import { GALLERY_GEOMETRY } from '../../config/galleryGeometry';

interface GalleryWallsProps {
  wallWidth?: number;
  windowLength?: number;
}

// 确定性随机散列函数，保证多端刷新后散布绝对恒定
function hash2(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * 概念设计图同款：【深邃极简科技画廊侧墙 + 错落非对称彗星流光 (Asymmetric Comet Streams)】
 * 1. 左右两侧高度完全错开（左侧 4 层与右侧 4 层不同高度），Z 轴完全异步散布，彻底消灭“成对/对称”感
 * 2. 差异化白热核心（每颗彗星具有独立的色温与辉光强度）
 * 3. 严格由相机速度驱动：静止时定格，运动时根据速度产生长尾与流光穿梭
 */
export const GalleryWalls: React.FC<GalleryWallsProps> = ({
  wallWidth = GALLERY_GEOMETRY.wallHalfWidth,
  windowLength = 160,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const leftLinesRef = useRef<THREE.InstancedMesh>(null);
  const rightLinesRef = useRef<THREE.InstancedMesh>(null);

  const activeYear = useGalleryStore((s) => s.activeYear);
  const theme = useMemo(() => getTimeTemperature(activeYear), [activeYear]);

  // 物理速度与流动相位跟踪
  const lastCameraZRef = useRef<number | null>(null);
  const velocityRef = useRef(0);
  const streakOffsetRef = useRef(0);

  // 左右两侧墙面采用完全不同、错开的高度层级（彻底避免左右对称）
  const LEFT_HEIGHTS = useMemo(() => [-0.85, -0.25, 0.35, 0.95], []);
  const RIGHT_HEIGHTS = useMemo(() => [-0.55, 0.05, 0.65, 1.25], []);

  const segmentSpacing = 20; // 段落间距
  const segmentsPerLine = Math.ceil(windowLength / segmentSpacing);
  const leftCount = LEFT_HEIGHTS.length * segmentsPerLine;
  const rightCount = RIGHT_HEIGHTS.length * segmentsPerLine;

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 差异化全量彗星流光 Shader
  const meteorShaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uOffset: { value: 0 },
        uVelocity: { value: 0 },
        uColor: { value: new THREE.Color('#38bdf8') },
        uHeadColor: { value: new THREE.Color('#ffffff') },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING
            vec4 worldPos = instanceMatrix * vec4(position, 1.0);
            vWorldPosition = (modelMatrix * worldPos).xyz;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * worldPos;
          #else
            vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #endif
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        varying vec2 vUv;
        uniform float uOffset;
        uniform float uVelocity;
        uniform vec3 uColor;
        uniform vec3 uHeadColor;

        void main() {
          // 基于世界坐标的唯一随机种子：每颗彗星拥有独特的能量与色温
          float cometSeed = sin(floor(vWorldPosition.y * 4.2) * 19.3 + floor(vWorldPosition.z * 0.06) * 47.7);
          float cometHotness = 0.55 + 0.45 * fract(cometSeed * 93.17); // 0.55 ~ 1.0 错落有致的白热度

          // 1. 局部彗星形态（基于局部纵向坐标 vUv.y，0.0 尾端 -> 1.0 头部）
          // ① 差异化白热核心（只有部分核心最耀眼，其余柔和，层次分明）
          float localHead = smoothstep(0.78, 0.98, vUv.y) * cometHotness;
          // ② 柔和指数彗尾
          float localTail = pow(smoothstep(0.02, 0.85, vUv.y), 2.5);

          float cometBase = localTail * 0.85 + localHead * (2.0 + cometHotness * 1.2);

          // 2. 全局速度与时空位移流光波浪调制
          float wave = sin(-vWorldPosition.z * 0.13 + uOffset * 0.85 + cometSeed * 25.0) * 0.5 + 0.5;
          float flowPulse = 0.72 + 0.28 * pow(wave, 2.0);

          // 3. 速度动态拉伸与辉光激发
          float absVel = abs(uVelocity);
          float speedBoost = clamp(absVel * 0.05, 0.0, 1.4);

          float totalIntensity = cometBase * (flowPulse + speedBoost);
          vec3 finalColor = mix(uColor, uHeadColor, localHead * 0.9);

          gl_FragColor = vec4(finalColor * totalIntensity, clamp(totalIntensity * 0.95, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }, []);

  // 随相机移动更新流动偏移量与物理速度
  useFrame((state, delta) => {
    const currentCamZ = state.camera.position.z;

    if (lastCameraZRef.current === null) {
      lastCameraZRef.current = currentCamZ;
    }

    const deltaZ = currentCamZ - lastCameraZRef.current;
    lastCameraZRef.current = currentCamZ;

    // 计算即时物理速度并平滑阻尼跟踪
    const instantVelocity = delta > 0 ? deltaZ / delta : 0;
    velocityRef.current = THREE.MathUtils.damp(velocityRef.current, instantVelocity, 8.0, delta);

    // 仅在相机移动时更新位移偏移量
    streakOffsetRef.current -= deltaZ * 1.6;

    meteorShaderMaterial.uniforms.uOffset.value = streakOffsetRef.current;
    meteorShaderMaterial.uniforms.uVelocity.value = velocityRef.current;
    meteorShaderMaterial.uniforms.uColor.value.copy(theme.pointLightColor);

    const baseZ = Math.floor(currentCamZ / 10) * 10;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 1. 更新左侧墙面彗星流光（独立随机散布）
    if (leftLinesRef.current) {
      let lineIndex = 0;
      for (let hIdx = 0; hIdx < LEFT_HEIGHTS.length; hIdx++) {
        const y = LEFT_HEIGHTS[hIdx];
        for (let sIdx = 0; sIdx < segmentsPerLine; sIdx++) {
          const randVal = hash2(hIdx + 1, sIdx + 1);
          const segmentLength = 2.8 + randVal * 2.4; // 2.8 ~ 5.2 长度错落
          const zOffset = (randVal - 0.5) * 10;
          const z = 20 - sIdx * segmentSpacing + zOffset;

          dummy.position.set(-wallWidth + 0.05, y, z);
          dummy.rotation.set(Math.PI / 2, 0, 0);
          dummy.scale.set(1, segmentLength, 1);
          dummy.updateMatrix();
          leftLinesRef.current.setMatrixAt(lineIndex, dummy.matrix);
          lineIndex += 1;
        }
      }
      leftLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. 更新右侧墙面彗星流光（完全独立算法与不同高度/纵深，彻底消灭成对出现）
    if (rightLinesRef.current) {
      let lineIndex = 0;
      for (let hIdx = 0; hIdx < RIGHT_HEIGHTS.length; hIdx++) {
        const y = RIGHT_HEIGHTS[hIdx];
        for (let sIdx = 0; sIdx < segmentsPerLine; sIdx++) {
          const randVal = hash2(hIdx + 99, sIdx + 77);
          const segmentLength = 3.0 + randVal * 2.2; // 3.0 ~ 5.2 长度错落
          // 右侧加入 -11 的基底错位与独立随机抖动，确保绝不与左侧对齐
          const zOffset = -11 + (randVal - 0.5) * 10;
          const z = 20 - sIdx * segmentSpacing + zOffset;

          dummy.position.set(wallWidth - 0.05, y, z);
          dummy.rotation.set(Math.PI / 2, 0, 0);
          dummy.scale.set(1, segmentLength, 1);
          dummy.updateMatrix();
          rightLinesRef.current.setMatrixAt(lineIndex, dummy.matrix);
          lineIndex += 1;
        }
      }
      rightLinesRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef}>
      {/* 1. 左侧深色微晶科技墙面基板 */}
      <mesh position={[-wallWidth, GALLERY_GEOMETRY.wallCenterY, -windowLength / 2 + 20]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[windowLength, GALLERY_GEOMETRY.wallHeight + 0.2]} />
        <meshPhysicalMaterial
          color="#040810"
          roughness={0.52}
          metalness={0.24}
          clearcoat={0.12}
          clearcoatRoughness={0.45}
        />
      </mesh>

      {/* 2. 右侧深色微晶科技墙面基板 */}
      <mesh position={[wallWidth, GALLERY_GEOMETRY.wallCenterY, -windowLength / 2 + 20]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[windowLength, GALLERY_GEOMETRY.wallHeight + 0.2]} />
        <meshPhysicalMaterial
          color="#040810"
          roughness={0.52}
          metalness={0.24}
          clearcoat={0.12}
          clearcoatRoughness={0.45}
        />
      </mesh>

      {/* 3. 顶部微暗天花板基板（法线正对长廊下方相机，与侧墙完全无缝密闭） */}
      <mesh position={[0, GALLERY_GEOMETRY.ceilingY, -windowLength / 2 + 20]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[wallWidth * 2 + 0.4, windowLength]} />
        <meshPhysicalMaterial
          color="#040810"
          roughness={0.52}
          metalness={0.24}
          clearcoat={0.12}
          clearcoatRoughness={0.45}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 4. 左侧与右侧墙面：完全错落非对称的彗星流光光束 */}
      <instancedMesh
        ref={leftLinesRef}
        args={[undefined, undefined, leftCount]}
        material={meteorShaderMaterial}
      >
        <cylinderGeometry args={[0.014, 0.014, 1, 8]} />
      </instancedMesh>

      <instancedMesh
        ref={rightLinesRef}
        args={[undefined, undefined, rightCount]}
        material={meteorShaderMaterial}
      >
        <cylinderGeometry args={[0.014, 0.014, 1, 8]} />
      </instancedMesh>
    </group>
  );
};
