import React, { useState, useEffect } from 'react';
import { Aperture, Search, Sparkles, LayoutGrid, Box, Volume2, VolumeX, LogIn, LogOut, Pause, X, Eye, EyeOff } from 'lucide-react';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { ambientAudio } from '../../utils/ambientAudio';

interface TopHUDProps {
  gridYear?: number | null;
}

export const TopHUD: React.FC<TopHUDProps> = ({ gridYear }) => {
  const activeYear = useGalleryStore((s) => s.activeYear);
  const activeMonthSpan = useGalleryStore((s) => s.activeMonthSpan);
  const viewMode = useGalleryStore((s) => s.viewMode);
  const setViewMode = useGalleryStore((s) => s.setViewMode);
  const isPlaying = useGalleryStore((s) => s.isPlaying);
  const togglePlay = useGalleryStore((s) => s.togglePlay);
  const qualityTier = useGalleryStore((s) => s.qualityTier);
  const setQualityTier = useGalleryStore((s) => s.setQualityTier);
  const storyLayerEnabled = useGalleryStore((s) => s.storyLayerEnabled);
  const setStoryLayerEnabled = useGalleryStore((s) => s.setStoryLayerEnabled);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const photos = useGalleryStore((s) => s.photos);
  const isInitialLoading = useGalleryStore((s) => s.isInitialLoading);
  const logout = useAuthStore((s) => s.logout);

  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const displayedYear = viewMode === 'grid' ? (gridYear ?? activeYear) : activeYear;

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

  const focusGallerySearch = () => {
    if (viewMode !== 'grid') setViewMode('grid');
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>('[data-gallery-search]')?.focus();
    }, 120);
  };

  return (
    <>
      <header className={`atlas-header ${viewMode === 'grid' ? 'atlas-header--grid' : ''}`}>
        <div className="atlas-brand">
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="atlas-icon-button atlas-menu-button"
            title="打开画廊设置"
            aria-label="打开画廊设置"
          >
            <Aperture className="h-5 w-5" strokeWidth={1.5} />
          </button>
          <div className="atlas-wordmark">
            <span>LOVEQIN</span>
            <small>FAMILY ARCHIVE</small>
          </div>
        </div>

        <div className="atlas-edition" aria-live="polite">
          <span className="atlas-edition-label">时光档案</span>
          <h1>{displayedYear}</h1>
          <span className="atlas-edition-month">{activeMonthSpan || '记忆正在展开'}</span>
        </div>

        <nav className="atlas-tools" aria-label="画廊工具">
          <button
            onClick={focusGallerySearch}
            className="atlas-icon-button"
            title="搜索照片"
            aria-label="搜索照片"
          >
            <Search className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </button>

          <button
            onClick={togglePlay}
            className={`atlas-icon-button ${isPlaying ? 'is-active' : ''}`}
            title={isPlaying ? '暂停时光巡游' : '开启时光巡游'}
            aria-label={isPlaying ? '暂停时光巡游' : '开启时光巡游'}
            aria-pressed={isPlaying}
          >
            {isPlaying ? <Pause className="h-[18px] w-[18px]" /> : <Sparkles className="h-[18px] w-[18px]" />}
          </button>

          <button
            onClick={() => setViewMode(viewMode === 'tunnel' ? 'grid' : 'tunnel')}
            className={`atlas-icon-button ${viewMode === 'grid' ? 'is-active' : ''}`}
            title={viewMode === 'tunnel' ? '切换为 2D 画廊瀑布流' : '切换为 3D 沉浸长廊'}
            aria-label={viewMode === 'tunnel' ? '切换为照片网格' : '切换为沉浸长廊'}
          >
            {viewMode === 'tunnel' ? <LayoutGrid className="h-[18px] w-[18px]" /> : <Box className="h-[18px] w-[18px]" />}
          </button>
        </nav>
      </header>

      {isDrawerOpen && (
        <div className="atlas-drawer-layer">
          <div
            className="atlas-drawer-backdrop"
            onClick={() => setIsDrawerOpen(false)}
          />
          <aside className="atlas-drawer" aria-label="画廊设置">
            <div>
              <div className="atlas-drawer-heading">
                <div>
                  <span className="atlas-eyebrow">COLLECTION SETTINGS</span>
                  <h2>画廊设置</h2>
                </div>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="atlas-icon-button atlas-icon-button--dark"
                  aria-label="关闭设置"
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              </div>

              <div className="atlas-settings-list">
                <button
                  onClick={toggleAudio}
                  className="atlas-setting-row"
                >
                  <div className="atlas-setting-label">
                    {isAudioPlaying ? <Volume2 /> : <VolumeX />}
                    <span>环境音乐</span>
                  </div>
                  <span className={`atlas-switch ${isAudioPlaying ? 'is-on' : ''}`} aria-hidden="true" />
                </button>

                <button
                  onClick={() => {
                    const next = qualityTier === 'high' ? 'medium' : qualityTier === 'medium' ? 'low' : 'high';
                    setQualityTier(next);
                  }}
                  className="atlas-setting-row"
                >
                  <div className="atlas-setting-label">
                    <Sparkles />
                    <span>渲染画质</span>
                  </div>
                  <span className="atlas-setting-value">{qualityTier.toUpperCase()}</span>
                </button>

                <button
                  type="button"
                  aria-pressed={storyLayerEnabled}
                  onClick={() => setStoryLayerEnabled(!storyLayerEnabled)}
                  className="atlas-setting-row"
                >
                  <div className="atlas-setting-label">
                    {storyLayerEnabled
                      ? <Eye />
                      : <EyeOff />}
                    <span>故事光影文字</span>
                  </div>
                  <span className={`atlas-switch ${storyLayerEnabled ? 'is-on' : ''}`} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="atlas-account">
              {isAuthenticated ? (
                <div className="atlas-account-row">
                  <div className="atlas-account-identity">
                    <span className="atlas-account-avatar">
                      {user?.displayName ? user.displayName.slice(0, 1).toUpperCase() : '访'}
                    </span>
                    <div>
                      <strong>{user?.displayName || user?.email}</strong>
                      <small>ACCESS 已验证</small>
                    </div>
                  </div>
                  <button
                    onClick={logout}
                    className="atlas-icon-button atlas-icon-button--dark"
                    title="退出登录"
                    aria-label="退出登录"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="atlas-account-guest">
                  <span>PRIVATE FAMILY ARCHIVE</span>
                  <button
                    onClick={() => {
                      window.location.reload();
                    }}
                    className="atlas-login-button"
                  >
                    <LogIn className="h-4 w-4" />
                    <span>重新验证身份</span>
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {viewMode === 'tunnel' && !isInitialLoading && photos.length === 0 && (
        <div className="atlas-empty-state">
          <Sparkles className="h-5 w-5" />
          <span>这本档案还没有照片</span>
          <code>pnpm photo:import</code>
          <small>导入完成后，记忆会在这里重新排列。</small>
        </div>
      )}
    </>
  );
};

