import React, { useState, useMemo } from 'react';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { MapPin, Box, Search } from 'lucide-react';
import { PhotoItem } from '../../types/gallery';

export const GridView: React.FC = () => {
  const photos = useGalleryStore((s) => s.photos);
  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);
  const jumpToPhoto = useGalleryStore((s) => s.jumpToPhoto);
  const setViewMode = useGalleryStore((s) => s.setViewMode);

  const [searchTerm, setSearchTerm] = useState('');

  const filteredPhotos = useMemo(() => {
    if (!searchTerm.trim()) return photos;
    const term = searchTerm.toLowerCase();
    return photos.filter(
      (p) =>
        p.title.toLowerCase().includes(term) ||
        p.locationName.toLowerCase().includes(term) ||
        p.story.toLowerCase().includes(term) ||
        p.takenAtLocal.includes(term)
    );
  }, [photos, searchTerm]);

  const handleLocateIn3D = (photo: PhotoItem, e: React.MouseEvent) => {
    e.stopPropagation();
    jumpToPhoto(photo.id);
    setViewMode('tunnel');
  };

  return (
    <div className="w-full h-full pt-24 pb-28 px-4 sm:px-8 overflow-y-auto bg-void-950/95">
      <div className="max-w-7xl mx-auto">
        {/* 顶部检索栏 */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              2D 网格视图 · 全部回忆珍藏
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              共加载 {filteredPhotos.length} 张照片 · 支持与 3D 时光长廊无损双向定位
            </p>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索地点、年份或故事..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-aurora-cyan/50 transition-all font-sans"
            />
          </div>
        </div>

        {/* 瀑布流/网格照片矩阵 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {filteredPhotos.map((photo) => (
            <div
              key={photo.id}
              onClick={() => setSelectedPhoto(photo)}
              className="group relative rounded-2xl overflow-hidden glass-panel hover:border-aurora-cyan/50 transition-all cursor-pointer shadow-lg hover:shadow-[0_0_20px_rgba(56,189,248,0.2)] flex flex-col"
            >
              {/* 图片区域 */}
              <div className="aspect-[4/3] w-full overflow-hidden bg-slate-900 relative">
                <img
                  src={photo.urlThumbHigh}
                  alt={photo.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                
                {/* 悬停快捷按钮：在 3D 长廊中定位 */}
                <button
                  onClick={(e) => handleLocateIn3D(photo, e)}
                  className="absolute bottom-2.5 right-2.5 px-2.5 py-1.5 rounded-lg bg-aurora-cyan/90 text-void-950 font-medium text-xs flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:bg-aurora-ice"
                  title="切换并在 3D 长廊中直接飞跃至该照片"
                >
                  <Box className="w-3.5 h-3.5" />
                  <span>3D 定位</span>
                </button>
              </div>

              {/* 卡片底部简要信息 */}
              <div className="p-3.5 flex flex-col justify-between flex-1">
                <div>
                  <h4 className="text-sm font-semibold text-white truncate group-hover:text-aurora-cyan transition-colors">
                    {photo.title}
                  </h4>
                  <div className="flex items-center text-[11px] text-slate-400 mt-1 space-x-1">
                    <MapPin className="w-3 h-3 text-aurora-cyan/70" />
                    <span className="truncate">{photo.locationName}</span>
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>{photo.takenAtLocal.split(' ')[0]}</span>
                  <span>ISO {photo.exif.iso}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
