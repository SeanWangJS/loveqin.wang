import React, { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PhotoItem, SpatialPosition } from '../../types/gallery';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { loadTextureThrottled } from '../../utils/textureQueue';

interface PhotoCardProps {
  photo: PhotoItem;
  positionData: SpatialPosition;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({ photo, positionData }) => {
  const meshRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [textureLoaded, setTextureLoaded] = useState(false);

  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);
  const qualityTier = useGalleryStore((s) => s.qualityTier);

  // 异步限流纹理加载（带自动取消与缓存）
  useEffect(() => {
    let cancelLow: (() => void) | null = null;

    const cancelHigh = loadTextureThrottled(
      photo.urlThumbHigh,
      (loadedTexture) => {
        if (materialRef.current) {
          materialRef.current.map = loadedTexture;
          materialRef.current.needsUpdate = true;
        }
        setTextureLoaded(true);
      },
      () => {
        // 高清失败则尝试低清
        cancelLow = loadTextureThrottled(photo.urlThumbLow, (fallbackTex) => {
          if (materialRef.current) {
            materialRef.current.map = fallbackTex;
            materialRef.current.needsUpdate = true;
          }
          setTextureLoaded(true);
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
    const targetScale = isHovered ? 1.06 : 1.0;
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
      {/* 照片主体 Mesh（带有即时渐变占位底色，加载完毕平滑贴图） */}
      <mesh>
        <planeGeometry args={[cardWidth, cardHeight, 8, 8]} />
        <meshStandardMaterial
          ref={materialRef}
          color={textureLoaded ? '#ffffff' : '#0f172a'}
          roughness={0.25}
          metalness={0.1}
          emissive={new THREE.Color(isHovered ? '#1e293b' : '#06080b')}
          emissiveIntensity={isHovered ? 0.35 : 0.05}
        />
      </mesh>

      {/* 冰蓝微光卡片外边框（Emissive Rim） */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(cardWidth + 0.02, cardHeight + 0.02)]} />
        <lineBasicMaterial
          color={isHovered ? '#67e8f9' : '#38bdf8'}
          linewidth={isHovered ? 2 : 1}
          transparent
          opacity={isHovered ? 0.95 : 0.65}
        />
      </lineSegments>

      {/* 概念图中的横向光芒拉丝（Anamorphic Light Streaks） */}
      {qualityTier !== 'low' && (
        <group position={[0, 0, -0.01]}>
          <mesh position={[-cardWidth * 0.75, 0, 0]}>
            <planeGeometry args={[cardWidth * 0.8, cardHeight * 0.9]} />
            <meshBasicMaterial
              color="#38bdf8"
              transparent
              opacity={isHovered ? 0.35 : 0.12}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <mesh position={[cardWidth * 0.75, 0, 0]}>
            <planeGeometry args={[cardWidth * 0.8, cardHeight * 0.9]} />
            <meshBasicMaterial
              color="#38bdf8"
              transparent
              opacity={isHovered ? 0.35 : 0.12}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}
    </group>
  );
};
