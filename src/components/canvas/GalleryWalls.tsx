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
function hash(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * 概念设计图同款：【深邃极简科技画廊侧墙 + 单轨离散流星雨 (1D Staggered Meteor Stream)】
 * 1. 彻底根除“单侧成对”与“双侧对称”：单侧墙面采用 1D 线性离散排布算法，任何局部深度 Z 区域内【绝对只有唯一一颗流星】
 * 2. 左右两侧深度彻底交错（相位差半个周期），不同高度交替轮换，实现 100% 自然错落的流星群
 * 3. 严格由相机速度驱动：静止时定格发光，运动时根据物理速度产生长尾与流光穿梭
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

  // 左右两侧墙面采用完全不同、错开的高度层级
  const LEFT_HEIGHTS = useMemo(() => [-0.85, -0.25, 0.35, 0.95], []);
  const RIGHT_HEIGHTS = useMemo(() => [-0.55, 0.05, 0.65, 1.25], []);

  // 1D 序列离散排布：沿 160 单位长廊单侧仅放置 18 颗流星（平均每 8.8 单位深度仅出现 1 颗，绝无上下堆叠）
  const meteorCount = 18;

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
          float cometSeed = sin(floor(vWorldPosition.y * 4.2) * 19.3 + floor(vWorldPosition.z * 0.08) * 47.7);
          float cometHotness = 0.55 + 0.45 * fract(cometSeed * 93.17); // 0.55 ~ 1.0 错落有致的白热度

          // 1. 局部彗星形态（基于局部纵向坐标 vUv.y，0.0 尾端 -> 1.0 头部）
          // ① 差异化白热核心
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

    const stepZ = windowLength / meteorCount; // ~8.88 单位步长

    // 1. 更新左侧墙面彗星流光（1D 线性离散算法，同深度绝对不重叠）
    if (leftLinesRef.current) {
      for (let i = 0; i < meteorCount; i++) {
        // 伪随机哈希
        const r1 = hash(i + 1, 13);
        const r2 = hash(i + 1, 37);
        const r3 = hash(i + 1, 71);

        // 高度层：按哈希在 4 个高度中跳跃交替，前后相邻流星绝不在同一高度
        const laneIndex = (i * 2 + Math.floor(r1 * 2)) % LEFT_HEIGHTS.length;
        const y = LEFT_HEIGHTS[laneIndex];

        // 深度 Z：严格线性向前步进 + 微小确定性扰动（保证单侧绝对无成对并行）
        const zBase = 20 - i * stepZ;
        const zJitter = (r2 - 0.5) * (stepZ * 0.45);
        const z = zBase + zJitter;

        // 长度：2.8 ~ 5.4 错落
        const segmentLength = 2.8 + r3 * 2.6;

        dummy.position.set(-wallWidth + 0.05, y, z);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.scale.set(1, segmentLength, 1);
        dummy.updateMatrix();
        leftLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      leftLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. 更新右侧墙面彗星流光（交错半个步长，且高度与随机种子完全独立）
    if (rightLinesRef.current) {
      for (let i = 0; i < meteorCount; i++) {
        const r1 = hash(i + 99, 17);
        const r2 = hash(i + 99, 43);
        const r3 = hash(i + 99, 89);

        // 高度层：在右侧 4 个错开的高度中轮换
        const laneIndex = (i * 3 + Math.floor(r1 * 2)) % RIGHT_HEIGHTS.length;
        const y = RIGHT_HEIGHTS[laneIndex];

        // 深度 Z：偏移半个步长（-stepZ * 0.5），使得左右两侧流星完全交替错开
        const zBase = 20 - (i + 0.5) * stepZ;
        const zJitter = (r2 - 0.5) * (stepZ * 0.45);
        const z = zBase + zJitter;

        const segmentLength = 3.0 + r3 * 2.4;

        dummy.position.set(wallWidth - 0.05, y, z);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.scale.set(1, segmentLength, 1);
        dummy.updateMatrix();
        rightLinesRef.current.setMatrixAt(i, dummy.matrix);
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

      {/* 4. 左侧与右侧墙面：1D 离散完全错落的流星光束（单侧绝对零重叠、双侧绝对零对称） */}
      <instancedMesh
        ref={leftLinesRef}
        args={[undefined, undefined, meteorCount]}
        material={meteorShaderMaterial}
      >
        <cylinderGeometry args={[0.014, 0.014, 1, 8]} />
      </instancedMesh>

      <instancedMesh
        ref={rightLinesRef}
        args={[undefined, undefined, meteorCount]}
        material={meteorShaderMaterial}
      >
        <cylinderGeometry args={[0.014, 0.014, 1, 8]} />
      </instancedMesh>
    </group>
  );
};
