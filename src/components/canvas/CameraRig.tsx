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
      // 向下滚：推进（Z 减小）；向上滚：后退（Z 增加）
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
      // 仅主按键拖拽有效
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

  // 每帧阻尼平滑插值
  useFrame((_, delta) => {
    // 自动巡游播放模式
    if (isPlaying) {
      const autoStep = -delta * 6.0;
      setTargetZ(targetZ + autoStep);
    }

    // 相机 Z 轴阻尼插值
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetZ, 4.5, delta);

    // 仅在 Z 变化达到阈值时通知 Store，大幅减少 React 树多余重渲染
    if (Math.abs(camera.position.z - lastRecordedZ.current) > 0.5) {
      lastRecordedZ.current = camera.position.z;
      setCameraZ(camera.position.z);
    }

    // 视差微晃动：鼠标移动影响相机视角与轻微 X 偏移
    const targetRotY = -mousePos.current.x * 0.04;
    const targetRotX = mousePos.current.y * 0.025;
    const targetCamX = mousePos.current.x * 0.35;
    const targetCamY = 0.5 - mousePos.current.y * 0.2;

    camera.rotation.y = THREE.MathUtils.damp(camera.rotation.y, targetRotY, 3.5, delta);
    camera.rotation.x = THREE.MathUtils.damp(camera.rotation.x, targetRotX, 3.5, delta);
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetCamX, 3.5, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetCamY, 3.5, delta);
  });

  return null;
};
