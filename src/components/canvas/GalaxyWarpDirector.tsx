import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { GalaxyInteraction, SpiralGalaxy } from './SpiralGalaxy';
import { startGalaxyPreload } from '../../utils/galaxyPreloader';

interface GalaxyWarpDirectorProps {
  onWarpComplete: () => void;
}

export const GalaxyWarpDirector: React.FC<GalaxyWarpDirectorProps> = ({ onWarpComplete }) => {
  const { camera } = useThree();
  const isInitialLoading = useGalleryStore((s) => s.isInitialLoading);
  const isPhotosLoaded = useGalleryStore((s) => s.isPhotosLoaded);
  const isCorridorReady = useGalleryStore((s) => s.isCorridorReady);
  const loadingProgress = useGalleryStore((s) => s.loadingProgress);
  const isWarping = useGalleryStore((s) => s.isWarping);
  const isWarpRequested = useGalleryStore((s) => s.isWarpRequested);

  const [warpFactor, setWarpFactor] = useState(0.0);
  const [isGalaxyVisible, setIsGalaxyVisible] = useState(() => isInitialLoading && !isCorridorReady);

  const mousePos = useRef({ x: 0, y: 0 });
  const galaxyInteraction = useRef<GalaxyInteraction>({
    x: 0,
    y: 0,
    velocityX: 0,
    velocityY: 0,
    active: 0,
  });
  const hasTriggeredWarp = useRef(false);

  // 1. 初始化相机在银河正上方俯视位与并行启动首屏资产预载（仅在首屏加载且长廊未就绪时执行）
  useEffect(() => {
    if (!isInitialLoading || isCorridorReady || !isPhotosLoaded) return;

    camera.position.set(0, 0, 17.5);
    camera.rotation.set(0, 0, 0);
    if ('fov' in camera) {
      (camera as THREE.PerspectiveCamera).fov = 70;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }

    // 启动资产并行预热
    startGalaxyPreload();

    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mousePos.current.y = -(e.clientY / window.innerHeight - 0.5) * 2;
      galaxyInteraction.current.active = 1;
    };

    const handleMouseLeave = () => {
      galaxyInteraction.current.active = 0;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [camera, isInitialLoading, isPhotosLoaded, isCorridorReady]);

  // 2. 初始加载中的微动视差插值（平滑跟手机/鼠标微倾）
  useFrame((_, delta) => {
    if (!isInitialLoading || isCorridorReady || isWarping) return;

    const targetX = mousePos.current.x * 0.75;
    const targetY = mousePos.current.y * 0.75;

    const interaction = galaxyInteraction.current;
    const targetGalaxyX = mousePos.current.x * 8.2;
    const targetGalaxyY = mousePos.current.y * 6.4;
    const previousX = interaction.x;
    const previousY = interaction.y;
    interaction.x = THREE.MathUtils.damp(interaction.x, targetGalaxyX, 4.5, delta);
    interaction.y = THREE.MathUtils.damp(interaction.y, targetGalaxyY, 4.5, delta);
    interaction.velocityX = THREE.MathUtils.damp(
      interaction.velocityX,
      (interaction.x - previousX) / Math.max(delta, 0.001),
      7.0,
      delta,
    );
    interaction.velocityY = THREE.MathUtils.damp(
      interaction.velocityY,
      (interaction.y - previousY) / Math.max(delta, 0.001),
      7.0,
      delta,
    );
    interaction.active = THREE.MathUtils.damp(interaction.active, 0, 3.5, delta);

    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 2.5, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 2.5, delta);
    camera.lookAt(0, 0, 0);
  });

  // 3. 监听进度达到 100% 且用户点击屏幕任意地方后，触发电影级曲速俯冲推进
  useEffect(() => {
    if (isWarpRequested && loadingProgress >= 100 && !hasTriggeredWarp.current && isInitialLoading) {
      hasTriggeredWarp.current = true;
      useGalleryStore.getState().setIsWarping(true);
      useGalleryStore.getState().setWarpProgress(0);
      // 先挂载透明的画廊层，让它在银河仍然可见时完成首帧准备。
      useGalleryStore.getState().setIsCorridorReady(true);

      const persCamera = camera as THREE.PerspectiveCamera;
      const initialCamX = camera.position.x;
      const initialCamY = camera.position.y;

      const transitionObj = {
        camZ: 17.5,
        camX: initialCamX,
        camY: initialCamY,
        progress: 0,
      };
      const landingZ = useGalleryStore.getState().targetZ;
      const tl = gsap.timeline({
        onComplete: () => {
          setIsGalaxyVisible(false);
          useGalleryStore.getState().setIsWarping(false);
          useGalleryStore.getState().setIsWarpRequested(false);
          useGalleryStore.getState().setIsInitialLoading(false);
          useGalleryStore.getState().setWarpProgress(1);
          useGalleryStore.getState().setWarpFlash(0);
          onWarpComplete();
        },
      });

      // 单一连续曲线：避免阶段交界时速度归零，再次启动造成犹豫感。
      tl.to(transitionObj, {
        progress: 1,
        duration: 3.5,
        ease: 'sine.inOut',
        onUpdate: () => {
          const progress = transitionObj.progress;
          const smoothProgress = progress * progress * (3 - 2 * progress);
          const flashProgress = THREE.MathUtils.clamp((progress - 0.26) / 0.74, 0, 1);

          transitionObj.camZ = THREE.MathUtils.lerp(17.5, landingZ, smoothProgress);
          transitionObj.camX = THREE.MathUtils.lerp(initialCamX, 0, smoothProgress);
          transitionObj.camY = THREE.MathUtils.lerp(initialCamY, 0, smoothProgress);
          transitionObj.camZ += Math.sin(progress * Math.PI) * 0.16;

          camera.position.z = transitionObj.camZ;
          camera.position.x = transitionObj.camX;
          camera.position.y = transitionObj.camY;
          camera.lookAt(0, 0, 0);

          if ('fov' in camera) {
            persCamera.fov = 70 + Math.sin(progress * Math.PI) * 2.6;
            persCamera.updateProjectionMatrix();
          }

          useGalleryStore.getState().setWarpProgress(smoothProgress);
          setWarpFactor(0.045 * smoothProgress);
          useGalleryStore.getState().setWarpFlash(
            0.07 * Math.sin(Math.PI * flashProgress),
          );
        }
      });
    }
  }, [isWarpRequested, loadingProgress, isInitialLoading, camera, onWarpComplete]);

  if (!isInitialLoading || !isGalaxyVisible) return null;

  return (
    <SpiralGalaxy
      opacity={1}
      warpFactor={warpFactor}
      interactionRef={galaxyInteraction}
    />
  );
};
