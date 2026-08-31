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

// 缓存微弧几何体与一体化悬浮玻璃画框贴图
let cachedPhotoGeom: THREE.BufferGeometry | null = null;
let cachedGlassFrameGeom: THREE.BufferGeometry | null = null;
let cachedGlassChassisTex: THREE.CanvasTexture | null = null;

/**
 * 高精度生成概念图同款：【一体化烟熏微晶玻璃底板 + 倒角连续银亮光轨 + 4角有机切角镜面高光 (Unified Glass Chassis)】
 * 彻底消除分离式贴片的粗糙感，呈现完全融为一体的艺术品级微弧玻璃面板
 */
function getUnifiedGlassChassisTexture(): THREE.CanvasTexture {
  if (cachedGlassChassisTex) return cachedGlassChassisTex;

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 720;
  const ctx = canvas.getContext('2d')!;

  const w = 1024;
  const h = 720;
  const pad = 24;
  const r = 56;

  // 1. 绘制带有柔和外阴影的微晶玻璃外框 (Glass Slab Base)
  const drawRoundedRect = (x: number, y: number, width: number, height: number, radius: number) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  };

  // 外层深邃烟熏玻璃质感
  drawRoundedRect(pad, pad, w - pad * 2, h - pad * 2, r);
  const glassGrad = ctx.createLinearGradient(pad, pad, w - pad, h - pad);
  glassGrad.addColorStop(0, 'rgba(15, 23, 42, 0.95)');
  glassGrad.addColorStop(0.5, 'rgba(6, 10, 18, 0.98)');
  glassGrad.addColorStop(1, 'rgba(2, 6, 12, 0.96)');
  ctx.fillStyle = glassGrad;
  ctx.fill();

  // 2. 绘制连续通透的倒角玻璃边缘光线 (Fresnel Glass Rim)
  ctx.lineWidth = 3.5;
  const rimGrad = ctx.createLinearGradient(pad, pad, w - pad, h - pad);
  rimGrad.addColorStop(0, 'rgba(255, 255, 255, 0.85)'); // 左上主采光面
  rimGrad.addColorStop(0.35, 'rgba(224, 242, 254, 0.6)');
  rimGrad.addColorStop(0.7, 'rgba(148, 163, 184, 0.3)');
  rimGrad.addColorStop(1, 'rgba(56, 189, 248, 0.25)'); // 右下
  ctx.strokeStyle = rimGrad;
  ctx.stroke();

  // 3. 绘制完全与倒角弧线融为一体的【4 角有机镜面高光 (Integrated Corner Specular Glints)】
  // ① 左上角高光（主受光面：白热核心沿切角微弧自然扩散）
  const drawCornerGlint = (cx: number, cy: number, intensity: number, radius: number) => {
    // 径向白热微晕
    const radGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    radGlow.addColorStop(0, `rgba(255, 255, 255, ${0.95 * intensity})`);
    radGlow.addColorStop(0.2, `rgba(240, 249, 255, ${0.75 * intensity})`);
    radGlow.addColorStop(0.5, `rgba(224, 242, 254, ${0.35 * intensity})`);
    radGlow.addColorStop(0.8, `rgba(56, 189, 248, ${0.12 * intensity})`);
    radGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // 沿倒角切线方向的柔和微光拉丝
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    const streakGrad = ctx.createLinearGradient(-radius * 0.9, 0, radius * 0.9, 0);
    streakGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    streakGrad.addColorStop(0.5, `rgba(255, 255, 255, ${0.85 * intensity})`);
    streakGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = streakGrad;
    ctx.fillRect(-radius * 0.9, -1.5, radius * 1.8, 3);
    ctx.restore();
  };

  // 4 个切角精准坐标
  const cornerOffset = pad + r * 0.7;
  drawCornerGlint(cornerOffset, cornerOffset, 1.0, 75); // 左上角（主高光）
  drawCornerGlint(cornerOffset, h - cornerOffset, 0.85, 65); // 左下角
  drawCornerGlint(w - cornerOffset, cornerOffset, 0.6, 50); // 右上角
  drawCornerGlint(w - cornerOffset, h - cornerOffset, 0.45, 45); // 右下角

  cachedGlassChassisTex = new THREE.CanvasTexture(canvas);
  cachedGlassChassisTex.colorSpace = THREE.SRGBColorSpace;
  return cachedGlassChassisTex;
}

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

// 外部微弧玻璃画框几何体 (微大一圈，形成 0.08 单位的通透玻璃边沿)
function getGlassFrameGeometry(width = 3.76, height = 2.66, radius = 0.22): THREE.BufferGeometry {
  if (cachedGlassFrameGeom) return cachedGlassFrameGeom;

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
    pos.setZ(i, -0.035 * Math.pow(px, 2) - 0.005);
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.computeVertexNormals();

  cachedGlassFrameGeom = geom;
  return geom;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({ photo, positionData }) => {
  const meshRef = useRef<THREE.Group>(null);
  const photoMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);

  const photoGeom = useMemo(() => getRoundedCurvedGeometry(3.6, 2.5, 0.18), []);
  const glassFrameGeom = useMemo(() => getGlassFrameGeometry(3.76, 2.66, 0.22), []);
  const glassChassisTex = useMemo(() => getUnifiedGlassChassisTexture(), []);

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
      {/* 1. 一体化微晶玻璃底板（包含连续银亮倒角边缘 + 4角有机切角镜面高光，100% 融为一体） */}
      <mesh geometry={glassFrameGeom}>
        <meshBasicMaterial
          map={glassChassisTex}
          transparent
          opacity={isHovered ? 1.0 : 0.92}
          toneMapped={false}
        />
      </mesh>

      {/* 2. 嵌于玻璃板内部的高清透亮微弧照片本体 */}
      <mesh geometry={photoGeom} position={[0, 0, 0.002]}>
        <meshBasicMaterial
          ref={photoMaterialRef}
          map={placeholderTex}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};
