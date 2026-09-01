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

let cachedPhotoGeom: THREE.BufferGeometry | null = null;
let cachedHairlineRimGeom: THREE.BufferGeometry | null = null;
let cachedBackplateGeom: THREE.BufferGeometry | null = null;
let cachedDiamondGlintTex: THREE.CanvasTexture | null = null;

// 概念设计图同款：【小巧克制、纯白透亮钻石切角高光 (Optical Diamond Glint)】
function getDiamondGlintTexture(): THREE.CanvasTexture {
  if (cachedDiamondGlintTex) return cachedDiamondGlintTex;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const cx = 64;
  const cy = 64;

  // 1. 核心白热径向高光
  const rad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 54);
  rad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  rad.addColorStop(0.18, 'rgba(255, 255, 255, 0.95)');
  rad.addColorStop(0.45, 'rgba(224, 242, 254, 0.35)');
  rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = rad;
  ctx.fillRect(0, 0, 128, 128);

  // 2. 细长水平微星芒
  const streakH = ctx.createLinearGradient(0, cy, 128, cy);
  streakH.addColorStop(0, 'rgba(255, 255, 255, 0)');
  streakH.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
  streakH.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = streakH;
  ctx.fillRect(0, cy - 1, 128, 2);

  // 3. 细长垂直微星芒
  const streakV = ctx.createLinearGradient(cx, 0, cx, 128);
  streakV.addColorStop(0, 'rgba(255, 255, 255, 0)');
  streakV.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
  streakV.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = streakV;
  ctx.fillRect(cx - 1, 0, 2, 128);

  cachedDiamondGlintTex = new THREE.CanvasTexture(canvas);
  cachedDiamondGlintTex.colorSpace = THREE.SRGBColorSpace;
  return cachedDiamondGlintTex;
}

// 概念设计图同款：宏伟大尺寸微弧圆角网格 (宽 4.6，高 3.4，柔和优雅大圆角 0.32)
function getRoundedCurvedGeometry(width = 4.6, height = 3.4, radius = 0.32): THREE.BufferGeometry {
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
    pos.setZ(i, -0.028 * Math.pow(px, 2));
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.computeVertexNormals();

  cachedPhotoGeom = geom;
  return geom;
}

// 概念图同款：极细发丝级微光倒角轮廓线
function getHairlineRimGeometry(width = 4.6, height = 3.4, radius = 0.32): THREE.BufferGeometry {
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
  const points3d = points2d.map((p) => new THREE.Vector3(p.x, p.y, -0.028 * Math.pow(p.x, 2) + 0.004));

  const geom = new THREE.BufferGeometry().setFromPoints(points3d);
  cachedHairlineRimGeom = geom;
  return geom;
}

// 悬浮深邃微晶玻璃背板
function getBackplateGeometry(width = 4.63, height = 3.43, radius = 0.33): THREE.BufferGeometry {
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
    pos.setZ(i, -0.028 * Math.pow(px, 2) - 0.008);
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

  const cardWidth = 4.6;
  const cardHeight = 3.4;
  const cornerRadius = 0.32;

  const photoGeom = useMemo(() => getRoundedCurvedGeometry(cardWidth, cardHeight, cornerRadius), []);
  const rimGeom = useMemo(() => getHairlineRimGeometry(cardWidth, cardHeight, cornerRadius), []);
  const backplateGeom = useMemo(() => getBackplateGeometry(cardWidth + 0.03, cardHeight + 0.03, cornerRadius + 0.01), []);
  const glintTex = useMemo(() => getDiamondGlintTexture(), []);

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
    const targetScale = positionData.scale * (isHovered ? 1.05 : 1.0);
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, 1), delta * 8);
  });

  // 4 个倒角的精确三维坐标
  const cornerX = cardWidth / 2 - cornerRadius * 0.45;
  const cornerY = cardHeight / 2 - cornerRadius * 0.45;
  const cornerZ = -0.028 * Math.pow(cornerX, 2) + 0.008;

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
      {/* 1. 照片本体：参与环境受光，保留原图细节与空间层次 */}
      <mesh geometry={photoGeom} renderOrder={100}>
        <meshBasicMaterial
          ref={photoMaterialRef}
          map={placeholderTex}
          color="#ffffff"
          transparent
          opacity={1}
          depthWrite
          fog={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 3D 角点晶体：实体发光几何提供真实厚度，平面星芒只负责扩散光晕 */}
      {[
        [-cornerX, cornerY, cornerZ],
        [-cornerX, -cornerY, cornerZ],
        [cornerX, cornerY, cornerZ],
        [cornerX, -cornerY, cornerZ],
      ].map(([x, y, z], index) => (
        <mesh key={`corner-crystal-${index}`} position={[x, y, z + 0.02]} renderOrder={110}>
          <octahedronGeometry args={[index < 2 ? 0.045 : 0.025, 1]} />
          <meshStandardMaterial
            color="#ffffff"
            emissive="#dff8ff"
            emissiveIntensity={0.42}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* 2. 概念图同款：“一丝丝”极细冷银白微光倒角边框（Hairline Glass Rim） */}
      <lineLoop geometry={rimGeom}>
        <lineBasicMaterial
          color={isHovered ? '#67e8f9' : '#f1f5f9'}
          transparent
          opacity={isHovered ? 0.9 : 0.48}
          fog={false}
        />
      </lineLoop>

      {/* 3. 概念设计图标志性亮点：【左上角与左下角纯白钻石切角星芒 (Diamond Optical Glints)】 */}
      {/* ① 左上角高光点（最璀璨主受光切面） */}
      <mesh position={[-cornerX, cornerY, cornerZ]} renderOrder={111}>
        <planeGeometry args={[0.34, 0.34]} />
        <meshBasicMaterial
          map={glintTex}
          color="#ffffff"
          transparent
          opacity={isHovered ? 0.66 : 0.32}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* ② 左下角高光点 */}
      <mesh position={[-cornerX, -cornerY, cornerZ]} renderOrder={111}>
        <planeGeometry args={[0.28, 0.28]} />
        <meshBasicMaterial
          map={glintTex}
          color="#ffffff"
          transparent
          opacity={isHovered ? 0.56 : 0.24}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* ③ 右上角极细微光 */}
      <mesh position={[cornerX, cornerY, cornerZ]} renderOrder={111}>
        <planeGeometry args={[0.2, 0.2]} />
        <meshBasicMaterial
          map={glintTex}
          color="#ffffff"
          transparent
          opacity={isHovered ? 0.44 : 0.14}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* 4. 悬浮深邃微晶玻璃背板（增加悬浮立体感） */}
      <mesh geometry={backplateGeom}>
        <meshBasicMaterial
          color="#020408"
          transparent
          opacity={0.9}
          fog={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};
