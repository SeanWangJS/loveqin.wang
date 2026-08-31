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

// 缓存 3D 物理网格几何体
let cachedPhotoGeom: THREE.BufferGeometry | null = null;
let cachedBezelMeshGeom: THREE.BufferGeometry | null = null;
let cachedBackplateGeom: THREE.BufferGeometry | null = null;

// 照片表面 3D 微弧网格 (Z = -0.035 * X^2)
function getRoundedCurvedGeometry(width = 3.6, height = 2.5, radius = 0.20): THREE.BufferGeometry {
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

// 3D 实体倒角微弧玻璃外框几何体（物理 Mesh，有厚度与切角斜面）
function getBezelMeshGeometry(width = 3.6, height = 2.5, radius = 0.20, thickness = 0.042): THREE.BufferGeometry {
  if (cachedBezelMeshGeom) return cachedBezelMeshGeom;

  const outerShape = new THREE.Shape();
  const innerShape = new THREE.Path();

  const ox = -width / 2 - 0.005;
  const oy = -height / 2 - 0.005;
  const ow = width + 0.01;
  const oh = height + 0.01;
  const or = radius + 0.005;

  outerShape.moveTo(ox + or, oy);
  outerShape.lineTo(ox + ow - or, oy);
  outerShape.quadraticCurveTo(ox + ow, oy, ox + ow, oy + or);
  outerShape.lineTo(ox + ow, oy + oh - or);
  outerShape.quadraticCurveTo(ox + ow, oy + oh, ox + ow - or, oy + oh);
  outerShape.lineTo(ox + or, oy + oh);
  outerShape.quadraticCurveTo(ox, oy + oh, ox, oy + oh - or);
  outerShape.lineTo(ox, oy + or);
  outerShape.quadraticCurveTo(ox, oy, ox + or, oy);

  const ix = ox + thickness;
  const iy = oy + thickness;
  const iw = ow - thickness * 2;
  const ih = oh - thickness * 2;
  const ir = Math.max(0.01, or - thickness);

  innerShape.moveTo(ix + ir, iy);
  innerShape.lineTo(ix + iw - ir, iy);
  innerShape.quadraticCurveTo(ix + iw, iy, ix + iw, iy + ir);
  innerShape.lineTo(ix + iw, iy + ih - ir);
  innerShape.quadraticCurveTo(ix + iw, iy + ih, ix + iw - ir, iy + ih);
  innerShape.lineTo(ix + ir, iy + ih);
  innerShape.quadraticCurveTo(ix, iy + ih, ix, iy + ih - ir);
  innerShape.lineTo(ix, iy + ir);
  innerShape.quadraticCurveTo(ix, iy, ix + ir, iy);

  outerShape.holes.push(innerShape);

  const geom = new THREE.ShapeGeometry(outerShape, 24);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    // 倒角前凸 0.006 单位，接收物理光照高光
    pos.setZ(i, -0.035 * Math.pow(px, 2) + 0.006);
  }
  geom.computeVertexNormals();

  cachedBezelMeshGeom = geom;
  return geom;
}

// 悬浮深邃微晶玻璃背板几何体
function getBackplateGeometry(width = 3.66, height = 2.56, radius = 0.22): THREE.BufferGeometry {
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
    pos.setZ(i, -0.035 * Math.pow(px, 2) - 0.012);
  }
  geom.computeVertexNormals();

  cachedBackplateGeom = geom;
  return geom;
}

export const PhotoCard: React.FC<PhotoCardProps> = ({ photo, positionData }) => {
  const meshRef = useRef<THREE.Group>(null);
  const photoMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const bezelMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [isHovered, setIsHovered] = useState(false);

  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);

  const photoYear = new Date(photo.takenAtSort).getFullYear();
  const theme = useMemo(() => getTimeTemperature(photoYear), [photoYear]);

  const photoGeom = useMemo(() => getRoundedCurvedGeometry(3.6, 2.5, 0.20), []);
  const bezelGeom = useMemo(() => getBezelMeshGeometry(3.6, 2.5, 0.20, 0.042), []);
  const backplateGeom = useMemo(() => getBackplateGeometry(3.66, 2.56, 0.22), []);

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
    const targetScale = isHovered ? 1.05 : 1.0;
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, 1), delta * 8);

    if (bezelMaterialRef.current) {
      const targetEmissiveIntensity = isHovered ? 3.6 : 2.6;
      bezelMaterialRef.current.emissiveIntensity = THREE.MathUtils.damp(
        bezelMaterialRef.current.emissiveIntensity,
        targetEmissiveIntensity,
        6.0,
        delta
      );
    }
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
      {/* 1. 照片本体：标准 PBR 材质（MeshStandardMaterial） */}
      {/* 极低粗糙度、零自发光，确保暗部纯黑扎实，高光晶莹透亮，完全不受雾气灰白污染 */}
      <mesh geometry={photoGeom}>
        <meshStandardMaterial
          ref={photoMaterialRef}
          map={placeholderTex}
          roughness={0.12}
          metalness={0.05}
          emissive={new THREE.Color('#000000')}
          emissiveIntensity={0}
        />
      </mesh>

      {/* 2. 3D 倒角玻璃外框：高光泽 PBR 材质 + HDR Emissive */}
      {/* 在定向光照射下产生真实的物理镜面折射（Specular），并在 Bloom 作用下呈现出天然白热星芒 */}
      <mesh geometry={bezelGeom}>
        <meshStandardMaterial
          ref={bezelMaterialRef}
          color="#ffffff"
          roughness={0.06}
          metalness={0.92}
          emissive={theme.rimColor}
          emissiveIntensity={2.6}
          toneMapped={false}
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* 3. 深邃微晶玻璃背板 */}
      <mesh geometry={backplateGeom}>
        <meshStandardMaterial
          color="#030508"
          roughness={0.25}
          metalness={0.75}
          transparent
          opacity={0.88}
        />
      </mesh>
    </group>
  );
};
