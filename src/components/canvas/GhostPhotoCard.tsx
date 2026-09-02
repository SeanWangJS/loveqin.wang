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

function getStableSpread(id: string, layerIndex: number) {
  let hash = 0;
  const spreadKey = `${id}:${layerIndex}`;
  for (let i = 0; i < spreadKey.length; i++) {
    hash = (hash * 31 + spreadKey.charCodeAt(i)) | 0;
  }

  const normalizedX = ((Math.abs(hash) % 1000) / 999) - 0.5;
  const normalizedY = ((Math.abs(hash >> 8) % 1000) / 999) - 0.5;

  return {
    x: normalizedX * 0.12,
    y: normalizedY * 0.12,
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
          opacity={Math.min(0.72, opacity * 0.95)}
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
          opacity={Math.min(1.0, opacity * 1.45)}
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
          opacity={Math.min(0.85, opacity * 1.35)}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};
