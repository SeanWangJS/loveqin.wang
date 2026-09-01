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

const GHOST_LAYERS = [
  { depthOffset: 8, lateralOffset: -0.75, verticalOffset: -0.65, scaleFactor: 0.68 },
  { depthOffset: 16, lateralOffset: -1.05, verticalOffset: 0, scaleFactor: 0.6 },
  { depthOffset: 24, lateralOffset: -1.35, verticalOffset: 0.65, scaleFactor: 0.52 },
  { depthOffset: 34, lateralOffset: -1.4, verticalOffset: -1.5, scaleFactor: 0.5 },
  { depthOffset: 46, lateralOffset: -1.5, verticalOffset: -0.9, scaleFactor: 0.45 },
  { depthOffset: 58, lateralOffset: -1.6, verticalOffset: -0.3, scaleFactor: 0.4 },
  { depthOffset: 70, lateralOffset: -1.7, verticalOffset: 0.4, scaleFactor: 0.35 },
  { depthOffset: 82, lateralOffset: -1.8, verticalOffset: 1.1, scaleFactor: 0.3 },
  { depthOffset: 94, lateralOffset: -1.9, verticalOffset: 1.8, scaleFactor: 0.25 },
];

// 动态物理光影系统
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
      <ambientLight ref={ambientRef} intensity={0.6} />
      <hemisphereLight args={['#8dc8df', '#332a24', 0.22]} />
      <directionalLight
        ref={dirLightRef}
        position={[0, 12, 14]}
        intensity={1.0}
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
    <div className="w-full h-full absolute inset-0 bg-[#040608]">
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
        <color attach="background" args={['#040608']} />
        {/* 雾气推远至 75 之外，保证近中景巨幅照片 100% 极度通透清澈 */}
        <fog attach="fog" args={['#040608', 75, 220]} />

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

          {/* 电影级后期特效合成管线（高阈值 Bloom，杜绝光污染，照片锐利保真） */}
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
