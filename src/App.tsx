import React from 'react';
import { Sparkles } from 'lucide-react';
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
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [gridYear, setGridYear] = React.useState<number | null>(null);

  React.useEffect(() => {
    // 先校验 Cloudflare Access，再加载家庭相册。
    const init = async () => {
      const authed = await checkAuth();
      if (authed) {
        fetchPhotos();
      } else {
        useGalleryStore.getState().setIsInitialLoading(false);
      }
    };
    init();
  }, [checkAuth, fetchPhotos]);

  return (
    <div className="atlas-app relative h-screen w-screen overflow-hidden bg-[#040810]">
      {/* 3D 螺旋银河 Loading 状态指示与转场遮罩 */}
      <GalaxyLoadingHUD />

      {/* 主内容视区：3D 时光长廊 vs 2D 瀑布流网格 */}
      {viewMode === 'tunnel' ? (
        <>
          <div
            className={`transition-opacity duration-1000 ${
              isInitialLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <TopHUD />
          </div>
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
        <div className="atlas-grid-shell flex h-full min-h-0 flex-col">
          <div
            className={`shrink-0 transition-opacity duration-1000 ${
              isInitialLoading ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <TopHUD gridYear={gridYear} />
          </div>
          <div className="atlas-grid-body min-h-0 flex-1">
            <GridView onVisibleYearChange={setGridYear} />
          </div>
        </div>
      )}

      {/* 沉浸式照片特写与 EXIF 下钻弹窗 */}
      <PhotoDetailModal />

      {/* 未通过 Cloudflare Access 身份鉴权时显示保护门禁 */}
      {isInitialized && !isAuthenticated && (
        <div className="atlas-access-gate">
          <section className="atlas-access-panel">
            <div className="atlas-access-mark"><Sparkles className="h-5 w-5" /></div>
            <span className="atlas-eyebrow">PRIVATE FAMILY ARCHIVE</span>
            <h2>家庭影像</h2>
            <p>请通过 Cloudflare Access 验证身份以继续。</p>
            <button
              onClick={async () => {
                if (import.meta.env.DEV) {
                  const ok = await checkAuth();
                  if (ok) fetchPhotos();
                } else {
                  window.location.reload();
                }
              }}
              className="atlas-access-button"
            >
              {import.meta.env.DEV ? '进入本地档案' : '重新验证身份'}
            </button>
          </section>
        </div>
      )}
    </div>
  );
};
