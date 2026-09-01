import React, { useState, useEffect } from 'react';
import { Menu, Search, Sparkles, LayoutGrid, Box, Volume2, VolumeX, Shield, LogIn, LogOut, KeyRound, Pause, X } from 'lucide-react';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { ambientAudio } from '../../utils/ambientAudio';

export const TopHUD: React.FC = () => {
  const activeYear = useGalleryStore((s) => s.activeYear);
  const activeMonthSpan = useGalleryStore((s) => s.activeMonthSpan);
  const viewMode = useGalleryStore((s) => s.viewMode);
  const setViewMode = useGalleryStore((s) => s.setViewMode);
  const isPlaying = useGalleryStore((s) => s.isPlaying);
  const togglePlay = useGalleryStore((s) => s.togglePlay);
  const qualityTier = useGalleryStore((s) => s.qualityTier);
  const setQualityTier = useGalleryStore((s) => s.setQualityTier);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const role = useAuthStore((s) => s.role);
  const setLoginModalOpen = useAuthStore((s) => s.setLoginModalOpen);
  const setStudioOpen = useAuthStore((s) => s.setStudioOpen);
  const setInviteModalOpen = useAuthStore((s) => s.setInviteModalOpen);
  const logout = useAuthStore((s) => s.logout);

  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // 自动巡游联动音频
  useEffect(() => {
    if (isPlaying) {
      ambientAudio.play();
      setIsAudioPlaying(true);
    }
  }, [isPlaying]);

  const toggleAudio = () => {
    if (isAudioPlaying) {
      ambientAudio.pause();
      setIsAudioPlaying(false);
    } else {
      ambientAudio.play();
      setIsAudioPlaying(true);
    }
  };

  // 监听 URL 邀请码
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('invite');
    if (inviteToken) {
      setInviteModalOpen(true, inviteToken);
    }
  }, [setInviteModalOpen]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-30 px-6 sm:px-10 py-5 flex items-center justify-between pointer-events-none">
        {/* 1. 左侧：概念图同款极简汉堡菜单 (☰) */}
        <div className="flex items-center space-x-3 pointer-events-auto">
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="p-2.5 rounded-xl bg-slate-900/40 hover:bg-slate-800/80 border border-slate-700/40 text-slate-200 hover:text-white transition shadow-lg backdrop-blur-md"
            title="打开系统菜单与设置"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* 2. 中央：概念图同款大号极简年份 + 月份副标 (2024 / May - August) */}
        <div className="text-center pointer-events-auto flex flex-col items-center select-none">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white font-sans drop-shadow-[0_0_24px_rgba(255,255,255,0.35)]">
            {activeYear}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 font-medium tracking-wider mt-1 drop-shadow-sm">
            {activeMonthSpan || 'May - August'}
          </p>
        </div>

        {/* 3. 右侧：概念图同款极简工具栏 (🔍 搜索, 🎁 收藏集/亮点, ⠿ 2D/3D视图) */}
        <div className="flex items-center space-x-3 sm:space-x-4 pointer-events-auto">
          {/* 搜索按钮 */}
          <button
            onClick={() => setIsSearchOpen(!isSearchOpen)}
            className="p-2.5 rounded-xl bg-slate-900/40 hover:bg-slate-800/80 border border-slate-700/40 text-slate-300 hover:text-white transition shadow-lg backdrop-blur-md"
            title="搜索时光记忆"
          >
            <Search className="w-5 h-5" />
          </button>

          {/* 亮点与时光放映 (🎁 / 自动巡游) */}
          <button
            onClick={togglePlay}
            className={`p-2.5 rounded-xl border transition shadow-lg backdrop-blur-md ${
              isPlaying
                ? 'bg-sky-500/20 border-sky-400/60 text-sky-300 shadow-[0_0_15px_rgba(56,189,248,0.4)]'
                : 'bg-slate-900/40 hover:bg-slate-800/80 border-slate-700/40 text-slate-300 hover:text-white'
            }`}
            title={isPlaying ? '暂停时光巡游' : '开启时光巡游'}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          </button>

          {/* 2D 瀑布流 / 3D 长廊视图切换 (概念图 9 宫格图标) */}
          <button
            onClick={() => setViewMode(viewMode === 'tunnel' ? 'grid' : 'tunnel')}
            className={`p-2.5 rounded-xl border transition shadow-lg backdrop-blur-md ${
              viewMode === 'grid'
                ? 'bg-sky-500/20 border-sky-400/60 text-sky-300 shadow-[0_0_15px_rgba(56,189,248,0.4)]'
                : 'bg-slate-900/40 hover:bg-slate-800/80 border-slate-700/40 text-slate-300 hover:text-white'
            }`}
            title={viewMode === 'tunnel' ? '切换为 2D 画廊瀑布流' : '切换为 3D 沉浸长廊'}
          >
            {viewMode === 'tunnel' ? <LayoutGrid className="w-5 h-5" /> : <Box className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* 搜索浮层 */}
      {isSearchOpen && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4">
          <div className="glass-panel p-2.5 rounded-2xl flex items-center gap-2 border border-sky-500/30 shadow-2xl backdrop-blur-xl">
            <Search className="w-4 h-4 text-sky-400 ml-2" />
            <input
              type="text"
              placeholder="搜索照片标题、地点或故事..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none w-full px-2"
              autoFocus
            />
            <button
              onClick={() => setIsSearchOpen(false)}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 侧边滑出控制菜单 (通过左上角 ☰ 呼出) */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsDrawerOpen(false)}
          />
          <div className="relative w-80 max-w-[85vw] h-full bg-[#070c14]/95 border-r border-slate-800/80 p-6 flex flex-col justify-between shadow-2xl backdrop-blur-xl z-10">
            <div>
              <div className="flex items-center justify-between pb-5 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
                  <span className="text-sm font-bold tracking-widest text-white font-mono uppercase">
                    LOVEQIN.WANG
                  </span>
                </div>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-6 space-y-4">
                {/* 音乐开关 */}
                <button
                  onClick={toggleAudio}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 transition"
                >
                  <div className="flex items-center gap-3 text-sm">
                    {isAudioPlaying ? <Volume2 className="w-4 h-4 text-sky-400" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
                    <span>空灵环境音乐</span>
                  </div>
                  <span className="text-xs text-sky-400 font-mono">{isAudioPlaying ? 'ON' : 'OFF'}</span>
                </button>

                {/* 画质切换 */}
                <button
                  onClick={() => {
                    const next = qualityTier === 'high' ? 'medium' : qualityTier === 'medium' ? 'low' : 'high';
                    setQualityTier(next);
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 text-slate-200 transition"
                >
                  <div className="flex items-center gap-3 text-sm">
                    <Sparkles className="w-4 h-4 text-sky-400" />
                    <span>渲染画质</span>
                  </div>
                  <span className="text-xs text-sky-400 font-mono">{qualityTier.toUpperCase()}</span>
                </button>

                {/* Owner 控制台 */}
                {isAuthenticated && role === 'owner' && (
                  <button
                    onClick={() => {
                      setIsDrawerOpen(false);
                      setStudioOpen(true);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 font-semibold text-sm transition"
                  >
                    <Shield className="w-4 h-4" />
                    <span>Owner Studio 创作控制台</span>
                  </button>
                )}
              </div>
            </div>

            {/* 底部鉴权区 */}
            <div className="pt-6 border-t border-slate-800">
              {isAuthenticated ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-400 to-indigo-500 flex items-center justify-center text-xs font-bold text-black">
                      {user?.displayName.slice(0, 1)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">{user?.displayName}</div>
                      <div className="text-xs text-sky-400 font-mono">{role === 'owner' ? 'Owner' : 'Member'}</div>
                    </div>
                  </div>
                  <button
                    onClick={logout}
                    className="p-2 text-slate-400 hover:text-rose-400 transition"
                    title="退出登录"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={() => {
                      setIsDrawerOpen(false);
                      setInviteModalOpen(true);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl border border-slate-700 text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-sky-400" />
                    <span>激活单次邀请码</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsDrawerOpen(false);
                      setLoginModalOpen(true);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-sky-500 text-black font-semibold rounded-xl text-xs hover:bg-sky-400 transition shadow-lg shadow-sky-500/20"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>账号登录</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
