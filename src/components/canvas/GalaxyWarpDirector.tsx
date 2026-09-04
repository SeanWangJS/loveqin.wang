import React, { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { SpiralGalaxy } from './SpiralGalaxy';
import { startGalaxyPreload } from '../../utils/galaxyPreloader';

interface GalaxyWarpDirectorProps {
  onWarpComplete: () => void;
}

export const GalaxyWarpDirector: React.FC<GalaxyWarpDirectorProps> = ({ onWarpComplete }) => {
  const { camera } = useThree();
  const isInitialLoading = useGalleryStore((s) => s.isInitialLoading);
  const loadingProgress = useGalleryStore((s) => s.loadingProgress);
  const isWarping = useGalleryStore((s) => s.isWarping);
  const isWarpRequested = useGalleryStore((s) => s.isWarpRequested);

  const [galaxyOpacity, setGalaxyOpacity] = useState(1.0);
  const [warpFactor, setWarpFactor] = useState(0.0);
  const [isGalaxyVisible, setIsGalaxyVisible] = useState(true);

  const mousePos = useRef({ x: 0, y: 0 });
  const hasTriggeredWarp = useRef(false);

  // 1. 初始化相机在银河正上方俯视位与并行启动首屏资产预载
  useEffect(() => {
    if (isInitialLoading) {
      camera.position.set(0, 0, 17.5);
      camera.rotation.set(0, 0, 0);
      if ('fov' in camera) {
        (camera as THREE.PerspectiveCamera).fov = 70;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }
    }

    // 启动资产并行预热
    startGalaxyPreload();

    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mousePos.current.y = -(e.clientY / window.innerHeight - 0.5) * 2;
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [camera, isInitialLoading]);

  // 2. 初始加载中的微动视差插值（平滑跟手机/鼠标微倾）
  useFrame((_, delta) => {
    if (!isInitialLoading || isWarping) return;

    const targetX = mousePos.current.x * 0.75;
    const targetY = mousePos.current.y * 0.75;

    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 2.5, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 2.5, delta);
    camera.lookAt(0, 0, 0);
  });

  // 3. 监听进度达到 100% 且用户点击屏幕任意地方后，触发电影级曲速俯冲推进
  useEffect(() => {
    if (isWarpRequested && loadingProgress >= 100 && !hasTriggeredWarp.current && isInitialLoading) {
      hasTriggeredWarp.current = true;
      useGalleryStore.getState().setIsWarping(true);

      const persCamera = camera as THREE.PerspectiveCamera;
      const initialCamX = camera.position.x;
      const initialCamY = camera.position.y;

      const warpObj = {
        camZ: 17.5,
        camX: initialCamX,
        camY: initialCamY,
        warpFactor: 0,
        galaxyOpacity: 1,
        flash: 0,
        fov: 70,
      };

      const tl = gsap.timeline({
        onComplete: () => {
          setIsGalaxyVisible(false);
          useGalleryStore.getState().setIsWarping(false);
          useGalleryStore.getState().setIsWarpRequested(false);
          useGalleryStore.getState().setIsInitialLoading(false);
          useGalleryStore.getState().setWarpFlash(0);
          onWarpComplete();
        },
      });

      // 阶段 A: 向银河核心急速俯冲，广角 FOV 飙升，粒子向外辐射飞掠 (0.0s -> 1.05s)
      tl.to(warpObj, {
        camZ: 0.6,
        warpFactor: 1.0,
        fov: 92,
        duration: 1.05,
        ease: 'power3.in',
        onUpdate: () => {
          camera.position.z = warpObj.camZ;
          const prog = tl.progress();
          camera.position.x = warpObj.camX * (1 - prog);
          camera.position.y = warpObj.camY * (1 - prog);
          camera.lookAt(0, 0, 0);

          if ('fov' in camera) {
            persCamera.fov = warpObj.fov;
            persCamera.updateProjectionMatrix();
          }
          setWarpFactor(warpObj.warpFactor);
        },
      })
      // 阶段 B: 刺入白炽奇点爆发全屏超空间白光 (0.8s -> 1.05s 提前重叠)
      .to(
        warpObj,
        {
          flash: 1.0,
          galaxyOpacity: 0.1,
          duration: 0.28,
          ease: 'power2.in',
          onUpdate: () => {
            useGalleryStore.getState().setWarpFlash(warpObj.flash);
            setGalaxyOpacity(warpObj.galaxyOpacity);
          },
        },
        '-=0.28'
      )
      // 阶段 C: 白光高潮瞬间，隐藏银河、重设相机到长廊入口，并在白光遮掩下挂载长廊
      .call(() => {
        setIsGalaxyVisible(false);
        const maxZ = useGalleryStore.getState().maxZ;
        camera.position.set(0, 0.85, maxZ);
        camera.rotation.set(-0.075, 0, 0);
        if ('fov' in camera) {
          persCamera.fov = 70;
          persCamera.updateProjectionMatrix();
        }
        useGalleryStore.getState().setIsCorridorReady(true);
      })
      // 阶段 D: 白光平滑消散，露出清澈通透的 3D 时光长廊 (1.05s -> 1.75s)
      .to(warpObj, {
        flash: 0.0,
        duration: 0.7,
        ease: 'power2.out',
        onUpdate: () => {
          useGalleryStore.getState().setWarpFlash(warpObj.flash);
        },
      });
    }
  }, [isWarpRequested, loadingProgress, isInitialLoading, camera, onWarpComplete]);

  if (!isGalaxyVisible) return null;

  return (
    <SpiralGalaxy
      opacity={galaxyOpacity}
      warpFactor={warpFactor}
    />
  );
};
