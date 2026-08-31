import React, { Suspense, useMemo, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { PhotoCard } from './PhotoCard';
import { GroundReflector } from './GroundReflector';
import { CameraRig } from './CameraRig';
import { StardustParticles } from './StardustParticles';
import { getTimeTemperature } from '../../utils/timeTemperature';

// 动态岁月色温光影控制器
const AtmosphericLighting: React.FC = () => {
  const activeYear = useGalleryStore((s) => s.activeYear);
  const cameraZ = useGalleryStore((s) => s.cameraZ);

  const ambientRef = useRef<THREE.AmbientLight>(null);
  const dirLightRef = useRef<THREE.DirectionalLight>(null);
  const pointLightRef = useRef<THREE.PointLight>(null);

  const targetTheme = useMemo(() => getTimeTemperature(activeYear), [activeYear]);

  useFrame((state, delta) => {
    // 雾效平滑过渡（仅影响远端深空背景，不污染前方照片）
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
      dirLightRef.current.position.set(0, 12, cameraZ + 8);
    }
    if (pointLightRef.current) {
      pointLightRef.current.color.lerp(targetTheme.pointLightColor, delta * 2.5);
      pointLightRef.current.position.set(0, -0.5, cameraZ - 4);
    }
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.6} />
      <directionalLight
        ref={dirLightRef}
        position={[0, 12, cameraZ + 8]}
        intensity={1.0}
        color="#e0f2fe"
      />
      <pointLight
        ref={pointLightRef}
        position={[0, -0.5, cameraZ - 4]}
        intensity={2.2}
        distance={35}
        color="#38bdf8"
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

  // 控制视口内 Card 数量（相机后方 15 单位，前方 105 单位）
  const visiblePhotos = useMemo(() => {
    return photos.filter((photo) => {
      const pos = positions.get(photo.id);
      if (!pos) return false;
      const zDiff = cameraZ - pos.z;
      return zDiff >= -15 && zDiff <= 105;
    });
  }, [photos, positions, cameraZ]);

  return (
    <div className="w-full h-full absolute inset-0 bg-[#040608]">
      <Canvas
        camera={{ position: [0, 0.4, 12], fov: 52, near: 0.1, far: 260 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
      >
        <color attach="background" args={['#040608']} />
        {/* 将雾气起点推远至 75 单位之外，保证前方与中景照片 100% 极度清澈透亮 */}
        <fog attach="fog" args={['#040608', 75, 220]} />

        {/* 动态岁月色温与光影系统 */}
        <AtmosphericLighting />

        <Suspense fallback={null}>
          {/* 相机运镜与阻尼控制器 */}
          <CameraRig />

          {/* 镜面反射地面与中央光轨 (滑动局部视窗) */}
          <GroundReflector />

          {/* 3D 浮游微光粒子 */}
          <StardustParticles count={qualityTier === 'low' ? 80 : 200} />

          {/* 3D 悬浮照片矩阵 */}
          <group>
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

          {/* 电影级后期特效合成管线（高阈值 Bloom，仅高亮发光线，绝不泛白照片） */}
          {qualityTier !== 'low' && (
            <EffectComposer multisampling={0}>
              <Bloom
                intensity={qualityTier === 'high' ? 0.75 : 0.5}
                luminanceThreshold={0.82}
                luminanceSmoothing={0.5}
                mipmapBlur
              />
              <Vignette eskil={false} offset={0.22} darkness={0.75} />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
};
