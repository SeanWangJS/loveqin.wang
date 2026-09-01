import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PhotoItem, SpatialPosition } from '../../types/gallery';
import { globalTexturePool } from '../../utils/textureLRUPool';
import { getCardPlaceholderTexture } from '../../utils/placeholderGenerator';

interface GhostPhotoCardProps {
  photo: PhotoItem;
  positionData: SpatialPosition;
  layerIndex: number;
  depthOffset: number;
  lateralOffset: number;
  verticalOffset?: number;
  scaleFactor: number;
}

function getStableSpread(id: string, layerIndex: number) {
  let hash = 0;
  const spreadKey = `${id}:${layerIndex}`;
  for (let i = 0; i < spreadKey.length; i++) {
    hash = (hash * 31 + spreadKey.charCodeAt(i)) | 0;
  }

  const normalizedX = ((Math.abs(hash) % 1000) / 999) - 0.5;
  const normalizedY = ((Math.abs(hash >> 8) % 1000) / 999) - 0.5;
  const normalizedZ = ((Math.abs(hash >> 16) % 1000) / 999) - 0.5;

  return {
    x: normalizedX * 0.6,
    y: normalizedY * 0.8,
    z: normalizedZ * 4.2,
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
}) => {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const spread = useMemo(() => getStableSpread(photo.id, layerIndex), [photo.id, layerIndex]);
  const isNearLayer = layerIndex < 3;

  const placeholderTex = useMemo(() => {
    return getCardPlaceholderTexture(photo.title, photo.locationName, photo.id);
  }, [photo.title, photo.locationName, photo.id]);

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

  return (
    <mesh
      position={[
        positionData.x + Math.sign(positionData.x) * lateralOffset + spread.x,
        positionData.y + verticalOffset + spread.y,
        positionData.z - depthOffset + spread.z,
      ]}
      rotation={[positionData.rotationX, positionData.rotationY, positionData.rotationZ]}
      scale={positionData.scale * scaleFactor}
    >
      <planeGeometry args={[4.6, 3.4]} />
      <meshBasicMaterial
        ref={materialRef}
        map={placeholderTex}
        color={isNearLayer ? '#d1dae0' : '#9aa8b1'}
        opacity={isNearLayer ? 0.22 : 0.14}
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
