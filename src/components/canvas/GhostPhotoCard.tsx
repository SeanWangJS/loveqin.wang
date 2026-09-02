import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PhotoItem, SpatialPosition } from '../../types/gallery';
import { globalTexturePool } from '../../utils/textureLRUPool';
import { getCardPlaceholderTexture } from '../../utils/placeholderGenerator';
import { getRoundedCurvedGeometry } from './PhotoCard';

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

function getStableSpread(id: string, layerIndex: number) {
  let hash = 0;
  const spreadKey = `${id}:${layerIndex}`;
  for (let i = 0; i < spreadKey.length; i++) {
    hash = (hash * 31 + spreadKey.charCodeAt(i)) | 0;
  }

  const normalizedX = ((Math.abs(hash) % 1000) / 999) - 0.5;
  const normalizedY = ((Math.abs(hash >> 8) % 1000) / 999) - 0.5;

  return {
    x: normalizedX * 0.15,
    y: normalizedY * 0.15,
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
  opacity = 0.35,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const spread = useMemo(() => getStableSpread(photo.id, layerIndex), [photo.id, layerIndex]);

  const placeholderTex = useMemo(() => {
    return getCardPlaceholderTexture(photo.title, photo.locationName, photo.id);
  }, [photo.title, photo.locationName, photo.id]);

  const geometry = useMemo(() => getRoundedCurvedGeometry(4.6, 3.4, 0.32), []);

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

  // 基准三维空间坐标（紧随主照片后方展开的 3D 折扇拓扑）
  const baseX = positionData.x + Math.sign(positionData.x) * lateralOffset + spread.x;
  const baseY = positionData.y + verticalOffset + spread.y;
  const baseZ = positionData.z - depthOffset;

  // 优雅轻柔的深空零重力悬浮呼吸微动
  useFrame((state) => {
    if (meshRef.current) {
      const t = state.clock.getElapsedTime();
      meshRef.current.position.y = baseY + Math.sin(t * 1.2 + layerIndex * 0.4) * 0.05;
      meshRef.current.rotation.z = positionData.rotationZ + Math.cos(t * 0.9 + layerIndex * 0.3) * 0.01;
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={[baseX, baseY, baseZ]}
      rotation={[positionData.rotationX, positionData.rotationY, positionData.rotationZ]}
      scale={positionData.scale * scaleFactor}
      renderOrder={2}
    >
      <primitive object={geometry} attach="geometry" />
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
  );
};
