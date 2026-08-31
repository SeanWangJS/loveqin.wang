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

// 缓存圆角微弧几何体与发光边缘曲线
let cachedCardGeom: THREE.BufferGeometry | null = null;
let cachedRimGeom: THREE.BufferGeometry | null = null;

function getRoundedCurvedGeometry(width = 3.6, height = 2.5, radius = 0.18): THREE.BufferGeometry {
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

  // 计算 UV 映射，保证圆角 Shape 贴图填满照片
  const pos = geom.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    uvs[i * 2] = (px - x) / w;
    uvs[i * 2 + 1] = (py - y) / h;
    // 微弧抛物线深度
    pos.setZ(i, -0.035 * Math.pow(px, 2));
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.computeVertexNormals();

  cachedCardGeom = geom;
  return geom;
}

function getRoundedRimGeometry(width = 3.6, height = 2.5, radius = 0.18): THREE.BufferGeometry {
  if (cachedRimGeom) return cachedRimGeom;

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

  const points2d = shape.getPoints(48);
  const points3d = points2d.map((p) => new THREE.Vector3(p.x, p.y, -0.035 * Math.pow(p.x, 2) + 0.005));

  const geom = new THREE.BufferGeometry().setFromPoints(points3d);
  cachedRimGeom = geom;
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
  const rimGeom = useMemo(() => getRoundedRimGeometry(), []);

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

  // 悬停动画平滑插值
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
      {/* 1. 纯净高清透亮照片本体（MeshBasicMaterial 消除雾气与阴影泛白污染，100% 还原纯黑与通透色彩） */}
      <mesh geometry={cardGeom}>
        <meshBasicMaterial
          ref={materialRef}
          map={placeholderTex}
          toneMapped={false}
        />
      </mesh>

      {/* 2. 激光级发光微弧圆角边框 (Laser-sharp Emissive Rim) */}
      <lineLoop geometry={rimGeom}>
        <lineBasicMaterial
          color={isHovered ? '#67e8f9' : theme.rimColor}
          linewidth={isHovered ? 2 : 1}
          transparent
          opacity={isHovered ? 0.95 : 0.65}
        />
      </lineLoop>

      {/* 3. 极简微光背板衬底（增强悬浮立体对比度） */}
      <mesh geometry={cardGeom} position={[0, 0, -0.015]}>
        <meshBasicMaterial color="#020408" transparent opacity={0.8} />
      </mesh>
    </group>
  );
};
