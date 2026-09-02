import React, { Suspense, useMemo, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { PhotoCard } from './PhotoCard';
import { GhostPhotoCard } from './GhostPhotoCard';
import { GroundReflector } from './GroundReflector';
import { GalleryWalls } from './GalleryWalls';
import { CameraRig } from './CameraRig';
import { StardustParticles } from './StardustParticles';
import { getTimeTemperature } from '../../utils/timeTemperature';

// 概念设计图同款：【多层高低错落的 3D 全息记忆展墙矩阵 (Multi-tier Floating Gallery Matrix)】
// 围绕中央交互主照片，在外层背景墙上以“高/中/低”立体展墙形式悬浮排布伴飞卡片，
// 既保持中央主照片 100% 毫无遮挡、绝佳预览与点击，又完美再现概念图中繁盛璀璨的立体画廊氛围！
const GHOST_LAYERS = [
  // 1. 上方伴生展墙卡片 (Upper-Outer: 高浮空，偏向外墙)
  { depthOffset: 1.2, lateralOffset: 1.25, verticalOffset: 1.45, scaleFactor: 0.52, opacity: 0.72 },
  // 2. 下方伴生展墙卡片 (Lower-Outer: 低浮空，偏向外墙)
  { depthOffset: 1.6, lateralOffset: 1.15, verticalOffset: -1.35, scaleFactor: 0.48, opacity: 0.68 },
  // 3. 中层侧翼延展卡片 (Mid-Outer: 视线高度，紧贴外墙)
  { depthOffset: 2.4, lateralOffset: 1.75, verticalOffset: 0.15, scaleFactor: 0.54, opacity: 0.62 },
  // 4. 上层远景次级星卡 (Upper-Deep: 靠上层天花侧)
  { depthOffset: 3.6, lateralOffset: 1.45, verticalOffset: 1.85, scaleFactor: 0.42, opacity: 0.55 },
  // 5. 下层远景次级星卡 (Lower-Deep: 靠地面侧)
  { depthOffset: 4.0, lateralOffset: 1.35, verticalOffset: -1.55, scaleFactor: 0.38, opacity: 0.50 },
  // 6. 向深处延伸的景深卡片 1
  { depthOffset: 5.2, lateralOffset: 0.90, verticalOffset: 0.45, scaleFactor: 0.42, opacity: 0.42 },
  // 7. 向深处延伸的景深卡片 2
  { depthOffset: 6.6, lateralOffset: 1.60, verticalOffset: 1.15, scaleFactor: 0.35, opacity: 0.35 },
  // 8. 远距深景微缩全息卡片
  { depthOffset: 8.2, lateralOffset: 1.30, verticalOffset: -0.55, scaleFactor: 0.28, opacity: 0.26 },
];

// 动态物理光影系统：克制柔和的深空照明，杜绝顶部强光将地面洗白
const AtmosphericLighting: React.FC = () => {
  const activeYear = useGalleryStore((s) => s.activeYear);

  const ambientRef = useRef<THREE.AmbientLight>(null);
  const dirLightRef = useRef<THREE.DirectionalLight>(null);

  const targetTheme = useMemo(() => getTimeTemperature(activeYear), [activeYear]);

  useFrame((state, delta) => {
    if (state.scene.fog && 'color' in state.scene.fog) {
      (state.scene.fog as THREE.Fog).color.lerp(targetTheme.fogColor, delta * 2.5);
    }
    if (state.scene.background && 'isColor' in state.scene.background) {
      (state.scene.background as THREE.Color).lerp(targetTheme.fogColor, delta * 2.5);
    }

    if (ambientRef.current) {
      ambientRef.current.color.lerp(targetTheme.ambientColor, delta * 2.5);
    }
    if (dirLightRef.current) {
      dirLightRef.current.color.lerp(targetTheme.directionalLightColor, delta * 2.5);
    }
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.35} />
      <directionalLight
        ref={dirLightRef}
        position={[6, 8, 12]}
        intensity={0.4}
        color="#e0f2fe"
      />
    </>
  );
};

export const Scene: React.FC = () => {
  const photos = useGalleryStore((s) => s.photos);
  const positions = useGalleryStore((s) => s.positions);
  const cameraZ = useGalleryStore((s) => s.cameraZ);
  const qualityTier = useGalleryStore((s) => s.qualityTier);

  // WebGL 崩溃恢复监听
  useEffect(() => {
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      console.warn('⚠️ WebGL 上下文丢失，正在尝试重置恢复...');
    };
    const handleContextRestored = () => {
      console.info('✓ WebGL 上下文已成功恢复！');
    };

    window.addEventListener('webglcontextlost', handleContextLost, false);
    window.addEventListener('webglcontextrestored', handleContextRestored, false);

    return () => {
      window.removeEventListener('webglcontextlost', handleContextLost);
      window.removeEventListener('webglcontextrestored', handleContextRestored);
    };
  }, []);

  // 控制视口内 Card 数量（相机后方 15 单位，前方 110 单位）
  const visiblePhotos = useMemo(() => {
    return photos.filter((photo) => {
      const pos = positions.get(photo.id);
      if (!pos) return false;
      const zDiff = cameraZ - pos.z;
      return zDiff >= -15 && zDiff <= 110;
    });
  }, [photos, positions, cameraZ]);

  return (
    <div className="w-full h-full absolute inset-0 bg-[#040810]">
      <Canvas
      camera={{ position: [0, 0.9, 6.5], fov: 62, near: 0.1, far: 260 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
      >
        <color attach="background" args={['#040810']} />
        {/* 雾气推远至 75 之外，保证近中景巨幅照片 100% 极度通透清澈 */}
        <fog attach="fog" args={['#040810', 75, 220]} />

        {/* 动态物理光影系统 */}
        <AtmosphericLighting />

        <Suspense fallback={null}>
          {/* 相机运镜与阻尼控制器 */}
          <CameraRig />

          {/* 奢华高精镜面反射地面与中央微光能量光轨 */}
          <GroundReflector />

          {/* 画廊建筑边界与墙面水平光线 */}
          <GalleryWalls />

          {/* 3D 浮游微光粒子 */}
          <StardustParticles count={qualityTier === 'low' ? 60 : 160} />

          {/* 3D 悬浮巨幅照片矩阵 */}
          <group>
            {visiblePhotos.flatMap((photo) => {
              const pos = positions.get(photo.id);
              if (!pos) return [];
              return GHOST_LAYERS.map((layer, layerIndex) => (
                <GhostPhotoCard
                  key={`ghost-${photo.id}-${layerIndex}`}
                  photo={photo}
                  positionData={pos}
                  layerIndex={layerIndex}
                  depthOffset={layer.depthOffset}
                  lateralOffset={layer.lateralOffset}
                  verticalOffset={layer.verticalOffset}
                  scaleFactor={layer.scaleFactor}
                  opacity={layer.opacity}
                />
              ));
            })}

            {visiblePhotos.map((photo) => {
              const pos = positions.get(photo.id);
              if (!pos) return null;
              return (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  positionData={pos}
                />
              );
            })}
          </group>

          {/* 电影级后期特效合成管线 */}
          {qualityTier !== 'low' && (
            <EffectComposer multisampling={0}>
              <Bloom
                intensity={qualityTier === 'high' ? 0.42 : 0.28}
                luminanceThreshold={0.55}
                luminanceSmoothing={0.86}
                radius={0.82}
                mipmapBlur
              />
              <Vignette eskil={false} offset={0.24} darkness={0.62} />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
};
