import React from 'react';
import { useGalleryStore } from './stores/useGalleryStore';
import { Scene } from './components/canvas/Scene';
import { TopHUD } from './components/dom/TopHUD';
import { TimelineScrubber } from './components/dom/TimelineScrubber';
import { PhotoDetailModal } from './components/dom/PhotoDetailModal';
import { GridView } from './components/dom/GridView';

export const App: React.FC = () => {
  const viewMode = useGalleryStore((s) => s.viewMode);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-void-950">
      {/* 顶部 HUD 状态栏 */}
      <TopHUD />

      {/* 主内容视区：3D 时光长廊 vs 2D 瀑布流网格 */}
      {viewMode === 'tunnel' ? (
        <>
          <Scene />
          <TimelineScrubber />
        </>
      ) : (
        <GridView />
      )}

      {/* 沉浸式照片特写与 EXIF 下钻弹窗 */}
      <PhotoDetailModal />
    </div>
  );
};
