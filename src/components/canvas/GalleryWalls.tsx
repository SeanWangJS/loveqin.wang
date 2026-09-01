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
 * 概念设计图同款：【深邃极简科技画廊侧墙 + 黄金视线流星彗尾流光 (Velocity-Driven Meteor Stream)】
 * 1. 彻底删除墙面垂直竖线（无竖向分割缝纹理干扰）
 * 2. 彻底删除墙面顶部连续光线，仅在中低展线保留稀疏错落的独立流星光斑
 * 3. 墙面与天花板无缝衔接，静止时定格，运动时随速度动态响应
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

  // 墙面水平流星轨道的 Y 坐标高度分布：
  // 严格限定在照片高度附近的中低展区（-0.8 ~ 1.0），彻底移除高处与顶部线条
  const LINE_HEIGHTS = useMemo(() => [-0.8, -0.2, 0.4, 1.0], []);
  const segmentSpacing = 24; // 稀疏间距，杜绝前后相连成连续长线
  const segmentsPerLine = Math.ceil(windowLength / segmentSpacing);
  const lineCount = LINE_HEIGHTS.length * segmentsPerLine;

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 速度驱动流星彗尾流光 Shader
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
          // 区分不同高度轨道的独立随机相位与速度比例
          float laneSeed = sin(floor((vWorldPosition.y + 2.0) * 2.2) * 127.1);
          float laneSpeedMultiplier = 0.85 + fract(laneSeed * 43.12) * 0.35;
          float period = 36.0;

          // 严格由相机物理位移 uOffset 驱动（静止时完全定格）
          float travelZ = -vWorldPosition.z + uOffset * laneSpeedMultiplier + laneSeed * 100.0;
          float progress = fract(travelZ / period); // 0.0 -> 1.0

          // 速度动态拉伸
          float absVel = abs(uVelocity);
          float tailStretch = clamp(1.0 + absVel * 0.06, 1.0, 2.5);

          // ① 纯白高光核
          float head = smoothstep(0.93, 0.98, progress) * (1.0 - smoothstep(0.98, 1.0, progress));
          
          // ② 随速度动态拉伸的彗尾
          float tailStart = max(0.2, 0.98 - 0.52 * tailStretch);
          float tail = pow(smoothstep(tailStart, 0.98, progress), 4.2);

          // ③ 80% 常态微弱基底光轨
          float baseTrack = 0.08;

          float motionBoost = clamp(absVel * 0.04, 0.0, 1.2);
          float intensity = baseTrack + tail * (0.8 + motionBoost) + head * (2.8 + motionBoost * 1.5);
          vec3 finalColor = mix(uColor, uHeadColor, head * 0.92);

          gl_FragColor = vec4(finalColor * intensity, clamp(intensity * 0.95, 0.0, 1.0));
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

    // 更新左侧与右侧墙面水平流光线
    if (leftLinesRef.current && rightLinesRef.current) {
      let lineIndex = 0;
      for (let heightIndex = 0; heightIndex < LINE_HEIGHTS.length; heightIndex++) {
        const y = LINE_HEIGHTS[heightIndex];
        for (let segmentIndex = 0; segmentIndex < segmentsPerLine; segmentIndex++) {
          const segmentLength = 3.2 + ((heightIndex + segmentIndex) % 3) * 1.0;
          const stagger = ((heightIndex * 4.3 + segmentIndex * 2.7) % 8) - 4;
          const z = 20 - segmentIndex * segmentSpacing + stagger;

          // 左墙光线
          dummy.position.set(-wallWidth + 0.05, y, z);
          dummy.rotation.set(Math.PI / 2, 0, 0);
          dummy.scale.set(1, segmentLength, 1);
          dummy.updateMatrix();
          leftLinesRef.current.setMatrixAt(lineIndex, dummy.matrix);

          // 右墙光线（前后错开）
          dummy.position.set(wallWidth - 0.05, y, z - 4.5);
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

      {/* 4. 左侧与右侧墙面：中低展线速度驱动流星流光（无顶部线、无连续长线） */}
      <instancedMesh
        ref={leftLinesRef}
        args={[undefined, undefined, lineCount]}
        material={meteorShaderMaterial}
      >
        <cylinderGeometry args={[0.012, 0.012, 1, 6]} />
      </instancedMesh>

      <instancedMesh
        ref={rightLinesRef}
        args={[undefined, undefined, lineCount]}
        material={meteorShaderMaterial}
      >
        <cylinderGeometry args={[0.012, 0.012, 1, 6]} />
      </instancedMesh>
    </group>
  );
};
