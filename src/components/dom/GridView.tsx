import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useGalleryStore } from '../../stores/useGalleryStore';
import { MapPin, Box, Search, ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
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
    <main ref={scrollContainerRef} className="atlas-grid-view">
      <div className="atlas-grid-inner">
        <header className="atlas-grid-heading">
          <div>
            <span className="atlas-eyebrow">A PRIVATE COLLECTION · {photos.length} FRAMES</span>
            <h2>记忆，按时间排列。</h2>
            <p>每一帧，都有自己的来处。</p>
          </div>

          <label className="atlas-search-field">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              type="text"
              data-gallery-search
              placeholder="搜索地点、故事、日期…"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="搜索照片地点、故事或日期"
            />
            {searchTerm && (
              <button type="button" onClick={() => handleSearchChange('')} aria-label="清除搜索" title="清除搜索">
                <span aria-hidden="true">×</span>
              </button>
            )}
          </label>
        </header>

        <div className="atlas-grid-meta">
          <span className="atlas-result-count">
            {filteredPhotos.length === 0
              ? photos.length === 0 ? '档案中还没有照片' : '没有找到相符的记忆'
              : `${String((visiblePage - 1) * pageSize + 1).padStart(2, '0')} — ${String(Math.min(visiblePage * pageSize, filteredPhotos.length)).padStart(2, '0')} / ${String(filteredPhotos.length).padStart(2, '0')}`}
          </span>
          <label className="atlas-page-size">
            <span>每页展示</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              aria-label="每页照片数量"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size} 张</option>
              ))}
            </select>
          </label>
        </div>

        <div className="atlas-photo-grid">
          {visiblePhotos.map((photo) => (
            <div
              key={photo.id}
              data-grid-photo
              data-year={new Date(photo.takenAt).getFullYear()}
              onClick={() => setSelectedPhoto(photo)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedPhoto(photo);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`查看照片：${photo.title}`}
              className="atlas-photo-card"
            >
              <div className="atlas-photo-image">
                <img
                  src={photo.urlThumbHigh}
                  alt={photo.title}
                  loading="lazy"
                  className=""
                />
                <span className="atlas-photo-index">{String((visiblePage - 1) * pageSize + visiblePhotos.indexOf(photo) + 1).padStart(2, '0')}</span>
                <button
                  onClick={(e) => handleLocateIn3D(photo, e)}
                  className="atlas-locate-button"
                  title="切换并在 3D 长廊中直接飞跃至该照片"
                  aria-label={`在时光长廊中定位：${photo.title}`}
                >
                  <Box className="h-4 w-4" />
                  <span>长廊定位</span>
                </button>
              </div>

              <div className="atlas-photo-caption">
                <div className="atlas-photo-title-row">
                  <h3>{photo.title}</h3>
                  <span>{photo.takenAtLocal.split(' ')[0]}</span>
                </div>
                <div className="atlas-photo-location">
                  <MapPin className="h-3 w-3" />
                  <span>{photo.locationName}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredPhotos.length === 0 && (
          <div className="atlas-grid-empty">
            <ImageIcon className="h-5 w-5" />
            <span>{photos.length === 0 ? '照片导入后，会在这里按时间展开。' : '换一个关键词，继续寻找。'}</span>
          </div>
        )}

        {filteredPhotos.length > 0 && (
          <nav className="atlas-pagination" aria-label="照片分页">
            <button
              type="button"
              onClick={() => setCurrentPage(Math.max(1, visiblePage - 1))}
              disabled={visiblePage === 1}
              className="atlas-page-arrow"
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
                  {needsEllipsis && <span className="atlas-page-ellipsis">···</span>}
                  <button
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={`atlas-page-number ${
                      page === visiblePage
                        ? 'is-current'
                        : ''
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
              className="atlas-page-arrow"
              title="下一页"
              aria-label="下一页"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        )}
      </div>
    </main>
  );
};
