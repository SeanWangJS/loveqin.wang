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

// 生成具有柔和边缘羽化的电影级横向光芒拉丝贴图
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

export const PhotoCard: React.FC<PhotoCardProps> = ({ photo, positionData }) => {
  const meshRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);
  const qualityTier = useGalleryStore((s) => s.qualityTier);

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

  // 悬停动画插值
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const targetScale = isHovered ? 1.05 : 1.0;
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, 1), delta * 8);
  });

  const cardWidth = 3.4;
  const cardHeight = 2.4;

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
      {/* 照片主体 Mesh */}
      <mesh>
        <planeGeometry args={[cardWidth, cardHeight, 8, 8]} />
        <meshStandardMaterial
          ref={materialRef}
          map={placeholderTex}
          roughness={0.2}
          metalness={0.15}
          emissive={new THREE.Color(isHovered ? '#1e293b' : '#0a0f1d')}
          emissiveIntensity={isHovered ? 0.4 : 0.1}
        />
      </mesh>

      {/* 冰蓝微光卡片外边框（Emissive Rim） */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(cardWidth + 0.02, cardHeight + 0.02)]} />
        <lineBasicMaterial
          color={isHovered ? '#67e8f9' : '#38bdf8'}
          linewidth={isHovered ? 2 : 1}
          transparent
          opacity={isHovered ? 0.95 : 0.7}
        />
      </lineSegments>

      {/* 柔和羽化横向光芒拉丝（Anamorphic Optical Flares） */}
      {qualityTier !== 'low' && (
        <group position={[0, 0, -0.01]}>
          <mesh position={[-cardWidth * 0.6, 0, 0]}>
            <planeGeometry args={[cardWidth * 0.8, cardHeight * 0.7]} />
            <meshBasicMaterial
              map={streakTex}
              transparent
              opacity={isHovered ? 0.6 : 0.25}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[cardWidth * 0.6, 0, 0]}>
            <planeGeometry args={[cardWidth * 0.8, cardHeight * 0.7]} />
            <meshBasicMaterial
              map={streakTex}
              transparent
              opacity={isHovered ? 0.6 : 0.25}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
};
