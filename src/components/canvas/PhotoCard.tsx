import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PhotoItem, SpatialPosition } from '../../types/gallery';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { globalTexturePool } from '../../utils/textureLRUPool';
import { getCardPlaceholderTexture } from '../../utils/placeholderGenerator';

interface PhotoCardProps {
  photo: PhotoItem;
  positionData: SpatialPosition;
}

// 缓存圆角微弧几何体、玻璃边缘线与纯白钻石级光学光晕贴图
let cachedCardGeom: THREE.BufferGeometry | null = null;
let cachedGlassRimGeom: THREE.BufferGeometry | null = null;
let cachedGlintTex: THREE.CanvasTexture | null = null;

// 动态生成概念图同款：【纯白晶莹白热核心 + 柔和冷白晕染 + 十字星芒】
function getCornerOpticalGlintTexture(): THREE.CanvasTexture {
  if (cachedGlintTex) return cachedGlintTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const cx = 128;
  const cy = 128;

  // 1. 核心纯白热透亮光晕 (Pure Diamond White Radial Glow)
  const radGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 110);
  radGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  radGrad.addColorStop(0.18, 'rgba(255, 255, 255, 0.95)');
  radGrad.addColorStop(0.42, 'rgba(241, 245, 249, 0.65)');
  radGrad.addColorStop(0.72, 'rgba(224, 242, 254, 0.18)');
  radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = radGrad;
  ctx.fillRect(0, 0, 256, 256);

  // 2. 纯白细长十字星芒 (Pure White Diamond Flare)
  // 水平微星芒
  const hGrad = ctx.createLinearGradient(0, cy, 256, cy);
  hGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  hGrad.addColorStop(0.36, 'rgba(255, 255, 255, 0.45)');
  hGrad.addColorStop(0.5, 'rgba(255, 255, 255, 1.0)');
  hGrad.addColorStop(0.64, 'rgba(255, 255, 255, 0.45)');
  hGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hGrad;
  ctx.fillRect(0, cy - 2, 256, 4);

  // 垂直微星芒
  const vGrad = ctx.createLinearGradient(cx, 0, cx, 256);
  vGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
  vGrad.addColorStop(0.36, 'rgba(255, 255, 255, 0.45)');
  vGrad.addColorStop(0.5, 'rgba(255, 255, 255, 1.0)');
  vGrad.addColorStop(0.64, 'rgba(255, 255, 255, 0.45)');
  vGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = vGrad;
  ctx.fillRect(cx - 2, 0, 4, 256);

  cachedGlintTex = new THREE.CanvasTexture(canvas);
  cachedGlintTex.colorSpace = THREE.SRGBColorSpace;
  return cachedGlintTex;
}

// 照片微弧圆角网格 (Z = -0.035 * X^2)
function getRoundedCurvedGeometry(width = 3.6, height = 2.5, radius = 0.22): THREE.BufferGeometry {
  if (cachedCardGeom) return cachedCardGeom;

  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const w = width;
  const h = height;
  const r = radius;

  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  const geom = new THREE.ShapeGeometry(shape, 24);
  const pos = geom.attributes.position;
  const uvs = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    uvs[i * 2] = (px - x) / w;
    uvs[i * 2 + 1] = (py - y) / h;
    pos.setZ(i, -0.035 * Math.pow(px, 2));
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.computeVertexNormals();

  cachedCardGeom = geom;
  return geom;
}

// 概念图同款：通透、极细的白银色悬浮玻璃微弧边缘轮廓线
function getContinuousGlassRimGeometry(width = 3.6, height = 2.5, radius = 0.22): THREE.BufferGeometry {
  if (cachedGlassRimGeom) return cachedGlassRimGeom;

  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const w = width;
  const h = height;
  const r = radius;

  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  const points2d = shape.getPoints(64);
  const points3d = points2d.map((p) => new THREE.Vector3(p.x, p.y, -0.035 * Math.pow(p.x, 2) + 0.004));

  const geom = new THREE.BufferGeometry().setFromPoints(points3d);
  cachedGlassRimGeom = geom;
  return geom;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({ photo, positionData }) => {
  const meshRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);

  const cardWidth = 3.6;
  const cardHeight = 2.5;
  const cornerRadius = 0.22;

  const cardGeom = useMemo(() => getRoundedCurvedGeometry(cardWidth, cardHeight, cornerRadius), []);
  const rimGeom = useMemo(() => getContinuousGlassRimGeometry(cardWidth, cardHeight, cornerRadius), []);
  const glintTexture = useMemo(() => getCornerOpticalGlintTexture(), []);

  const placeholderTex = useMemo(() => {
    return getCardPlaceholderTexture(photo.title, photo.locationName, photo.id);
  }, [photo.title, photo.locationName, photo.id]);

  // 异步 LRU 显存池加载真图
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

  // 悬停动画插值
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const targetScale = isHovered ? 1.05 : 1.0;
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, 1), delta * 8);
  });

  // 4 个圆角的顶点精确位置
  const cornerX = cardWidth / 2 - cornerRadius * 0.4;
  const cornerY = cardHeight / 2 - cornerRadius * 0.4;
  const cornerZ = -0.035 * Math.pow(cornerX, 2) + 0.008;

  return (
    <group
      ref={meshRef}
      position={[positionData.x, positionData.y, positionData.z]}
      rotation={[positionData.rotationX, positionData.rotationY, positionData.rotationZ]}
      onPointerOver={(e) => {
        e.stopPropagation();
        setIsHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setIsHovered(false);
        document.body.style.cursor = 'default';
      }}
      onClick={(e) => {
        e.stopPropagation();
        setSelectedPhoto(photo);
      }}
    >
      {/* 1. 高清透亮微弧照片本体（纯净通透，深邃对比度） */}
      <mesh geometry={cardGeom}>
        <meshBasicMaterial
          ref={materialRef}
          map={placeholderTex}
          toneMapped={false}
        />
      </mesh>

      {/* 2. 概念图同款：通透、极细的纯白银色悬浮玻璃边框线 */}
      <lineLoop geometry={rimGeom}>
        <lineBasicMaterial
          color={isHovered ? '#ffffff' : '#f1f5f9'}
          transparent
          opacity={isHovered ? 0.95 : 0.65}
        />
      </lineLoop>

      {/* 3. 概念图核心：【4 个切角处的纯白璀璨光学星芒光晕 (Pure White Diamond Glints)】 */}
      {/* ① 左上角高光点（主采光星芒） */}
      <mesh position={[-cornerX, cornerY, cornerZ]}>
        <planeGeometry args={[0.55, 0.55]} />
        <meshBasicMaterial
          map={glintTexture}
          color="#ffffff"
          transparent
          opacity={isHovered ? 1.0 : 0.92}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* ② 左下角高光点 */}
      <mesh position={[-cornerX, -cornerY, cornerZ]}>
        <planeGeometry args={[0.48, 0.48]} />
        <meshBasicMaterial
          map={glintTexture}
          color="#ffffff"
          transparent
          opacity={isHovered ? 0.95 : 0.82}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* ③ 右上角高光点 */}
      <mesh position={[cornerX, cornerY, cornerZ]}>
        <planeGeometry args={[0.38, 0.38]} />
        <meshBasicMaterial
          map={glintTexture}
          color="#ffffff"
          transparent
          opacity={isHovered ? 0.85 : 0.65}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* ④ 右下角高光点 */}
      <mesh position={[cornerX, -cornerY, cornerZ]}>
        <planeGeometry args={[0.32, 0.32]} />
        <meshBasicMaterial
          map={glintTexture}
          color="#ffffff"
          transparent
          opacity={isHovered ? 0.75 : 0.5}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* 4. 悬浮暗色微弧玻璃背板衬底 */}
      <mesh geometry={cardGeom} position={[0, 0, -0.015]}>
        <meshBasicMaterial color="#020408" transparent opacity={0.88} />
      </mesh>
    </group>
  );
};
