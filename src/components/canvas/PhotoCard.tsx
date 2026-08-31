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

// 缓存 3D 几何体
let cachedPhotoGeom: THREE.BufferGeometry | null = null;
let cachedHairlineRimGeom: THREE.BufferGeometry | null = null;
let cachedBackplateGeom: THREE.BufferGeometry | null = null;

// 照片微弧圆角网格 (Z = -0.035 * X^2)
function getRoundedCurvedGeometry(width = 3.6, height = 2.5, radius = 0.18): THREE.BufferGeometry {
  if (cachedPhotoGeom) return cachedPhotoGeom;

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

  cachedPhotoGeom = geom;
  return geom;
}

// 极细“一丝丝”微光倒角轮廓线（Hairline Bevel Rim，厚度克制、清爽利落）
function getHairlineRimGeometry(width = 3.6, height = 2.5, radius = 0.18): THREE.BufferGeometry {
  if (cachedHairlineRimGeom) return cachedHairlineRimGeom;

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
  const points3d = points2d.map((p) => new THREE.Vector3(p.x, p.y, -0.035 * Math.pow(p.x, 2) + 0.003));

  const geom = new THREE.BufferGeometry().setFromPoints(points3d);
  cachedHairlineRimGeom = geom;
  return geom;
}

// 极简深色背板
function getBackplateGeometry(width = 3.62, height = 2.52, radius = 0.19): THREE.BufferGeometry {
  if (cachedBackplateGeom) return cachedBackplateGeom;

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
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    pos.setZ(i, -0.035 * Math.pow(px, 2) - 0.01);
  }
  geom.computeVertexNormals();

  cachedBackplateGeom = geom;
  return geom;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({ photo, positionData }) => {
  const meshRef = useRef<THREE.Group>(null);
  const photoMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);

  const photoGeom = useMemo(() => getRoundedCurvedGeometry(3.6, 2.5, 0.18), []);
  const rimGeom = useMemo(() => getHairlineRimGeometry(3.6, 2.5, 0.18), []);
  const backplateGeom = useMemo(() => getBackplateGeometry(3.62, 2.52, 0.19), []);

  const placeholderTex = useMemo(() => {
    return getCardPlaceholderTexture(photo.title, photo.locationName, photo.id);
  }, [photo.title, photo.locationName, photo.id]);

  // 异步 LRU 显存池加载真图
  useEffect(() => {
    let cancelLow: (() => void) | null = null;

    const cancelHigh = globalTexturePool.load(
      photo.urlThumbHigh,
      (loadedTexture) => {
        if (photoMaterialRef.current) {
          photoMaterialRef.current.map = loadedTexture;
          photoMaterialRef.current.needsUpdate = true;
        }
      },
      () => {
        cancelLow = globalTexturePool.load(photo.urlThumbLow, (fallbackTex) => {
          if (photoMaterialRef.current) {
            photoMaterialRef.current.map = fallbackTex;
            photoMaterialRef.current.needsUpdate = true;
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
      {/* 1. 照片本体：纯净直出（MeshBasicMaterial + toneMapped=false），100% 零光污染、零泛白，纯黑通透 */}
      <mesh geometry={photoGeom}>
        <meshBasicMaterial
          ref={photoMaterialRef}
          map={placeholderTex}
          toneMapped={false}
        />
      </mesh>

      {/* 2. 概念图同款：“一丝丝”极细冷银白微光倒角边框（Hairline Glass Rim） */}
      {/* 粗细适度、克制高级，绝不扩散污染照片 */}
      <lineLoop geometry={rimGeom}>
        <lineBasicMaterial
          color={isHovered ? '#67e8f9' : '#e2e8f0'}
          transparent
          opacity={isHovered ? 0.95 : 0.55}
        />
      </lineLoop>

      {/* 3. 悬浮深邃微晶玻璃背板（增加悬浮立体感） */}
      <mesh geometry={backplateGeom}>
        <meshBasicMaterial
          color="#020408"
          transparent
          opacity={0.85}
        />
      </mesh>
    </group>
  );
};
