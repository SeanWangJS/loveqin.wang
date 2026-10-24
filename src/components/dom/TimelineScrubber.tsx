import React, { useEffect, useRef } from 'react';
import { useGalleryStore } from '../../stores/useGalleryStore';

export const TimelineScrubber: React.FC = () => {
  const activeYear = useGalleryStore((s) => s.activeYear);
  const photos = useGalleryStore((s) => s.photos);
  const jumpToYear = useGalleryStore((s) => s.jumpToYear);
  const timelineRef = useRef<HTMLElement>(null);
  const activeYearRef = useRef<HTMLButtonElement>(null);
  const years = Array.from(
    new Set(photos.map((photo) => new Date(photo.takenAt).getFullYear()))
  ).sort((a, b) => a - b);
  const timelineYears = years.length > 0 ? years : [activeYear];

  useEffect(() => {
    const timeline = timelineRef.current;
    const activeButton = activeYearRef.current;
    if (!timeline || !activeButton) return;

    const timelineBounds = timeline.getBoundingClientRect();
    const buttonBounds = activeButton.getBoundingClientRect();
    const centerOffset = buttonBounds.left - timelineBounds.left + timeline.scrollLeft
      + buttonBounds.width / 2 - timeline.clientWidth / 2;
    timeline.scrollTo({ left: Math.max(0, centerOffset), behavior: 'smooth' });
  }, [activeYear, timelineYears.length]);

  return (
    <footer ref={timelineRef} className="atlas-timeline" aria-label="按年份浏览照片">
      <div className="atlas-timeline-track">
        {timelineYears.map((year) => {
          const isActive = year === activeYear;

          return (
            <button
              type="button"
              key={year}
              ref={isActive ? activeYearRef : undefined}
              onClick={() => jumpToYear(year)}
              className={`atlas-year-button ${isActive ? 'is-current' : ''}`}
              aria-current={isActive ? 'date' : undefined}
              aria-label={`${year} 年照片`}
            >
              <span className="atlas-year-dot" aria-hidden="true" />
              <span>{year}</span>
            </button>
          );
        })}
      </div>
    </footer>
  );
};
