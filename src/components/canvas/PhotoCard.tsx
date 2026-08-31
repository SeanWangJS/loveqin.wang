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

// 缓存羽化光芒拉丝贴图
let cachedStreakTex: THREE.CanvasTexture | null = null;
function getAnamorphicStreakTexture(): THREE.CanvasTexture {
  if (cachedStreakTex) return cachedStreakTex;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
  grad.addColorStop(0.3, 'rgba(56, 189, 248, 0.25)');
  grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.4)');
  grad.addColorStop(0.7, 'rgba(56, 189, 248, 0.25)');
  grad.addColorStop(1, 'rgba(56, 189, 248, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);

  cachedStreakTex = new THREE.CanvasTexture(canvas);
  return cachedStreakTex;
}

// 生成微弧抛物线圆柱面网格几何体 (Z = -0.06 * X^2)
function createCurvedCardGeometry(width: number, height: number): THREE.PlaneGeometry {
  const geom = new THREE.PlaneGeometry(width, height, 16, 4);
  const pos = geom.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    // 优雅微弧抛物线深度
    const zOffset = -0.045 * Math.pow(x, 2);
    pos.setZ(i, zOffset);
  }

  geom.computeVertexNormals();
  return geom;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({ photo, positionData }) => {
  const meshRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);
  const qualityTier = useGalleryStore((s) => s.qualityTier);

  // 照片年份对应岁月色温
  const photoYear = new Date(photo.takenAtSort).getFullYear();
  const theme = useMemo(() => getTimeTemperature(photoYear), [photoYear]);

  // 微弧网格几何体
  const cardWidth = 3.4;
  const cardHeight = 2.4;
  const curvedGeometry = useMemo(() => createCurvedCardGeometry(cardWidth, cardHeight), [cardWidth, cardHeight]);

  const placeholderTex = useMemo(() => {
    return getCardPlaceholderTexture(photo.title, photo.locationName, photo.id);
  }, [photo.title, photo.locationName, photo.id]);

  const streakTex = useMemo(() => getAnamorphicStreakTexture(), []);

  // 异步 LRU 显存池加载
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

  // 2.5D 视差悬停动画插值
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const targetScale = isHovered ? 1.06 : 1.0;
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
      {/* 1. 微弧照片主体 Mesh */}
      <mesh geometry={curvedGeometry}>
        <meshStandardMaterial
          ref={materialRef}
          map={placeholderTex}
          roughness={0.2}
          metalness={0.12}
          emissive={theme.rimColor}
          emissiveIntensity={isHovered ? 0.35 : 0.08}
        />
      </mesh>

      {/* 2. 岁月色温微光外边框 (Emissive Rim) */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(cardWidth + 0.02, cardHeight + 0.02)]} />
        <lineBasicMaterial
          color={theme.rimColor}
          linewidth={isHovered ? 2 : 1}
          transparent
          opacity={isHovered ? 0.95 : 0.65}
        />
      </lineSegments>

      {/* 3. 柔和羽化横向光芒拉丝（Anamorphic Optical Flares） */}
      {qualityTier !== 'low' && (
        <group position={[0, 0, -0.02]}>
          <mesh position={[-cardWidth * 0.6, 0, 0]}>
            <planeGeometry args={[cardWidth * 0.8, cardHeight * 0.7]} />
            <meshBasicMaterial
              map={streakTex}
              color={theme.rimColor}
              transparent
              opacity={isHovered ? 0.6 : 0.22}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[cardWidth * 0.6, 0, 0]}>
            <planeGeometry args={[cardWidth * 0.8, cardHeight * 0.7]} />
            <meshBasicMaterial
              map={streakTex}
              color={theme.rimColor}
              transparent
              opacity={isHovered ? 0.6 : 0.22}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
};
