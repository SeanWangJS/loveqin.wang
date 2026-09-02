import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PhotoItem, SpatialPosition } from '../../types/gallery';
import { globalTexturePool } from '../../utils/textureLRUPool';
import { getCardPlaceholderTexture } from '../../utils/placeholderGenerator';
import { getRoundedCurvedGeometry, getHairlineRimGeometry, getDiamondGlintTexture } from './PhotoCard';

interface GhostPhotoCardProps {
  photo: PhotoItem;
  positionData: SpatialPosition;
  layerIndex: number;
  depthOffset: number;
  lateralOffset: number;
  verticalOffset?: number;
  scaleFactor: number;
  opacity?: number;
}

let cachedCurvedBeamGeom: THREE.BufferGeometry | null = null;

// 概念图同款：完美契合照片微弧曲面的横向彗星流光柱几何体（宽度 5.2，高 0.08，两端微幅延展）
function getCurvedBeamGeometry(width = 5.2, height = 0.08): THREE.BufferGeometry {
  if (cachedCurvedBeamGeom) return cachedCurvedBeamGeom;
  const geom = new THREE.PlaneGeometry(width, height, 32, 1);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    // 采用与主卡片完全一致的微弧挠度 Z = -0.028 * x^2 + 0.012，紧密贴合
    pos.setZ(i, -0.028 * Math.pow(px, 2) + 0.012);
  }
  geom.computeVertexNormals();
  cachedCurvedBeamGeom = geom;
  return geom;
}

// 概念图同款：【白热核 + 电光冰蓝彗尾 + 动态飞掠向后的彗星流光 Shader】
function createCometBeamMaterial(opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#38bdf8') },
      uHeadColor: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uHeadColor;
      uniform float uOpacity;

      void main() {
        // 1. 截面纵向高斯/sin^2 羽化（中轴白热激光丝，上下平滑衰减为光晕）
        float lateral = clamp(sin(vUv.y * 3.14159265), 0.0, 1.0);
        float core = lateral * lateral * lateral * lateral; // 极细白热激光核心
        float halo = lateral * lateral;                    // 柔和外围光晕

        // 2. 彗星动态飞掠流动（沿水平光柱向后疾驰穿梭）
        float flow = fract(vUv.x * 1.5 - uTime * 0.95);
        float head = smoothstep(0.72, 0.98, flow);
        float tail = pow(clamp(smoothstep(0.08, 0.82, flow), 0.0, 1.0), 2.2);
        float comet = head * 2.5 + tail * 0.8;

        // 3. 两端横向自然淡出，杜绝边缘几何生硬截断
        float endFade = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));

        float totalIntensity = (core * 2.6 + halo * comet) * endFade;
        vec3 col = mix(uColor, uHeadColor, head * core);

        gl_FragColor = vec4(col * totalIntensity, clamp(totalIntensity * uOpacity * 0.85, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function getStableSpread(id: string, layerIndex: number) {
  let hash = 0;
  const spreadKey = `${id}:${layerIndex}`;
  for (let i = 0; i < spreadKey.length; i++) {
    hash = (hash * 31 + spreadKey.charCodeAt(i)) | 0;
  }

  const normalizedX = ((Math.abs(hash) % 1000) / 999) - 0.5;
  const normalizedY = ((Math.abs(hash >> 8) % 1000) / 999) - 0.5;

  // 随层级加深，Y 方向散开幅度更强，形成有机扩散的星云矩阵
  const depthFactor = 1.0 + layerIndex * 0.16;

  return {
    x: normalizedX * 0.12 * depthFactor,
    y: normalizedY * 0.28 * depthFactor,
  };
}

export const GhostPhotoCard: React.FC<GhostPhotoCardProps> = ({
  photo,
  positionData,
  layerIndex,
  depthOffset,
  lateralOffset,
  verticalOffset = 0,
  scaleFactor,
  opacity = 0.50,
}) => {
  const meshRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const spread = useMemo(() => getStableSpread(photo.id, layerIndex), [photo.id, layerIndex]);

  const placeholderTex = useMemo(() => {
    return getCardPlaceholderTexture(photo.title, photo.locationName, photo.id);
  }, [photo.title, photo.locationName, photo.id]);

  // 概念图同款 3D 微弧圆角几何体、电光微晶发光轮廓与纯白钻石高光贴图
  const photoGeom = useMemo(() => getRoundedCurvedGeometry(4.6, 3.4, 0.32), []);
  const rimGeom = useMemo(() => getHairlineRimGeometry(4.6, 3.4, 0.32), []);
  const glintTex = useMemo(() => getDiamondGlintTexture(), []);

  // 概念图同款：上下边缘彗星流光柱几何体与着色材质
  const beamGeom = useMemo(() => getCurvedBeamGeometry(5.2, 0.08), []);
  const topBeamMat = useMemo(() => createCometBeamMaterial(opacity), [opacity]);
  const bottomBeamMat = useMemo(() => createCometBeamMaterial(opacity), [opacity]);

  useEffect(() => {
    return () => {
      topBeamMat.dispose();
      bottomBeamMat.dispose();
    };
  }, [topBeamMat, bottomBeamMat]);

  const cardWidth = 4.6;
  const cardHeight = 3.4;
  const cornerRadius = 0.32;
  const cornerX = cardWidth / 2 - cornerRadius * 0.45;
  const cornerY = cardHeight / 2 - cornerRadius * 0.45;
  const cornerZ = -0.028 * Math.pow(cornerX, 2) + 0.008;

  useEffect(() => {
    let cancelLow: (() => void) | null = null;

    const cancelHigh = globalTexturePool.load(
      photo.urlThumbHigh,
      (loadedTexture) => {
        if (materialRef.current) {
          materialRef.current.map = loadedTexture;
          materialRef.current.needsUpdate = true;
        }
      },
      () => {
        cancelLow = globalTexturePool.load(photo.urlThumbLow, (fallbackTex) => {
          if (materialRef.current) {
            materialRef.current.map = fallbackTex;
            materialRef.current.needsUpdate = true;
          }
        });
      }
    );

    return () => {
      cancelHigh();
      cancelLow?.();
    };
  }, [photo.urlThumbHigh, photo.urlThumbLow]);

  // 基准三维空间坐标（概念图同款：外层高低错落伴生展墙，Math.sign(x) 始终推向外墙侧）
  const baseX = positionData.x + Math.sign(positionData.x) * lateralOffset + spread.x;
  const baseY = positionData.y + verticalOffset + spread.y;
  const baseZ = positionData.z - depthOffset;

  // 优雅轻柔的深空零重力悬浮呼吸微动 + 上下彗星激光流光交错脉动
  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    topBeamMat.uniforms.uTime.value = t + layerIndex * 0.45;
    bottomBeamMat.uniforms.uTime.value = t + layerIndex * 0.45 + 0.5;

    if (meshRef.current) {
      meshRef.current.position.y = baseY + Math.sin(t * 1.1 + layerIndex * 0.45) * 0.04;
      meshRef.current.rotation.z = positionData.rotationZ + Math.cos(t * 0.85 + layerIndex * 0.35) * 0.008;
    }
  });

  return (
    <group
      ref={meshRef}
      position={[baseX, baseY, baseZ]}
      rotation={[positionData.rotationX, positionData.rotationY, positionData.rotationZ]}
      scale={positionData.scale * scaleFactor}
    >
      {/* 1. 悬浮暗色微晶玻璃背板：赋予厚实通透的未来光学玻璃质感 */}
      <mesh geometry={photoGeom} position={[0, 0, -0.006]}>
        <meshBasicMaterial
          color="#020509"
          transparent
          opacity={Math.min(0.45, opacity * 0.75)}
          depthWrite={false}
          fog={false}
        />
      </mesh>

      {/* 2. 照片全息本体：晶莹剔透，保留真实色彩 */}
      <mesh geometry={photoGeom}>
        <meshBasicMaterial
          ref={materialRef}
          map={placeholderTex}
          color="#f0f9ff"
          opacity={opacity}
          fog={false}
          transparent
          depthTest
          depthWrite={false}
          blending={THREE.NormalBlending}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 3. 概念设计图同款：【电光青色自发光微晶外边框 (Electric Cyan Luminous Rim)】 */}
      <lineLoop geometry={rimGeom}>
        <lineBasicMaterial
          color="#38bdf8"
          transparent
          opacity={Math.min(0.85, opacity * 1.3)}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
        />
      </lineLoop>

      {/* 4. 概念设计图同款：左上角纯白透亮钻石切角高光 (Optical Diamond Glint) */}
      <mesh position={[-cornerX, cornerY, cornerZ + 0.008]}>
        <planeGeometry args={[0.26, 0.26]} />
        <meshBasicMaterial
          map={glintTex}
          color="#ffffff"
          transparent
          opacity={Math.min(0.70, opacity * 1.2)}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* 5. 概念设计图同款：【上边彗星激光流光柱 (Top Comet Beam)】 */}
      <mesh
        geometry={beamGeom}
        material={topBeamMat}
        position={[0, cardHeight / 2, 0.005]}
      />

      {/* 6. 概念设计图同款：【下边彗星激光流光柱 (Bottom Comet Beam)】 */}
      <mesh
        geometry={beamGeom}
        material={bottomBeamMat}
        position={[0, -cardHeight / 2, 0.005]}
      />
    </group>
  );
};
