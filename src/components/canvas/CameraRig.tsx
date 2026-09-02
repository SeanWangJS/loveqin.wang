import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGalleryStore } from '../../stores/useGalleryStore';

export const CameraRig: React.FC = () => {
  const { camera } = useThree();
  const targetZ = useGalleryStore((s) => s.targetZ);
  const setTargetZ = useGalleryStore((s) => s.setTargetZ);
  const setCameraZ = useGalleryStore((s) => s.setCameraZ);
  const isPlaying = useGalleryStore((s) => s.isPlaying);

  const mousePos = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastPointerY = useRef(0);
  const lastRecordedZ = useRef(targetZ);

  // 滚轮与手势监听
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const deltaZ = -e.deltaY * 0.035;
      const currentTargetZ = useGalleryStore.getState().targetZ;
      setTargetZ(currentTargetZ + deltaZ);
    };

    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mousePos.current.y = (e.clientY / window.innerHeight - 0.5) * 2;

      if (isDragging.current) {
        const deltaY = e.clientY - lastPointerY.current;
        lastPointerY.current = e.clientY;
        const deltaZ = deltaY * 0.12;
        const currentTargetZ = useGalleryStore.getState().targetZ;
        setTargetZ(currentTargetZ + deltaZ);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        isDragging.current = true;
        lastPointerY.current = e.clientY;
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setTargetZ]);

  // 每帧阻尼平滑插值与曲速推进（Warp Speed Effect）
  useFrame((_, delta) => {
    if (isPlaying) {
      const autoStep = -delta * 6.0;
      setTargetZ(targetZ + autoStep);
    }

    const distZ = Math.abs(targetZ - camera.position.z);

    // 相机 Z 轴阻尼插值（距离远时加速度飞跃，接近时平滑吸附）
    const dampSpeed = distZ > 60 ? 5.5 : 4.2;
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetZ, dampSpeed, delta);

    // 广角画廊视角基准 (70度电影超广角，远距离跳转拉伸至 80度)
    if ('fov' in camera) {
      const persCamera = camera as THREE.PerspectiveCamera;
      const targetFov = distZ > 25 ? Math.min(80, 70 + distZ * 0.12) : 70;
      persCamera.fov = THREE.MathUtils.damp(persCamera.fov, targetFov, 4.0, delta);
      persCamera.updateProjectionMatrix();
    }

    // 节流状态通知
    if (Math.abs(camera.position.z - lastRecordedZ.current) > 0.4) {
      lastRecordedZ.current = camera.position.z;
      setCameraZ(camera.position.z);
    }

    // 视差微晃动：鼠标移动影响相机视角与轻微 X 偏移
    const targetRotY = -mousePos.current.x * 0.04;
    const targetRotX = -0.075 + mousePos.current.y * 0.025;
    const targetCamX = mousePos.current.x * 0.35;
    const targetCamY = 0.85 - mousePos.current.y * 0.16;

    camera.rotation.y = THREE.MathUtils.damp(camera.rotation.y, targetRotY, 3.5, delta);
    camera.rotation.x = THREE.MathUtils.damp(camera.rotation.x, targetRotX, 3.5, delta);
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetCamX, 3.5, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetCamY, 3.5, delta);
  });

  return null;
};
