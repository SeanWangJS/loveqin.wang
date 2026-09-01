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
 * 概念设计图同款：【深邃科技画廊侧墙 + 流星彗尾流光光纤 (Meteor Stream Light Trails)】
 * 80% 保持若隐若现的微光基底，流星脉冲带着纯白光核与冰蓝渐变彗尾在不同轨道轻盈穿梭
 */
export const GalleryWalls: React.FC<GalleryWallsProps> = ({
  wallWidth = GALLERY_GEOMETRY.wallHalfWidth,
  windowLength = 160,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const leftLinesRef = useRef<THREE.InstancedMesh>(null);
  const rightLinesRef = useRef<THREE.InstancedMesh>(null);
  const leftPanelsRef = useRef<THREE.InstancedMesh>(null);
  const rightPanelsRef = useRef<THREE.InstancedMesh>(null);

  const activeYear = useGalleryStore((s) => s.activeYear);
  const theme = useMemo(() => getTimeTemperature(activeYear), [activeYear]);

  // 墙面水平光轨的 Y 坐标高度分布 (9 层错落排布)
  const LINE_HEIGHTS = useMemo(() => [-1.35, -0.75, -0.15, 0.45, 1.05, 1.65, 2.25, 2.85, 3.45], []);
  const segmentsPerLine = Math.ceil(windowLength / 14);
  const lineCount = LINE_HEIGHTS.length * segmentsPerLine;

  // 沿走廊 Z 轴均匀排列的墙面板分块 (每块 12 单位长)
  const panelStep = 12;
  const panelCount = Math.ceil(windowLength / panelStep);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 概念图规范专属：【流星彗尾流光 Shader (Meteor Stream Shader Material)】
  const meteorShaderMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
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
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uHeadColor;

        void main() {
          // 区分不同高度轨道的独立随机相位与速度 (交错流动，不千篇一律)
          float laneSeed = sin(floor((vWorldPosition.y + 2.0) * 1.8) * 127.1);
          float speed = 11.0 + fract(laneSeed * 43.12) * 7.0;
          float period = 32.0;

          // 沿走廊 Z 轴向深处穿梭滑行的流星脉冲
          float travelZ = -vWorldPosition.z + uTime * speed + laneSeed * 100.0;
          float progress = fract(travelZ / period); // 0.0 -> 1.0

          // 流星彗尾形态：
          // ① 纯白高光核 (极窄头部 0.94 -> 0.98 -> 1.0)
          float head = smoothstep(0.93, 0.98, progress) * (1.0 - smoothstep(0.98, 1.0, progress));
          
          // ② 优雅渐变彗尾 (长拖尾 0.40 -> 0.98 指数衰减)
          float tail = pow(smoothstep(0.38, 0.98, progress), 4.2);

          // ③ 80% 常态微弱基底光轨 (若隐若现，保证建筑结构感)
          float baseTrack = 0.09;

          float intensity = baseTrack + tail * 0.82 + head * 2.8;
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

  // 随相机平滑滑动的视窗局部与流光时间步进
  useFrame((state, delta) => {
    meteorShaderMaterial.uniforms.uTime.value += delta;
    meteorShaderMaterial.uniforms.uColor.value.copy(theme.pointLightColor);

    const cameraZ = state.camera.position.z;
    const baseZ = Math.floor(cameraZ / 10) * 10;

    if (groupRef.current) {
      groupRef.current.position.z = baseZ;
    }

    // 更新左侧与右侧墙面水平流光线
    if (leftLinesRef.current && rightLinesRef.current) {
      let lineIndex = 0;
      for (let heightIndex = 0; heightIndex < LINE_HEIGHTS.length; heightIndex++) {
        const y = LINE_HEIGHTS[heightIndex];
        for (let segmentIndex = 0; segmentIndex < segmentsPerLine; segmentIndex++) {
          const segmentLength = 4.2 + ((heightIndex + segmentIndex) % 4) * 1.2;
          const stagger = ((heightIndex * 3.7 + segmentIndex * 1.9) % 6) - 3;
          const z = 20 - segmentIndex * 14 + stagger;

          // 左墙光线
          dummy.position.set(-wallWidth + 0.05, y, z);
          dummy.rotation.set(Math.PI / 2, 0, 0);
          dummy.scale.set(1, segmentLength, 1);
          dummy.updateMatrix();
          leftLinesRef.current.setMatrixAt(lineIndex, dummy.matrix);

          // 右墙光线（前后错位，不对称自然分布）
          dummy.position.set(wallWidth - 0.05, y, z - 3.5);
          dummy.updateMatrix();
          rightLinesRef.current.setMatrixAt(lineIndex, dummy.matrix);
          lineIndex += 1;
        }
      }
      leftLinesRef.current.instanceMatrix.needsUpdate = true;
      rightLinesRef.current.instanceMatrix.needsUpdate = true;
    }

    // 更新左侧与右侧深色面板分缝
    if (leftPanelsRef.current && rightPanelsRef.current) {
      for (let i = 0; i < panelCount; i++) {
        const z = 20 - i * panelStep;

        // 左墙面板细缝
        dummy.position.set(-wallWidth + 0.02, 1.2, z);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.scale.set(1, 5.5, 1);
        dummy.updateMatrix();
        leftPanelsRef.current.setMatrixAt(i, dummy.matrix);

        // 右墙面板细缝
        dummy.position.set(wallWidth - 0.02, 1.2, z);
        dummy.rotation.set(0, -Math.PI / 2, 0);
        dummy.scale.set(1, 5.5, 1);
        dummy.updateMatrix();
        rightPanelsRef.current.setMatrixAt(i, dummy.matrix);
      }
      leftPanelsRef.current.instanceMatrix.needsUpdate = true;
      rightPanelsRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef}>
      {/* 1. 左侧深色微晶科技墙面基板 */}
      <mesh position={[-wallWidth, GALLERY_GEOMETRY.wallCenterY, -windowLength / 2 + 20]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[windowLength, GALLERY_GEOMETRY.wallHeight]} />
        <meshPhysicalMaterial
          color="#08121b"
          roughness={0.46}
          metalness={0.34}
          clearcoat={0.28}
          clearcoatRoughness={0.38}
        />
      </mesh>

      {/* 2. 右侧深色微晶科技墙面基板 */}
      <mesh position={[wallWidth, GALLERY_GEOMETRY.wallCenterY, -windowLength / 2 + 20]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[windowLength, GALLERY_GEOMETRY.wallHeight]} />
        <meshPhysicalMaterial
          color="#08121b"
          roughness={0.46}
          metalness={0.34}
          clearcoat={0.28}
          clearcoatRoughness={0.38}
        />
      </mesh>

      {/* 3. 顶部微暗天花板基板 */}
      <mesh position={[0, GALLERY_GEOMETRY.ceilingY, -windowLength / 2 + 20]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[wallWidth * 2, windowLength]} />
        <meshStandardMaterial
          color="#02050a"
          roughness={0.72}
          metalness={0.18}
        />
      </mesh>

      {/* 4. 左侧与右侧墙面：流星彗尾流光光纤（Meteor Stream Shader） */}
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

      {/* 5. 墙面板垂直嵌缝线条（微弱冷灰线，增强建筑网格感） */}
      <instancedMesh ref={leftPanelsRef} args={[undefined, undefined, panelCount]}>
        <planeGeometry args={[0.015, 1]} />
        <meshBasicMaterial color="#263746" transparent opacity={0.18} depthWrite={false} />
      </instancedMesh>

      <instancedMesh ref={rightPanelsRef} args={[undefined, undefined, panelCount]}>
        <planeGeometry args={[0.015, 1]} />
        <meshBasicMaterial color="#263746" transparent opacity={0.18} depthWrite={false} />
      </instancedMesh>
    </group>
  );
};
