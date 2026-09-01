import React from 'react';
import { useGalleryStore } from '../../stores/useGalleryStore';

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026, 2027];

/**
 * 概念设计图同款：【极简悬浮光纤时光轴 + 当前年份独立发光圆环徽标 (Active Ring Badge)】
 */
export const TimelineScrubber: React.FC = () => {
  const activeYear = useGalleryStore((s) => s.activeYear);
  const jumpToYear = useGalleryStore((s) => s.jumpToYear);

  return (
    <footer className="fixed bottom-8 left-0 right-0 z-30 flex items-center justify-center px-4 pointer-events-none select-none">
      <div className="relative flex items-center justify-between max-w-3xl w-full pointer-events-auto px-6">
        {/* 贯穿左右的极简微光光纤线（左右渐变淡出） */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1.5px] bg-gradient-to-r from-transparent via-sky-400/50 to-transparent shadow-[0_0_10px_rgba(56,189,248,0.6)]" />

        {YEARS.map((year) => {
          const isActive = year === activeYear;

          return (
            <div
              key={year}
              onClick={() => jumpToYear(year)}
              className="relative z-10 flex flex-col items-center cursor-pointer group py-2"
            >
              {isActive ? (
                /* 概念图标志性设计：【2024 独立发光双重圆环徽标】 */
                <div className="relative -my-4 flex items-center justify-center">
                  {/* 最外层发光晕轮 */}
                  <div className="absolute w-20 h-20 rounded-full bg-sky-400/20 animate-pulse blur-sm" />
                  {/* 发光主圆环 */}
                  <div className="w-14 h-14 rounded-full border-2 border-sky-400 flex items-center justify-center bg-[#070c14]/90 shadow-[0_0_24px_rgba(56,189,248,0.7)] backdrop-blur-md transition-transform transform scale-105">
                    <span className="text-sm font-extrabold text-white font-mono tracking-tight drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]">
                      {year}
                    </span>
                  </div>
                </div>
              ) : (
                /* 非激活年份：中央发光小光斑 + 下方年份文本 */
                <div className="flex flex-col items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-sky-400/70 border border-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.8)] group-hover:scale-150 group-hover:bg-white transition-all" />
                  <span className="mt-3 text-xs font-mono text-slate-400 group-hover:text-slate-200 transition-colors">
                    {year}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </footer>
  );
};
