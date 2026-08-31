import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PhotoItem, SpatialPosition } from '../../types/gallery';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { globalTexturePool } from '../../utils/textureLRUPool';
import { getCardPlaceholderTexture } from '../../utils/placeholderGenerator';
import { getTimeTemperature } from '../../utils/timeTemperature';

interface PhotoCardProps {
  photo: PhotoItem;
  positionData: SpatialPosition;
}

// 缓存圆角几何体、实体发光边框与柔光辉光外晕
let cachedCardGeom: THREE.BufferGeometry | null = null;
let cachedRimMeshGeom: THREE.BufferGeometry | null = null;
let cachedHaloMeshGeom: THREE.BufferGeometry | null = null;

// 照片本体微弧圆角网格
function getRoundedCurvedGeometry(width = 3.6, height = 2.5, radius = 0.2): THREE.BufferGeometry {
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

// 实体微弧发光圆角外边框网格（有宽度，彻底解决 1px 细线不发光问题）
function getRoundedRimMeshGeometry(width = 3.6, height = 2.5, radius = 0.2, thickness = 0.045): THREE.BufferGeometry {
  if (cachedRimMeshGeom) return cachedRimMeshGeom;

  const outerShape = new THREE.Shape();
  const innerShape = new THREE.Path();

  const ox = -width / 2;
  const oy = -height / 2;
  const ow = width;
  const oh = height;
  const or = radius;

  outerShape.moveTo(ox + or, oy);
  outerShape.lineTo(ox + ow - or, oy);
  outerShape.quadraticCurveTo(ox + ow, oy, ox + ow, oy + or);
  outerShape.lineTo(ox + ow, oy + oh - or);
  outerShape.quadraticCurveTo(ox + ow, oy + oh, ox + ow - or, oy + oh);
  outerShape.lineTo(ox + or, oy + oh);
  outerShape.quadraticCurveTo(ox, oy + oh, ox, oy + oh - or);
  outerShape.lineTo(ox, oy + or);
  outerShape.quadraticCurveTo(ox, oy, ox + or, oy);

  const ix = ox + thickness;
  const iy = oy + thickness;
  const iw = ow - thickness * 2;
  const ih = oh - thickness * 2;
  const ir = Math.max(0.01, or - thickness);

  innerShape.moveTo(ix + ir, iy);
  innerShape.lineTo(ix + iw - ir, iy);
  innerShape.quadraticCurveTo(ix + iw, iy, ix + iw, iy + ir);
  innerShape.lineTo(ix + iw, iy + ih - ir);
  innerShape.quadraticCurveTo(ix + iw, iy + ih, ix + iw - ir, iy + ih);
  innerShape.lineTo(ix + ir, iy + ih);
  innerShape.quadraticCurveTo(ix, iy + ih, ix, iy + ih - ir);
  innerShape.lineTo(ix, iy + ir);
  innerShape.quadraticCurveTo(ix, iy, ix + ir, iy);

  outerShape.holes.push(innerShape);

  const geom = new THREE.ShapeGeometry(outerShape, 24);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    pos.setZ(i, -0.035 * Math.pow(px, 2) + 0.005);
  }
  geom.computeVertexNormals();

  cachedRimMeshGeom = geom;
  return geom;
}

// 概念图中的外层柔和扩散发光外晕（Soft Neon Halo Mesh）
function getRoundedHaloMeshGeometry(width = 3.6, height = 2.5, radius = 0.2, thickness = 0.12): THREE.BufferGeometry {
  if (cachedHaloMeshGeom) return cachedHaloMeshGeom;

  const outerShape = new THREE.Shape();
  const innerShape = new THREE.Path();

  const ox = -width / 2 - 0.03;
  const oy = -height / 2 - 0.03;
  const ow = width + 0.06;
  const oh = height + 0.06;
  const or = radius + 0.03;

  outerShape.moveTo(ox + or, oy);
  outerShape.lineTo(ox + ow - or, oy);
  outerShape.quadraticCurveTo(ox + ow, oy, ox + ow, oy + or);
  outerShape.lineTo(ox + ow, oy + oh - or);
  outerShape.quadraticCurveTo(ox + ow, oy + oh, ox + ow - or, oy + oh);
  outerShape.lineTo(ox + or, oy + oh);
  outerShape.quadraticCurveTo(ox, oy + oh, ox, oy + oh - or);
  outerShape.lineTo(ox, oy + or);
  outerShape.quadraticCurveTo(ox, oy, ox + or, oy);

  const ix = ox + thickness;
  const iy = oy + thickness;
  const iw = ow - thickness * 2;
  const ih = oh - thickness * 2;
  const ir = Math.max(0.01, or - thickness);

  innerShape.moveTo(ix + ir, iy);
  innerShape.lineTo(ix + iw - ir, iy);
  innerShape.quadraticCurveTo(ix + iw, iy, ix + iw, iy + ir);
  innerShape.lineTo(ix + iw, iy + ih - ir);
  innerShape.quadraticCurveTo(ix + iw, iy + ih, ix + iw - ir, iy + ih);
  innerShape.lineTo(ix + ir, iy + ih);
  innerShape.quadraticCurveTo(ix, iy + ih, ix, iy + ih - ir);
  innerShape.lineTo(ix, iy + ir);
  innerShape.quadraticCurveTo(ix, iy, ix + ir, iy);

  outerShape.holes.push(innerShape);

  const geom = new THREE.ShapeGeometry(outerShape, 24);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    pos.setZ(i, -0.035 * Math.pow(px, 2) + 0.003);
  }
  geom.computeVertexNormals();

  cachedHaloMeshGeom = geom;
  return geom;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({ photo, positionData }) => {
  const meshRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);

  const photoYear = new Date(photo.takenAtSort).getFullYear();
  const theme = useMemo(() => getTimeTemperature(photoYear), [photoYear]);

  const cardGeom = useMemo(() => getRoundedCurvedGeometry(), []);
  const rimMeshGeom = useMemo(() => getRoundedRimMeshGeometry(), []);
  const haloMeshGeom = useMemo(() => getRoundedHaloMeshGeometry(), []);

  const placeholderTex = useMemo(() => {
    return getCardPlaceholderTexture(photo.title, photo.locationName, photo.id);
  }, [photo.title, photo.locationName, photo.id]);

  // HDR 超亮度发光颜色（突破 Bloom 阈值，产生炫目柔光）
  const hdrRimColor = useMemo(() => {
    const baseColor = isHovered ? new THREE.Color('#67e8f9') : theme.rimColor;
    return baseColor.clone().multiplyScalar(isHovered ? 3.5 : 2.4);
  }, [isHovered, theme.rimColor]);

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
      {/* 1. 高清透亮微弧照片本体 */}
      <mesh geometry={cardGeom}>
        <meshBasicMaterial
          ref={materialRef}
          map={placeholderTex}
          toneMapped={false}
        />
      </mesh>

      {/* 2. HDR 强自发光微弧圆角边缘框架（实体 Mesh，高亮度发光，100% 触发炫目光晕） */}
      <mesh geometry={rimMeshGeom}>
        <meshBasicMaterial
          color={hdrRimColor}
          toneMapped={false}
          transparent
          opacity={isHovered ? 1.0 : 0.85}
        />
      </mesh>

      {/* 3. 外层柔和霓虹晕光（Soft Additive Halo） */}
      <mesh geometry={haloMeshGeom}>
        <meshBasicMaterial
          color={hdrRimColor}
          toneMapped={false}
          transparent
          opacity={isHovered ? 0.45 : 0.2}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* 4. 微光黑色衬底 */}
      <mesh geometry={cardGeom} position={[0, 0, -0.015]}>
        <meshBasicMaterial color="#020408" transparent opacity={0.8} />
      </mesh>
    </group>
  );
};
