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

// 确定性随机散列函数
function hash(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * 概念设计图同款：【深邃极简科技画廊侧墙 + 真正世界坐标固定向后飞掠流星雨】
 * 1. 彻底解决方向 Bug：流星在世界空间保持绝对固定，相机向前推进时，流星在视野中必定严格向后飞速掠过并消逝！
 * 2. 彻底根除“跳变/瞬移”：通过周期整数 k 确定性平滑轮转，前后视锥双向平滑淡入淡出
 * 3. 彻底根除“上下成对/左右对称”：单侧 1D 线性离散排布，同深度绝对唯一流星
 * 4. 速度响应：静止时定格发光，运动时彗尾拉长并根据推进速度向后奔涌
 */
export const GalleryWalls: React.FC<GalleryWallsProps> = ({
  wallWidth = GALLERY_GEOMETRY.wallHalfWidth,
  windowLength = 160,
}) => {
  const leftLinesRef = useRef<THREE.InstancedMesh>(null);
  const rightLinesRef = useRef<THREE.InstancedMesh>(null);
  const leftWallRef = useRef<THREE.Mesh>(null);
  const rightWallRef = useRef<THREE.Mesh>(null);
  const ceilingRef = useRef<THREE.Mesh>(null);

  const activeYear = useGalleryStore((s) => s.activeYear);
  const theme = useMemo(() => getTimeTemperature(activeYear), [activeYear]);

  // 物理速度与流动相位跟踪
  const lastCameraZRef = useRef<number | null>(null);
  const velocityRef = useRef(0);
  const streakOffsetRef = useRef(0);

  // 左右两侧墙面采用完全不同、错开的高度层级
  const LEFT_HEIGHTS = useMemo(() => [-0.85, -0.25, 0.35, 0.95], []);
  const RIGHT_HEIGHTS = useMemo(() => [-0.55, 0.05, 0.65, 1.25], []);

  // 单侧 18 颗流星在 160 单位视窗内均匀错落循环
  const meteorCount = 18;

  // 预计算每颗流星的固有属性（位置偏移、高度、长度），多端刷新绝对恒定
  const leftMeteors = useMemo(() => {
    return Array.from({ length: meteorCount }, (_, i) => {
      const r1 = hash(i + 1, 13);
      const r2 = hash(i + 1, 37);
      const r3 = hash(i + 1, 71);
      const baseOffset = i * (windowLength / meteorCount);
      const jitter = (r2 - 0.5) * (windowLength / meteorCount * 0.4);
      const laneIndex = (i * 2 + Math.floor(r1 * 2)) % LEFT_HEIGHTS.length;
      return {
        offset: baseOffset + jitter,
        y: LEFT_HEIGHTS[laneIndex],
        length: 3.2 + r3 * 2.8,
      };
    });
  }, [LEFT_HEIGHTS, windowLength]);

  const rightMeteors = useMemo(() => {
    return Array.from({ length: meteorCount }, (_, i) => {
      const r1 = hash(i + 99, 17);
      const r2 = hash(i + 99, 43);
      const r3 = hash(i + 99, 89);
      // 右侧错开半个步长
      const baseOffset = (i + 0.5) * (windowLength / meteorCount);
      const jitter = (r2 - 0.5) * (windowLength / meteorCount * 0.4);
      const laneIndex = (i * 3 + Math.floor(r1 * 2)) % RIGHT_HEIGHTS.length;
      return {
        offset: baseOffset + jitter,
        y: RIGHT_HEIGHTS[laneIndex],
        length: 3.4 + r3 * 2.6,
      };
    });
  }, [RIGHT_HEIGHTS, windowLength]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 物理向后流动的全量彗星流光 Shader
  const meteorShaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uCameraZ: { value: 0 },
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
        uniform float uCameraZ;
        uniform float uOffset;
        uniform float uVelocity;
        uniform vec3 uColor;
        uniform vec3 uHeadColor;

        void main() {
          // 基于世界坐标的唯一随机种子
          float cometSeed = sin(floor(vWorldPosition.y * 4.2) * 19.3 + floor(vWorldPosition.z * 0.08) * 47.7);
          float cometHotness = 0.6 + 0.4 * fract(cometSeed * 93.17);

          // 1. 物理流向与彗星形态：
          // 头部在前端（0.0 远方深度 -Z），彗尾向后方（1.0 视线近端/身后 +Z）拖曳拉长
          float invUvY = 1.0 - vUv.y;
          float flowCoord = fract(invUvY + uOffset * 0.45 + cometSeed * 7.3);

          // ① 白热流星核：引领在运动前方
          float localHead = smoothstep(0.78, 0.98, flowCoord) * cometHotness;
          // ② 柔和彗尾：向后方自然拖曳
          float localTail = pow(smoothstep(0.12, 0.82, flowCoord), 2.8);

          // 基础静止轮廓（静止时白热核在前端，尾部向后拖曳）
          float staticHead = smoothstep(0.76, 0.98, invUvY) * cometHotness;
          float staticTail = pow(smoothstep(0.04, 0.82, invUvY), 2.5);
          float staticBase = staticTail * 0.85 + staticHead * (1.8 + cometHotness * 1.2);

          // 2. 运动流动调制：速度越快，流动彗尾越清晰拉长
          float absVel = abs(uVelocity);
          float motionMix = clamp(absVel * 0.12, 0.0, 1.0);
          float dynamicComet = localTail * 0.95 + localHead * (2.4 + cometHotness * 1.4);
          
          float cometIntensity = mix(staticBase, dynamicComet, motionMix);

          // 3. 速度动态拉伸与辉光激发
          float speedBoost = clamp(absVel * 0.05, 0.0, 1.4);
          float totalIntensity = (cometIntensity + speedBoost * 0.4) * (1.0 + speedBoost * 0.6);
          vec3 finalColor = mix(uColor, uHeadColor, max(localHead, staticHead) * 0.92);

          // 4. 前后视锥平滑淡入淡出（杜绝任何突变硬裁剪）
          float distFromFront = (uCameraZ + 20.0) - vWorldPosition.z;
          float distFromFar = vWorldPosition.z - (uCameraZ - 135.0);
          float edgeFade = smoothstep(0.0, 16.0, distFromFront) * smoothstep(0.0, 24.0, distFromFar);

          gl_FragColor = vec4(finalColor * totalIntensity, clamp(totalIntensity * edgeFade * 0.95, 0.0, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }, []);

  // 每帧 100% 连续平滑无级更新
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

    // 向前滑动推进（deltaZ < 0）时，streakOffset 递增
    streakOffsetRef.current -= deltaZ * 1.8;

    meteorShaderMaterial.uniforms.uCameraZ.value = currentCamZ;
    meteorShaderMaterial.uniforms.uOffset.value = streakOffsetRef.current;
    meteorShaderMaterial.uniforms.uVelocity.value = velocityRef.current;
    meteorShaderMaterial.uniforms.uColor.value.copy(theme.pointLightColor);

    // 墙体基板与天花板平滑连续跟随相机
    const wallZ = currentCamZ - 60;
    if (leftWallRef.current) leftWallRef.current.position.z = wallZ;
    if (rightWallRef.current) rightWallRef.current.position.z = wallZ;
    if (ceilingRef.current) ceilingRef.current.position.z = wallZ;

    const span = windowLength;

    // 1. 更新左侧墙面流星（核心修复：世界坐标保持完全绝对静止，相机向前时流星必定严格向后掠过视野）
    if (leftLinesRef.current) {
      for (let i = 0; i < meteorCount; i++) {
        const item = leftMeteors[i];
        // 关键算法：通过周期整数 k 确定世界坐标，在相机前进过程中 worldZ 严格保持不变！
        const k = Math.floor((currentCamZ + 20 - item.offset) / span);
        const worldZ = item.offset + k * span;

        dummy.position.set(-wallWidth + 0.05, item.y, worldZ);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.scale.set(1, item.length, 1);
        dummy.updateMatrix();
        leftLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      leftLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 2. 更新右侧墙面流星
    if (rightLinesRef.current) {
      for (let i = 0; i < meteorCount; i++) {
        const item = rightMeteors[i];
        const k = Math.floor((currentCamZ + 20 - item.offset) / span);
        const worldZ = item.offset + k * span;

        dummy.position.set(wallWidth - 0.05, item.y, worldZ);
        dummy.rotation.set(Math.PI / 2, 0, 0);
        dummy.scale.set(1, item.length, 1);
        dummy.updateMatrix();
        rightLinesRef.current.setMatrixAt(i, dummy.matrix);
      }
      rightLinesRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* 1. 左侧深色微晶科技墙面基板 */}
      <mesh
        ref={leftWallRef}
        position={[-wallWidth, GALLERY_GEOMETRY.wallCenterY, -60]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <planeGeometry args={[windowLength + 40, GALLERY_GEOMETRY.wallHeight + 0.2]} />
        <meshPhysicalMaterial
          color="#040810"
          roughness={0.52}
          metalness={0.24}
          clearcoat={0.12}
          clearcoatRoughness={0.45}
        />
      </mesh>

      {/* 2. 右侧深色微晶科技墙面基板 */}
      <mesh
        ref={rightWallRef}
        position={[wallWidth, GALLERY_GEOMETRY.wallCenterY, -60]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        <planeGeometry args={[windowLength + 40, GALLERY_GEOMETRY.wallHeight + 0.2]} />
        <meshPhysicalMaterial
          color="#040810"
          roughness={0.52}
          metalness={0.24}
          clearcoat={0.12}
          clearcoatRoughness={0.45}
        />
      </mesh>

      {/* 3. 顶部微暗天花板基板 */}
      <mesh
        ref={ceilingRef}
        position={[0, GALLERY_GEOMETRY.ceilingY, -60]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[wallWidth * 2 + 0.4, windowLength + 40]} />
        <meshPhysicalMaterial
          color="#040810"
          roughness={0.52}
          metalness={0.24}
          clearcoat={0.12}
          clearcoatRoughness={0.45}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 4. 左侧与右侧墙面：物理向前推进向后消逝的彗星流光 */}
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
