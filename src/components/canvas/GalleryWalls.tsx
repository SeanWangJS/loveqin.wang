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

/**
 * 概念设计图同款：【深邃极简科技画廊侧墙 + 全量彗星流光光效 (Full Comet-Streak Trails)】
 * 1. 每一根生效线条都完整具备独立的高能彗星头部与丝滑渐变拖尾（100% 覆盖）
 * 2. 彻底删除墙面竖向缝隙，彻底清除天顶/高位无用连续线条
 * 3. 严格由相机速度驱动：静止时定格发光，运动时彗尾拉长并随速度动态流动
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

  // 墙面水平流星轨道的 Y 坐标高度分布（照片黄金展区 4 层）
  const LINE_HEIGHTS = useMemo(() => [-0.8, -0.2, 0.4, 1.0], []);
  const segmentSpacing = 18; // 保持优雅节奏
  const segmentsPerLine = Math.ceil(windowLength / segmentSpacing);
  const lineCount = LINE_HEIGHTS.length * segmentsPerLine;

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 全量彗星流光 Shader（保证侧面每一根线条都具备完整的彗星轨迹）
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
          // 轨道独立随机扰动
          float laneSeed = sin(floor((vWorldPosition.y + 2.0) * 2.2) * 127.1);

          // 1. 局部几何彗星形态（基于局部纵向坐标 vUv.y，0.0 为彗尾末端 -> 1.0 为彗星头部）
          // ① 白热凝聚彗核（0.78 -> 0.98）
          float localHead = smoothstep(0.76, 0.98, vUv.y);
          // ② 柔和渐变指数彗尾（0.0 -> 0.85）
          float localTail = pow(smoothstep(0.02, 0.82, vUv.y), 2.6);

          float cometBase = localTail * 0.88 + localHead * 2.6;

          // 2. 全局速度与时空位移流光波浪调制（运动时沿走廊流动）
          float wave = sin(-vWorldPosition.z * 0.12 + uOffset * 0.85 + laneSeed * 8.0) * 0.5 + 0.5;
          float flowPulse = 0.70 + 0.30 * pow(wave, 2.0);

          // 3. 速度动态拉伸与辉光激发
          float absVel = abs(uVelocity);
          float speedBoost = clamp(absVel * 0.05, 0.0, 1.4);

          // 确保每一根线条都 100% 具备璀璨彗星特征
          float totalIntensity = cometBase * (flowPulse + speedBoost);
          vec3 finalColor = mix(uColor, uHeadColor, localHead * 0.92);

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

    // 更新左侧与右侧墙面水平彗星流光线
    if (leftLinesRef.current && rightLinesRef.current) {
      let lineIndex = 0;
      for (let heightIndex = 0; heightIndex < LINE_HEIGHTS.length; heightIndex++) {
        const y = LINE_HEIGHTS[heightIndex];
        for (let segmentIndex = 0; segmentIndex < segmentsPerLine; segmentIndex++) {
          const segmentLength = 3.6 + ((heightIndex + segmentIndex) % 3) * 1.0;
          const stagger = ((heightIndex * 4.3 + segmentIndex * 2.7) % 8) - 4;
          const z = 20 - segmentIndex * segmentSpacing + stagger;

          // 左墙彗星光束
          dummy.position.set(-wallWidth + 0.05, y, z);
          dummy.rotation.set(Math.PI / 2, 0, 0);
          dummy.scale.set(1, segmentLength, 1);
          dummy.updateMatrix();
          leftLinesRef.current.setMatrixAt(lineIndex, dummy.matrix);

          // 右墙彗星光束（前后错开）
          dummy.position.set(wallWidth - 0.05, y, z - 3.8);
          dummy.updateMatrix();
          rightLinesRef.current.setMatrixAt(lineIndex, dummy.matrix);
          lineIndex += 1;
        }
      }
      leftLinesRef.current.instanceMatrix.needsUpdate = true;
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

      {/* 4. 左侧与右侧墙面：100% 全量生效的彗星流光光束 */}
      <instancedMesh
        ref={leftLinesRef}
        args={[undefined, undefined, lineCount]}
        material={meteorShaderMaterial}
      >
        <cylinderGeometry args={[0.014, 0.014, 1, 8]} />
      </instancedMesh>

      <instancedMesh
        ref={rightLinesRef}
        args={[undefined, undefined, lineCount]}
        material={meteorShaderMaterial}
      >
        <cylinderGeometry args={[0.014, 0.014, 1, 8]} />
      </instancedMesh>
    </group>
  );
};
