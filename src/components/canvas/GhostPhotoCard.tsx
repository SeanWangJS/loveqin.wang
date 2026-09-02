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

// 概念图同款：严格内嵌在卡片微弧曲面上的横向彗星光柱几何体，绝不超出两端
function createCurvedBeamGeometry(length: number, offset: number, isRightWall: boolean): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(length, 0.08, 24, 1);
  const pos = geom.attributes.position;
  const uvs = geom.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    const localX = pos.getX(i);
    const cardX = localX + offset; // 该点在卡片中心坐标系下的真实 X 坐标
    // 严格按照卡片微弧方程挠度拟合，保证与主卡微弧严丝合缝
    pos.setZ(i, -0.028 * Math.pow(cardX, 2) + 0.012);

    // 右侧墙面翻转 UV，保证彗星头部始终朝向视线近端
    if (isRightWall) {
      uvs.setX(i, 1.0 - uvs.getX(i));
    }
  }

  pos.needsUpdate = true;
  if (isRightWall) uvs.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

// 缓存不同透明度的静止彗星光束材质（无需流动，极简高保真光学质感）
const beamMaterialCache = new Map<number, THREE.ShaderMaterial>();

function getCometBeamMaterial(opacity: number): THREE.ShaderMaterial {
  const roundedOpacity = Math.round(opacity * 100) / 100;
  let mat = beamMaterialCache.get(roundedOpacity);
  if (mat) return mat;

  mat = new THREE.ShaderMaterial({
    uniforms: {
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
      uniform vec3 uColor;
      uniform vec3 uHeadColor;
      uniform float uOpacity;

      void main() {
        // 1. 截面纵向高斯/sin^2 羽化（中轴白热极细激光核心，边缘平滑衰减为透明光晕）
        float lateral = clamp(sin(vUv.y * 3.14159265), 0.0, 1.0);
        float core = lateral * lateral * lateral * lateral; // 极细白热激光核心
        float halo = lateral * lateral;                    // 柔和外围光晕

        // 2. 概念设计图同款：【静止彗星形态（无需流动，静谧优雅）】
        // 头部位于前端 (vUv.x ~ 0.86)，呈现纯白高亮高斯白热核；
        // 彗尾平滑向深端 (vUv.x -> 0.0) 展开拖曳，能量平缓衰减。
        float headDist = (vUv.x - 0.86) * 11.0;
        float head = exp(-headDist * headDist); // 高斯白热流星核
        float tail = pow(clamp(vUv.x / 0.86, 0.0, 1.0), 2.8); // 彗尾平滑拖曳
        float comet = head * 2.8 + tail * 0.9;

        // 3. 两端横向自然淡出，杜绝边缘几何生硬截断
        float endFade = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));

        float totalIntensity = (core * 2.5 + halo * 0.9) * comet * endFade;
        vec3 col = mix(uColor, uHeadColor, head * 0.95);

        gl_FragColor = vec4(col * totalIntensity, clamp(totalIntensity * uOpacity * 0.88, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  beamMaterialCache.set(roundedOpacity, mat);
  return mat;
}

// 概念图同款：确定性非对称随机光束分布（要么上边加，要么下边加，部分留白，杜绝机械呆板）
function getBeamPlacement(id: string, layerIndex: number): 'top' | 'bottom' | 'none' {
  let hash = 0;
  const key = `beam:${id}:${layerIndex}`;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 37 + key.charCodeAt(i)) | 0;
  }
  const mod = Math.abs(hash) % 100;
  if (mod < 38) return 'top';
  if (mod < 76) return 'bottom';
  return 'none';
}

// 概念图同款：随机光束长度与水平位置，严格约束在卡片内部 [-2.25, +2.25] 范围，绝不超出两端
function getBeamParams(id: string, layerIndex: number) {
  let hash = 0;
  const key = `beam-geo:${id}:${layerIndex}`;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 43 + key.charCodeAt(i)) | 0;
  }
  const r1 = ((Math.abs(hash) % 1000) / 999);
  const r2 = (((Math.abs(hash) >> 8) % 1000) / 999);

  // 光束长度：2.0m ~ 3.4m（卡片总宽 4.6m，半宽 2.3m）
  const length = 2.0 + r1 * 1.4;
  // 最大允许偏移行程，严格锁定在卡片边缘内，绝不超出两端：
  // offset - length/2 >= -2.25 且 offset + length/2 <= 2.25
  const maxShift = Math.max(0.05, 2.25 - length / 2);
  const offset = (r2 - 0.5) * 2 * maxShift;

  return { length, offset };
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

  // 概念图同款：非对称随机彗星光束参数（长度与偏移位置，严格内嵌在照片两端）
  const isRightWall = positionData.x > 0;
  const beamMat = useMemo(() => getCometBeamMaterial(opacity), [opacity]);
  const beamPlacement = useMemo(() => getBeamPlacement(photo.id, layerIndex), [photo.id, layerIndex]);
  const beamParams = useMemo(() => getBeamParams(photo.id, layerIndex), [photo.id, layerIndex]);

  const beamGeom = useMemo(() => {
    return createCurvedBeamGeometry(beamParams.length, beamParams.offset, isRightWall);
  }, [beamParams.length, beamParams.offset, isRightWall]);

  useEffect(() => {
    return () => {
      beamGeom.dispose();
    };
  }, [beamGeom]);

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

  // 优雅轻柔的深空零重力悬浮呼吸微动
  useFrame((state) => {
    if (meshRef.current) {
      const t = state.clock.getElapsedTime();
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

      {/* 5. 概念设计图同款：随机光束位置，严格内嵌在照片两端之内 */}
      {beamPlacement === 'top' && (
        <mesh
          geometry={beamGeom}
          material={beamMat}
          position={[beamParams.offset, cardHeight / 2, 0.005]}
        />
      )}

      {beamPlacement === 'bottom' && (
        <mesh
          geometry={beamGeom}
          material={beamMat}
          position={[beamParams.offset, -cardHeight / 2, 0.005]}
        />
      )}
    </group>
  );
};
