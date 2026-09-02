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

// 概念设计图同款：【随纵深呈喇叭状向上下发散、透明度梯度细腻衰减的 3D 全息记忆展墙矩阵】
// 近处伴生卡透明度适中柔和（46%~40%），随着纵深深入逐级淡出至深空的 9%~6%，烘托出极具深度的呼吸氛围感！
const GHOST_LAYERS = [
  // 1. 近景上层伴生卡 (近距收敛: Y = +1.10)
  { depthOffset: 1.0, lateralOffset: 1.15, verticalOffset: 1.10, scaleFactor: 0.55, opacity: 0.46 },
  // 2. 近景下层伴生卡 (近距收敛: Y = -1.05)
  { depthOffset: 1.4, lateralOffset: 1.05, verticalOffset: -1.05, scaleFactor: 0.52, opacity: 0.40 },
  // 3. 中景上层扩散卡 (中距发散: Y = +1.85)
  { depthOffset: 2.2, lateralOffset: 1.55, verticalOffset: 1.85, scaleFactor: 0.48, opacity: 0.34 },
  // 4. 中景下层扩散卡 (中距发散: Y = -1.50)
  { depthOffset: 2.8, lateralOffset: 1.40, verticalOffset: -1.50, scaleFactor: 0.45, opacity: 0.28 },
  // 5. 中景中层侧翼卡 (紧贴外墙视线区: Y = +0.25)
  { depthOffset: 3.5, lateralOffset: 1.95, verticalOffset: 0.25, scaleFactor: 0.50, opacity: 0.24 },
  // 6. 远景高空伴飞星卡 (远距强扩散: Y = +2.55，仰望天花激光线)
  { depthOffset: 4.6, lateralOffset: 1.65, verticalOffset: 2.55, scaleFactor: 0.40, opacity: 0.18 },
  // 7. 远景低空镜面星卡 (远距强扩散: Y = -1.75，俯临黑镜地面)
  { depthOffset: 5.5, lateralOffset: 1.55, verticalOffset: -1.75, scaleFactor: 0.36, opacity: 0.14 },
  // 8. 深空极高阶天际卡 (深邃极限扩散: Y = +3.05)
  { depthOffset: 6.8, lateralOffset: 1.85, verticalOffset: 3.05, scaleFactor: 0.32, opacity: 0.09 },
  // 9. 深空深底地脉卡 (深邃极限扩散: Y = -1.90)
  { depthOffset: 8.2, lateralOffset: 1.70, verticalOffset: -1.90, scaleFactor: 0.28, opacity: 0.06 },
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
      camera={{ position: [0, 0.85, 6.5], fov: 70, near: 0.1, far: 260 }}
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
