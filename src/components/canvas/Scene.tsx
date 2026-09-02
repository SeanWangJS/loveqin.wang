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

// 概念图同款：紧凑层叠、优雅如折扇展开的 9 级时空残影流 (Cascading Memory Echoes)
// 距主照片 0.45m ~ 5.85m 范围紧随递进，透明度从 65% 到 17% 细腻衰减，清晰可辨 9 层递退！
const GHOST_LAYERS = [
  { depthOffset: 0.45, lateralOffset: -0.22, verticalOffset: 0.08, scaleFactor: 0.96, opacity: 0.65 },
  { depthOffset: 0.95, lateralOffset: -0.42, verticalOffset: 0.16, scaleFactor: 0.92, opacity: 0.56 },
  { depthOffset: 1.50, lateralOffset: -0.60, verticalOffset: 0.23, scaleFactor: 0.88, opacity: 0.48 },
  { depthOffset: 2.10, lateralOffset: -0.76, verticalOffset: 0.29, scaleFactor: 0.83, opacity: 0.41 },
  { depthOffset: 2.75, lateralOffset: -0.90, verticalOffset: 0.34, scaleFactor: 0.78, opacity: 0.35 },
  { depthOffset: 3.45, lateralOffset: -1.02, verticalOffset: 0.38, scaleFactor: 0.73, opacity: 0.30 },
  { depthOffset: 4.20, lateralOffset: -1.12, verticalOffset: 0.41, scaleFactor: 0.68, opacity: 0.25 },
  { depthOffset: 5.00, lateralOffset: -1.20, verticalOffset: 0.43, scaleFactor: 0.63, opacity: 0.21 },
  { depthOffset: 5.85, lateralOffset: -1.26, verticalOffset: 0.44, scaleFactor: 0.58, opacity: 0.17 },
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
