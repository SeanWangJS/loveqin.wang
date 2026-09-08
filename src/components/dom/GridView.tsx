import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { MapPin, Box, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { PhotoItem } from '../../types/gallery';

const PAGE_SIZE_OPTIONS = [12, 24, 48];

interface GridViewProps {
  onVisibleYearChange: (year: number | null) => void;
}

export const GridView: React.FC<GridViewProps> = ({ onVisibleYearChange }) => {
  const photos = useGalleryStore((s) => s.photos);
  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);
  const jumpToPhoto = useGalleryStore((s) => s.jumpToPhoto);
  const setViewMode = useGalleryStore((s) => s.setViewMode);

  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[1]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  const totalPages = Math.max(1, Math.ceil(filteredPhotos.length / pageSize));
  const visiblePage = Math.min(currentPage, totalPages);
  const visiblePhotos = useMemo(() => {
    const startIndex = (visiblePage - 1) * pageSize;
    return filteredPhotos.slice(startIndex, startIndex + pageSize);
  }, [filteredPhotos, pageSize, visiblePage]);

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const pages = new Set([1, totalPages, visiblePage, visiblePage - 1, visiblePage + 1]);
    return Array.from(pages)
      .filter((page) => page >= 1 && page <= totalPages)
      .sort((a, b) => a - b);
  }, [totalPages, visiblePage]);

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (value: number) => {
    setPageSize(value);
    setCurrentPage(1);
  };

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [searchTerm, pageSize, visiblePage]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const updateVisibleYear = () => {
      const containerTop = container.getBoundingClientRect().top;
      const visiblePhotos = Array.from(
        container.querySelectorAll<HTMLElement>('[data-grid-photo]')
      )
        .map((element) => ({
          top: element.getBoundingClientRect().top - containerTop,
          year: Number(element.dataset.year),
        }))
        .filter(({ top }) => top >= -elementVisibilityMargin && top < container.clientHeight)
        .sort((a, b) => a.top - b.top);

      onVisibleYearChange(visiblePhotos[0]?.year ?? null);
    };

    const elementVisibilityMargin = 24;
    updateVisibleYear();
    container.addEventListener('scroll', updateVisibleYear, { passive: true });
    return () => container.removeEventListener('scroll', updateVisibleYear);
  }, [onVisibleYearChange, visiblePhotos]);

  const handleLocateIn3D = (photo: PhotoItem, e: React.MouseEvent) => {
    e.stopPropagation();
    jumpToPhoto(photo.id);
    setViewMode('tunnel');
  };

  return (
    <div ref={scrollContainerRef} className="w-full h-full pt-8 pb-28 px-4 sm:px-8 overflow-y-auto bg-void-950/95">
      <div className="max-w-7xl mx-auto">
        {/* 顶部检索栏 */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              爱琴之境 · 星光时空画廊
            </h2>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索地点、年份或故事..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-aurora-cyan/50 transition-all font-sans"
            />
          </div>
        </div>

        <div className="mb-5 flex flex-col gap-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {filteredPhotos.length === 0
              ? '没有找到匹配的照片'
              : `显示 ${(visiblePage - 1) * pageSize + 1}-${Math.min(visiblePage * pageSize, filteredPhotos.length)} / ${filteredPhotos.length} 张照片`}
          </span>
          <label className="flex items-center gap-2">
            <span>每页</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="rounded-lg border border-slate-800 bg-slate-900/80 px-2.5 py-1.5 text-slate-200 outline-none transition-colors focus:border-aurora-cyan/50"
              aria-label="每页照片数量"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} 张
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 分页后的照片网格 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {visiblePhotos.map((photo) => (
            <div
              key={photo.id}
              data-grid-photo
              data-year={new Date(photo.takenAt).getFullYear()}
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

        {filteredPhotos.length > 0 && (
          <nav className="mt-8 flex items-center justify-center gap-1.5" aria-label="照片分页">
            <button
              type="button"
              onClick={() => setCurrentPage(Math.max(1, visiblePage - 1))}
              disabled={visiblePage === 1}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/70 text-slate-300 transition-colors hover:border-aurora-cyan/50 hover:text-aurora-cyan disabled:cursor-not-allowed disabled:opacity-35"
              title="上一页"
              aria-label="上一页"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {pageNumbers.map((page, index) => {
              const previousPage = pageNumbers[index - 1];
              const needsEllipsis = index > 0 && page - previousPage > 1;

              return (
                <React.Fragment key={page}>
                  {needsEllipsis && <span className="px-1 text-slate-600">...</span>}
                  <button
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={`h-9 min-w-9 rounded-lg border px-2 text-xs font-medium transition-colors ${
                      page === visiblePage
                        ? 'border-aurora-cyan/70 bg-aurora-cyan/15 text-aurora-cyan'
                        : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-aurora-cyan/50 hover:text-slate-200'
                    }`}
                    aria-label={`第 ${page} 页`}
                    aria-current={page === visiblePage ? 'page' : undefined}
                  >
                    {page}
                  </button>
                </React.Fragment>
              );
            })}

            <button
              type="button"
              onClick={() => setCurrentPage(Math.min(totalPages, visiblePage + 1))}
              disabled={visiblePage === totalPages}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900/70 text-slate-300 transition-colors hover:border-aurora-cyan/50 hover:text-aurora-cyan disabled:cursor-not-allowed disabled:opacity-35"
              title="下一页"
              aria-label="下一页"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        )}
      </div>
    </div>
  );
};
