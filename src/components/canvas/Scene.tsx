import React, { Suspense, useMemo, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { PhotoCard } from './PhotoCard';
import { GroundReflector } from './GroundReflector';
import { CameraRig } from './CameraRig';
import { StardustParticles } from './StardustParticles';
import { TimePortalGate } from './TimePortalGate';

export const Scene: React.FC = () => {
  const photos = useGalleryStore((s) => s.photos);
  const positions = useGalleryStore((s) => s.positions);
  const yearPortals = useGalleryStore((s) => s.yearPortals);
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

  // 严格控制视口内 Card 数量（相机后方 10 单位，前方 85 单位），保证极速滑动帧率平稳
  const visiblePhotos = useMemo(() => {
    return photos.filter((photo) => {
      const pos = positions.get(photo.id);
      if (!pos) return false;
      const zDiff = cameraZ - pos.z;
      return zDiff >= -10 && zDiff <= 85;
    });
  }, [photos, positions, cameraZ]);

  return (
    <div className="w-full h-full absolute inset-0 bg-[#06080b]">
      <Canvas
        camera={{ position: [0, 0.5, 12], fov: 50, near: 0.1, far: 200 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: false,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
      >
        <color attach="background" args={['#06080b']} />
        <fog attach="fog" args={['#06080b', 45, 140]} />

        {/* 动态随相机跟随的全局光影系统 */}
        <ambientLight intensity={0.75} />
        <directionalLight
          position={[0, 10, cameraZ + 6]}
          intensity={0.9}
          color="#e0f2fe"
        />
        <pointLight
          position={[0, -0.5, cameraZ - 4]}
          intensity={2.0}
          distance={25}
          color="#38bdf8"
        />

        <Suspense fallback={null}>
          {/* 相机运镜与阻尼控制器 */}
          <CameraRig />

          {/* 镜面反射地面与中央光轨 (滑动局部视窗) */}
          <GroundReflector />

          {/* 3D 浮游微光粒子 */}
          <StardustParticles count={qualityTier === 'low' ? 100 : 250} />

          {/* 年份交界发光时光之门 (Time Portal Gates) */}
          <group>
            {yearPortals.map((portal) => (
              <TimePortalGate
                key={portal.year}
                portal={portal}
                cameraZ={cameraZ}
              />
            ))}
          </group>

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

          {/* 电影级后期特效合成管线 */}
          {qualityTier !== 'low' && (
            <EffectComposer multisampling={0}>
              <Bloom
                intensity={qualityTier === 'high' ? 0.95 : 0.6}
                luminanceThreshold={0.25}
                luminanceSmoothing={0.8}
                mipmapBlur
              />
              <Vignette eskil={false} offset={0.18} darkness={0.82} />
            </EffectComposer>
          )}
        </Suspense>
      </Canvas>
    </div>
  );
};
