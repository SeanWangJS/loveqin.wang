import React from 'react';
import { useGalleryStore } from './stores/useGalleryStore';
import { useAuthStore } from './stores/useAuthStore';
import { Scene } from './components/canvas/Scene';
import { TopHUD } from './components/dom/TopHUD';
import { TimelineScrubber } from './components/dom/TimelineScrubber';
import { PhotoDetailModal } from './components/dom/PhotoDetailModal';
import { GridView } from './components/dom/GridView';
import { GalaxyLoadingHUD } from './components/dom/GalaxyLoadingHUD';

export const App: React.FC = () => {
  const viewMode = useGalleryStore((s) => s.viewMode);
  const isInitialLoading = useGalleryStore((s) => s.isInitialLoading);
  const fetchPhotos = useGalleryStore((s) => s.fetchPhotos);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  React.useEffect(() => {
    // 启动时初始化 Access 鉴权并加载相册照片
    checkAuth();
    fetchPhotos();
  }, [checkAuth, fetchPhotos]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#040810]">
      {/* 3D 螺旋银河 Loading 状态指示与转场遮罩 */}
      <GalaxyLoadingHUD />

      {/* 顶部 HUD 状态栏（进入画廊后平滑浮现） */}
      <div
        className={`transition-opacity duration-1000 ${
          isInitialLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <TopHUD />
      </div>

      {/* 主内容视区：3D 时光长廊 vs 2D 瀑布流网格 */}
      {viewMode === 'tunnel' ? (
        <>
          <Scene />
          <div
            className={`transition-opacity duration-1000 ${
              isInitialLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <TimelineScrubber />
          </div>
        </>
      ) : (
        <GridView />
      )}

      {/* 沉浸式照片特写与 EXIF 下钻弹窗 */}
      <PhotoDetailModal />
    </div>
  );
};
