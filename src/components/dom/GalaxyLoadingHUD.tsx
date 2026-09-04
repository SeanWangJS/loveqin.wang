import React, { useEffect } from 'react';
import { useGalleryStore } from '../../stores/useGalleryStore';

export const GalaxyLoadingHUD: React.FC = () => {
  const isInitialLoading = useGalleryStore((s) => s.isInitialLoading);
  const loadingProgress = useGalleryStore((s) => s.loadingProgress);
  const isWarping = useGalleryStore((s) => s.isWarping);
  const warpFlash = useGalleryStore((s) => s.warpFlash);

  const isLoadedReady = loadingProgress >= 100;

  // 全局视窗点击监听：只要进度条达到 100%，点击屏幕任何一处即刻触发跃迁
  useEffect(() => {
    const handleGlobalTrigger = () => {
      const state = useGalleryStore.getState();
      if (state.loadingProgress >= 100 && !state.isWarping && state.isInitialLoading) {
        state.setIsWarpRequested(true);
      }
    };

    window.addEventListener('click', handleGlobalTrigger);
    window.addEventListener('touchend', handleGlobalTrigger);

    return () => {
      window.removeEventListener('click', handleGlobalTrigger);
      window.removeEventListener('touchend', handleGlobalTrigger);
    };
  }, []);

  const handleScreenClick = () => {
    if (isLoadedReady && !isWarping) {
      useGalleryStore.getState().setIsWarpRequested(true);
    }
  };

  if (!isInitialLoading && warpFlash <= 0.01) return null;

  return (
    <>
      {/* 冲入银河核心瞬间的超空间白光爆发 (Hyperspace Singularity Flash) */}
      <div
        className="fixed inset-0 z-50 pointer-events-none bg-gradient-to-b from-white via-cyan-50 to-white"
        style={{
          opacity: warpFlash,
          transition: 'opacity 0.05s linear',
        }}
      />

      {/* 全屏点击响应层：始终拦截鼠标事件防止穿透，加载完毕后任意点击触发跃迁 */}
      <div
        onClick={handleScreenClick}
        className={`fixed inset-0 z-40 flex flex-col justify-end p-8 sm:p-12 pb-14 sm:pb-16 select-none transition-opacity duration-700 pointer-events-auto ${
          isWarping ? 'opacity-0 pointer-events-none scale-105' : 'opacity-100'
        } ${isLoadedReady ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {/* 底部居中极简流光进度条 */}
        <div className="w-full max-w-sm sm:max-w-md mx-auto flex flex-col items-center">
          <div className="w-full relative">
            <div className="w-full h-1 bg-slate-900/80 rounded-full overflow-hidden border border-slate-800/80 backdrop-blur-md shadow-inner">
              <div
                className={`h-full rounded-full transition-all duration-300 ease-out bg-gradient-to-r from-sky-400 via-cyan-300 to-amber-400 ${
                  isLoadedReady
                    ? 'shadow-[0_0_16px_rgba(56,189,248,0.9)] animate-pulse'
                    : 'shadow-[0_0_10px_rgba(56,189,248,0.6)]'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, loadingProgress))}%` }}
              />
            </div>

            {/* 极简微弱数字读数 */}
            <div className="flex justify-end mt-2 px-0.5">
              <span className="text-[11px] font-mono text-slate-400/80 tracking-widest">
                {loadingProgress}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
