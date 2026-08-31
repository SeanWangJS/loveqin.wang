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

// 缓存圆角微弧几何体与 4 个圆角光学高光网格
let cachedCardGeom: THREE.BufferGeometry | null = null;
let cachedSubtleBorderGeom: THREE.BufferGeometry | null = null;
let cachedCornerArcGeom: THREE.BufferGeometry | null = null;

// 照片主体微弧圆角网格 (Z = -0.035 * X^2)
function getRoundedCurvedGeometry(width = 3.6, height = 2.5, radius = 0.22): THREE.BufferGeometry {
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

  cachedCardGeom = geom;
  return geom;
}

// 极细微弱的全周暗色玻璃边缘基底线
function getSubtleBorderGeometry(width = 3.6, height = 2.5, radius = 0.22): THREE.BufferGeometry {
  if (cachedSubtleBorderGeom) return cachedSubtleBorderGeom;

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
  const points3d = points2d.map((p) => new THREE.Vector3(p.x, p.y, -0.035 * Math.pow(p.x, 2) + 0.003));

  const geom = new THREE.BufferGeometry().setFromPoints(points3d);
  cachedSubtleBorderGeom = geom;
  return geom;
}

// 单个圆角发光弧线几何体（仅在 90 度圆弧处发光）
function getCornerArcGeometry(radius = 0.22, thickness = 0.03): THREE.BufferGeometry {
  if (cachedCornerArcGeom) return cachedCornerArcGeom;
  // 90度圆弧带 (0 到 PI/2)
  const geom = new THREE.RingGeometry(radius - thickness * 0.4, radius + thickness * 0.6, 16, 1, 0, Math.PI / 2);
  cachedCornerArcGeom = geom;
  return geom;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({ photo, positionData }) => {
  const meshRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);

  const photoYear = new Date(photo.takenAtSort).getFullYear();
  const theme = useMemo(() => getTimeTemperature(photoYear), [photoYear]);

  const cardWidth = 3.6;
  const cardHeight = 2.5;
  const cornerRadius = 0.22;

  const cardGeom = useMemo(() => getRoundedCurvedGeometry(cardWidth, cardHeight, cornerRadius), []);
  const subtleBorderGeom = useMemo(() => getSubtleBorderGeometry(cardWidth, cardHeight, cornerRadius), []);
  const cornerArcGeom = useMemo(() => getCornerArcGeometry(cornerRadius, 0.025), [cornerRadius]);

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

  // 悬停动画插值
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    const targetScale = isHovered ? 1.05 : 1.0;
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, 1), delta * 8);
  });

  // 四个圆角的中心相对坐标
  const cornerOffsetX = cardWidth / 2 - cornerRadius;
  const cornerOffsetY = cardHeight / 2 - cornerRadius;

  // 根据微弧曲率计算 Z 偏移
  const cornerZOffset = -0.035 * Math.pow(cornerOffsetX, 2) + 0.005;

  const cornerGlintColor = isHovered ? '#67e8f9' : theme.rimColor;

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
      {/* 1. 高清透亮微弧照片本体（纯净通透，无泛白污染） */}
      <mesh geometry={cardGeom}>
        <meshBasicMaterial
          ref={materialRef}
          map={placeholderTex}
          toneMapped={false}
        />
      </mesh>

      {/* 2. 极细微弱的全周暗色玻璃边缘线（低调深灰青色） */}
      <lineLoop geometry={subtleBorderGeom}>
        <lineBasicMaterial
          color="#334155"
          transparent
          opacity={0.35}
        />
      </lineLoop>

      {/* 3. 参考图同款：【仅在 4 个圆角处】呈现优雅空灵的光学倒角高光 (Corner-Only Glints) */}
      {/* ① 左上角高光（主受光弧） */}
      <mesh
        geometry={cornerArcGeom}
        position={[-cornerOffsetX, cornerOffsetY, cornerZOffset]}
        rotation={[0, 0, Math.PI / 2]}
      >
        <meshBasicMaterial
          color={cornerGlintColor}
          transparent
          opacity={isHovered ? 0.95 : 0.7}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* ② 右上角高光 */}
      <mesh
        geometry={cornerArcGeom}
        position={[cornerOffsetX, cornerOffsetY, cornerZOffset]}
        rotation={[0, 0, 0]}
      >
        <meshBasicMaterial
          color={cornerGlintColor}
          transparent
          opacity={isHovered ? 0.8 : 0.45}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* ③ 左下角高光 */}
      <mesh
        geometry={cornerArcGeom}
        position={[-cornerOffsetX, -cornerOffsetY, cornerZOffset]}
        rotation={[0, 0, Math.PI]}
      >
        <meshBasicMaterial
          color={cornerGlintColor}
          transparent
          opacity={isHovered ? 0.85 : 0.55}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* ④ 右下角高光 */}
      <mesh
        geometry={cornerArcGeom}
        position={[cornerOffsetX, -cornerOffsetY, cornerZOffset]}
        rotation={[0, 0, -Math.PI / 2]}
      >
        <meshBasicMaterial
          color={cornerGlintColor}
          transparent
          opacity={isHovered ? 0.65 : 0.35}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* 4. 微光黑色玻璃背衬底 */}
      <mesh geometry={cardGeom} position={[0, 0, -0.015]}>
        <meshBasicMaterial color="#020408" transparent opacity={0.85} />
      </mesh>
    </group>
  );
};
