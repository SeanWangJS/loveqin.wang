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

  React.useEffect(() => {
    // 启动时优先校验 Access 鉴权，核验家庭成员白名单后再加载相册
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

      {/* 未通过身份鉴权或未在白名单中的保护门禁 */}
      {isInitialized && !isAuthenticated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#040810]/95 px-6 backdrop-blur-2xl">
          <div className="max-w-md w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mx-auto shadow-lg shadow-sky-500/10">
              <Sparkles className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">私密家庭空间</h2>
              <p className="text-xs text-sky-400 font-mono mt-1 uppercase tracking-widest">
                {import.meta.env.DEV ? 'Local Dev Protected' : 'Protected by Cloudflare Access'}
              </p>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">
              此空间仅限受邀活跃家庭成员访问。请通过身份认证以进入画廊。
            </p>
            <button
              onClick={async () => {
                if (import.meta.env.DEV) {
                  const ok = await checkAuth();
                  if (ok) fetchPhotos();
                } else {
                  window.location.reload();
                }
              }}
              className="w-full py-3 px-4 bg-gradient-to-r from-sky-400 to-indigo-500 text-black font-semibold rounded-xl text-sm hover:opacity-90 transition shadow-lg shadow-sky-500/25"
            >
              {import.meta.env.DEV ? '激活本地开发会话并进入' : '通过 Access 验证并进入'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
