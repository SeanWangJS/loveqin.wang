import React, { useEffect } from 'react';
import { Play, Pause, LayoutGrid, Box, Sparkles, Shield, LogIn, LogOut, KeyRound } from 'lucide-react';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { useAuthStore } from '../../stores/useAuthStore';

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

  // 监听 URL 中的 ?invite=xxx 邀请链接
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('invite');
    if (inviteToken) {
      setInviteModalOpen(true, inviteToken);
    }
  }, [setInviteModalOpen]);

  return (
    <header className="fixed top-0 left-0 right-0 z-30 px-6 py-4 flex items-center justify-between pointer-events-none">
      {/* 左侧空间标识与管理控制台入口 */}
      <div className="flex items-center space-x-3 pointer-events-auto">
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl glass-panel text-white">
          <span className="w-2 h-2 rounded-full bg-aurora-cyan animate-pulse" />
          <span className="text-xs font-mono font-bold tracking-widest uppercase">
            LOVEQIN.WANG
          </span>
        </div>

        {/* Owner 创作者控制台入口 */}
        {isAuthenticated && role === 'owner' && (
          <button
            onClick={() => setStudioOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-aurora-cyan/15 hover:bg-aurora-cyan/25 text-aurora-cyan border border-aurora-cyan/40 text-xs font-semibold transition shadow-lg shadow-aurora-cyan/10"
            title="打开创作者控制台（批量上传、相册、成员与回收站）"
          >
            <Shield size={14} />
            <span>Owner Studio</span>
          </button>
        )}
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

      {/* 右侧工具栏与用户身份区 */}
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

        {/* 身份鉴权与用户头像 */}
        {isAuthenticated ? (
          <div className="flex items-center gap-2 pl-1">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass-panel text-xs text-white"
              title={`当前账号：${user?.displayName} (${role === 'owner' ? '空间 Owner' : '浏览 Member'})`}
            >
              <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-aurora-cyan to-aurora-blue text-void-bg flex items-center justify-center font-bold text-[10px]">
                {user?.displayName.slice(0, 1)}
              </div>
              <span className="hidden sm:inline font-medium">{user?.displayName}</span>
              <span className="text-[10px] text-aurora-cyan font-mono">
                {role === 'owner' ? 'Owner' : 'Member'}
              </span>
            </div>

            <button
              onClick={logout}
              className="p-2 rounded-xl glass-panel text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
              title="退出登录"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setInviteModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl glass-panel text-xs text-aurora-teal hover:text-white transition"
              title="输入单次邀请码加入空间"
            >
              <KeyRound size={14} />
              <span className="hidden sm:inline">激活邀请</span>
            </button>

            <button
              onClick={() => setLoginModalOpen(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-aurora-cyan text-void-bg font-semibold rounded-xl text-xs hover:bg-aurora-cyan/90 transition shadow-lg shadow-aurora-cyan/20"
            >
              <LogIn size={14} />
              <span>登录</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
