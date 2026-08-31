import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useGalleryStore } from '../../stores/useGalleryStore';

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

export const TimelineScrubber: React.FC = () => {
  const activeYear = useGalleryStore((s) => s.activeYear);
  const jumpToYear = useGalleryStore((s) => s.jumpToYear);

  const handlePrevYear = () => {
    const currentIndex = YEARS.indexOf(activeYear);
    if (currentIndex > 0) {
      jumpToYear(YEARS[currentIndex - 1]);
    }
  };

  const handleNextYear = () => {
    const currentIndex = YEARS.indexOf(activeYear);
    if (currentIndex < YEARS.length - 1) {
      jumpToYear(YEARS[currentIndex + 1]);
    }
  };

  return (
    <footer className="fixed bottom-6 left-0 right-0 z-30 flex items-center justify-center px-4 pointer-events-none">
      <div className="glass-panel px-6 py-3 rounded-full flex items-center space-x-6 sm:space-x-8 pointer-events-auto border border-aurora-cyan/30 shadow-[0_0_30px_rgba(0,0,0,0.8)] max-w-2xl w-full justify-between">
        {/* 左箭头 */}
        <button
          onClick={handlePrevYear}
          disabled={activeYear <= YEARS[0]}
          className="p-1.5 rounded-full hover:bg-slate-800/80 text-slate-400 hover:text-aurora-cyan disabled:opacity-30 disabled:hover:text-slate-400 transition-all"
          title="回溯上一年"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {/* 年份刻度与发光同心圆轨 */}
        <div className="flex-1 relative flex items-center justify-between mx-2 sm:mx-6">
          {/* 背景贯穿光轨细线 */}
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-slate-700/60" />
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] bg-aurora-cyan/30 shadow-[0_0_8px_rgba(56,189,248,0.5)]" />

          {YEARS.map((year) => {
            const isActive = year === activeYear;

            return (
              <div
                key={year}
                onClick={() => jumpToYear(year)}
                className="relative z-10 flex flex-col items-center cursor-pointer group"
              >
                {/* 节点外形：激活态为同心圆环，普通态为小光点 */}
                <div className="flex items-center justify-center h-8">
                  {isActive ? (
                    <div className="relative flex items-center justify-center">
                      {/* 最外层微光光晕 */}
                      <div className="absolute w-10 h-10 rounded-full bg-aurora-cyan/20 animate-pulse" />
                      {/* 同心发光外圆环 */}
                      <div className="w-8 h-8 rounded-full border-2 border-aurora-cyan flex items-center justify-center bg-void-950/90 shadow-[0_0_15px_rgba(56,189,248,0.8)]">
                        {/* 内部小实心点 */}
                        <div className="w-2.5 h-2.5 rounded-full bg-aurora-ice shadow-[0_0_8px_#38bdf8]" />
                      </div>
                    </div>
                  ) : (
                    <div className="w-3 h-3 rounded-full bg-slate-600 border border-slate-500 group-hover:bg-aurora-cyan group-hover:border-aurora-ice group-hover:shadow-[0_0_8px_#38bdf8] transition-all" />
                  )}
                </div>

                {/* 年份文本 */}
                <span
                  className={`mt-1 text-xs font-mono transition-all ${
                    isActive
                      ? 'text-aurora-cyan font-bold scale-110 drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]'
                      : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                >
                  {year}
                </span>
              </div>
            );
          })}
        </div>

        {/* 右箭头 */}
        <button
          onClick={handleNextYear}
          disabled={activeYear >= YEARS[YEARS.length - 1]}
          className="p-1.5 rounded-full hover:bg-slate-800/80 text-slate-400 hover:text-aurora-cyan disabled:opacity-30 disabled:hover:text-slate-400 transition-all"
          title="推进下一年"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </footer>
  );
};
