import React, { useEffect } from 'react';
import { X, Heart, MapPin, Calendar, Camera, Aperture, Clock, Zap, Download } from 'lucide-react';
import { useGalleryStore } from '../../stores/useGalleryStore';

export const PhotoDetailModal: React.FC = () => {
  const selectedPhoto = useGalleryStore((s) => s.selectedPhoto);
  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);

  // 监听 Esc 键平滑退出详情
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedPhoto(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSelectedPhoto]);

  if (!selectedPhoto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-xl animate-fade-in">
      {/* 背景点击关闭遮罩 */}
      <div
        className="absolute inset-0"
        onClick={() => setSelectedPhoto(null)}
      />

      {/* 弹窗主体 */}
      <div className="relative z-10 max-w-5xl w-full max-h-[90vh] glass-panel-glow rounded-2xl overflow-hidden flex flex-col lg:flex-row shadow-[0_0_50px_rgba(0,0,0,0.9)]">
        {/* 左侧/上方超清大图展示 */}
        <div className="flex-1 bg-black/60 flex items-center justify-center relative min-h-[300px] lg:min-h-[500px]">
          <img
            src={selectedPhoto.urlDisplay}
            alt={selectedPhoto.title}
            className="max-h-[75vh] w-auto max-w-full object-contain"
          />
        </div>

        {/* 右侧信息与故事面板 */}
        <div className="w-full lg:w-96 p-6 flex flex-col justify-between bg-void-900/90 border-t lg:border-t-0 lg:border-l border-aurora-cyan/20 overflow-y-auto">
          <div>
            {/* 顶部标题与关闭按钮 */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold text-white tracking-tight">
                  {selectedPhoto.title}
                </h3>
                <div className="flex items-center text-xs text-aurora-cyan mt-1 space-x-1">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{selectedPhoto.locationName}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedPhoto(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-all"
                title="关闭详情 (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 拍摄时间 */}
            <div className="flex items-center text-xs text-slate-400 mt-3 space-x-1.5 font-mono">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>{selectedPhoto.takenAtLocal}</span>
            </div>

            {/* 记忆故事与配文 */}
            <div className="mt-4 p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 text-sm text-slate-300 leading-relaxed">
              <p>{selectedPhoto.story}</p>
            </div>

            {/* 相机参数与 EXIF 信息 */}
            <div className="mt-5">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2 flex items-center space-x-1">
                <Camera className="w-3.5 h-3.5 text-aurora-cyan" />
                <span>EXIF METADATA</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded-lg bg-slate-900/40 border border-slate-800">
                  <div className="text-slate-500 text-[10px]">相机型号</div>
                  <div className="text-slate-200 truncate">{selectedPhoto.exif.cameraModel || 'Sony A7R V'}</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/40 border border-slate-800">
                  <div className="text-slate-500 text-[10px]">镜头焦段</div>
                  <div className="text-slate-200 truncate">{selectedPhoto.exif.focalLength || '35mm'}</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/40 border border-slate-800 flex items-center space-x-1.5">
                  <Aperture className="w-3.5 h-3.5 text-aurora-teal" />
                  <div>
                    <div className="text-slate-500 text-[10px]">光圈</div>
                    <div className="text-slate-200">{selectedPhoto.exif.aperture}</div>
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/40 border border-slate-800 flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5 text-aurora-cyan" />
                  <div>
                    <div className="text-slate-500 text-[10px]">快门速度</div>
                    <div className="text-slate-200">{selectedPhoto.exif.shutterSpeed}</div>
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/40 border border-slate-800 flex items-center space-x-1.5">
                  <Zap className="w-3.5 h-3.5 text-aurora-gold" />
                  <div>
                    <div className="text-slate-500 text-[10px]">ISO 感光度</div>
                    <div className="text-slate-200">ISO {selectedPhoto.exif.iso}</div>
                  </div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/40 border border-slate-800">
                  <div className="text-slate-500 text-[10px]">色彩空间</div>
                  <div className="text-slate-200">{selectedPhoto.exif.colorSpace}</div>
                </div>
              </div>
            </div>
          </div>

          {/* 底部轻互动与下载原图 */}
          <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
            <button
              onClick={() => alert(`已为「${selectedPhoto.title}」点亮回忆微光！`)}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-pink-500/10 border border-pink-500/30 text-pink-400 hover:bg-pink-500/20 transition-all text-xs font-medium"
            >
              <Heart className="w-4 h-4 fill-pink-500 text-pink-500" />
              <span>点亮回忆 ({selectedPhoto.likesCount})</span>
            </button>

            <button
              onClick={() => alert('Member 权限验证通过：正在生成 5 分钟专属预签名原图下载链接...')}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-xl glass-panel hover:bg-slate-800 text-slate-300 hover:text-white transition-all text-xs"
              title="下载全高清原图"
            >
              <Download className="w-4 h-4 text-aurora-cyan" />
              <span>下载原图</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
