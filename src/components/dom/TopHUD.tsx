import React from 'react';
import { Menu, Search, Play, Pause, LayoutGrid, Box, Sparkles } from 'lucide-react';
import { useGalleryStore } from '../../stores/useGalleryStore';

export const TopHUD: React.FC = () => {
  const activeYear = useGalleryStore((s) => s.activeYear);
  const activeMonthSpan = useGalleryStore((s) => s.activeMonthSpan);
  const viewMode = useGalleryStore((s) => s.viewMode);
  const setViewMode = useGalleryStore((s) => s.setViewMode);
  const isPlaying = useGalleryStore((s) => s.isPlaying);
  const togglePlay = useGalleryStore((s) => s.togglePlay);
  const qualityTier = useGalleryStore((s) => s.qualityTier);
  const setQualityTier = useGalleryStore((s) => s.setQualityTier);

  return (
    <header className="fixed top-0 left-0 right-0 z-30 px-6 py-4 flex items-center justify-between pointer-events-none">
      {/* 左侧菜单区 */}
      <div className="flex items-center space-x-3 pointer-events-auto">
        <button
          className="p-2.5 rounded-xl glass-panel hover:bg-slate-800/80 text-slate-300 hover:text-aurora-cyan transition-all"
          title="系统菜单"
          onClick={() => alert('时光长廊相册 · 封闭私密空间 (Owner / Member 鉴权已就绪)')}
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="hidden sm:block text-xs tracking-widest text-slate-400 uppercase font-mono">
          TIME TUNNEL GALLERY
        </div>
      </div>

      {/* 中央主标题与时间显示区 */}
      <div className="text-center pointer-events-auto flex flex-col items-center">
        <div className="text-4xl sm:text-5xl font-bold tracking-tight text-white font-mono drop-shadow-[0_0_20px_rgba(56,189,248,0.4)]">
          {activeYear}
        </div>
        <div className="text-xs sm:text-sm text-slate-400 font-medium tracking-wide mt-0.5">
          {activeMonthSpan}
        </div>
      </div>

      {/* 右侧工具栏区 */}
      <div className="flex items-center space-x-2.5 pointer-events-auto">
        {/* 画质切换按钮 */}
        <button
          className="px-2.5 py-1.5 rounded-lg glass-panel text-xs font-mono text-slate-300 hover:text-aurora-cyan transition-all hidden md:flex items-center space-x-1"
          title={`当前画质：${qualityTier.toUpperCase()} (点击切换)`}
          onClick={() => {
            const next = qualityTier === 'high' ? 'medium' : qualityTier === 'medium' ? 'low' : 'high';
            setQualityTier(next);
          }}
        >
          <Sparkles className="w-3.5 h-3.5 text-aurora-cyan" />
          <span>{qualityTier.toUpperCase()}</span>
        </button>

        {/* 自动巡游播放 */}
        <button
          className={`p-2.5 rounded-xl glass-panel transition-all ${
            isPlaying
              ? 'glass-panel-glow text-aurora-cyan'
              : 'hover:bg-slate-800/80 text-slate-300 hover:text-aurora-cyan'
          }`}
          title={isPlaying ? '暂停时光巡游' : '开启自动时光放映机'}
          onClick={togglePlay}
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>

        {/* 2D / 3D 模式切换 */}
        <button
          className={`p-2.5 rounded-xl glass-panel transition-all ${
            viewMode === 'grid'
              ? 'glass-panel-glow text-aurora-cyan'
              : 'hover:bg-slate-800/80 text-slate-300 hover:text-aurora-cyan'
          }`}
          title={viewMode === 'tunnel' ? '切换为 2D 瀑布流网格' : '切换为 3D 沉浸长廊'}
          onClick={() => setViewMode(viewMode === 'tunnel' ? 'grid' : 'tunnel')}
        >
          {viewMode === 'tunnel' ? (
            <LayoutGrid className="w-5 h-5" />
          ) : (
            <Box className="w-5 h-5" />
          )}
        </button>

        {/* 搜索按钮 */}
        <button
          className="p-2.5 rounded-xl glass-panel hover:bg-slate-800/80 text-slate-300 hover:text-aurora-cyan transition-all hidden sm:block"
          title="全局搜索"
          onClick={() => alert('支持按年份、地点（如川西、洱海）与相机参数即时检索')}
        >
          <Search className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};
