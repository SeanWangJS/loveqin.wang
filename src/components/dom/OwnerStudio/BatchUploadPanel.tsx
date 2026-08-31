import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { useGalleryStore } from '../../../stores/useGalleryStore';
import { PhotoItem } from '../../../types/gallery';

interface UploadItem {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'uploading' | 'processing' | 'ready' | 'error';
  progress: number;
  locationName: string;
  takenAtDate: string;
}

export const BatchUploadPanel: React.FC = () => {
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const newItems: UploadItem[] = [];

    Array.from(files).forEach((file) => {
      if (file.size > 50 * 1024 * 1024) {
        alert(`文件 ${file.name} 超过 50MB 限制`);
        return;
      }
      const previewUrl = URL.createObjectURL(file);
      newItems.push({
        id: 'upload_' + Math.random().toString(36).substring(2, 9),
        file,
        previewUrl,
        status: 'pending',
        progress: 0,
        locationName: '成都 · 锦江公园',
        takenAtDate: new Date().toISOString().slice(0, 10),
      });
    });

    setUploadQueue((prev) => [...prev, ...newItems]);
  };

  const startUpload = async () => {
    setIsProcessingAll(true);

    for (let i = 0; i < uploadQueue.length; i++) {
      const item = uploadQueue[i];
      if (item.status === 'ready') continue;

      // 模拟阶段 1: 直传上传阶段
      setUploadQueue((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'uploading', progress: 45 } : it))
      );
      await new Promise((r) => setTimeout(r, 400));

      // 模拟阶段 2: 图像处理与 EXIF 脱敏阶段
      setUploadQueue((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'processing', progress: 85 } : it))
      );
      await new Promise((r) => setTimeout(r, 400));

      // 模拟阶段 3: Ready 成功就绪
      setUploadQueue((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'ready', progress: 100 } : it))
      );

      // 注入全局长廊 Store
      const nowTs = new Date(item.takenAtDate).getTime() + Math.random() * 100000;
      const newPhotoItem: PhotoItem = {
        id: item.id,
        albumId: 'alb_01',
        urlThumbLow: item.previewUrl,
        urlThumbHigh: item.previewUrl,
        urlDisplay: item.previewUrl,
        takenAt: nowTs,
        takenAtSort: nowTs,
        takenAtLocal: new Date(nowTs).toISOString().slice(0, 19).replace('T', ' '),
        title: item.file.name.replace(/\.[^/.]+$/, ''),
        story: '刚刚在控制台上传的美好瞬间',
        locationName: item.locationName,
        width: 3840,
        height: 2160,
        likesCount: 0,
        isLiked: false,
        exif: {
          cameraModel: 'Sony Alpha 7 IV',
          lensModel: 'FE 24-70mm F2.8 GM II',
          iso: 100,
          focalLength: '35mm',
          aperture: 'f/2.8',
          shutterSpeed: '1/500s',
        },
      };

      useGalleryStore.setState({
        photos: [newPhotoItem, ...useGalleryStore.getState().photos],
      });
    }

    setIsProcessingAll(false);
  };

  return (
    <div className="space-y-6">
      {/* 拖拽上传区域 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition ${
          isDragging
            ? 'border-aurora-cyan bg-aurora-cyan/10'
            : 'border-white/20 hover:border-aurora-cyan/60 bg-void-bg/60'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="p-4 bg-aurora-cyan/10 text-aurora-cyan rounded-2xl mb-3">
          <UploadCloud size={32} />
        </div>
        <p className="text-sm font-medium text-white mb-1">
          点击选择或将照片拖拽至此处
        </p>
        <p className="text-xs text-gray-400 text-center max-w-sm">
          支持 JPEG、PNG、WebP、HEIC 格式 · 单图最大 50MB · 单批最多 200 张
        </p>
      </div>

      {/* 上传队列 */}
      {uploadQueue.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-300">
              待处理列表 ({uploadQueue.filter((i) => i.status === 'ready').length}/{uploadQueue.length})
            </span>
            <button
              onClick={startUpload}
              disabled={isProcessingAll || uploadQueue.every((i) => i.status === 'ready')}
              className="px-4 py-1.5 bg-aurora-cyan text-void-bg font-semibold rounded-lg text-xs hover:bg-aurora-cyan/90 transition shadow-lg shadow-aurora-cyan/20 disabled:opacity-40 flex items-center gap-1.5"
            >
              {isProcessingAll ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {isProcessingAll ? '正在处理上传...' : '开始处理入库'}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {uploadQueue.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 p-3 bg-void-surface/80 border border-white/10 rounded-xl"
              >
                <img
                  src={item.previewUrl}
                  alt={item.file.name}
                  className="w-12 h-12 rounded-lg object-cover border border-white/10 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-white font-medium truncate">{item.file.name}</span>
                    <span className="text-gray-400 text-[10px]">
                      {(item.file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>

                  {/* 状态指示条 */}
                  <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        item.status === 'ready'
                          ? 'bg-emerald-400'
                          : item.status === 'error'
                          ? 'bg-rose-500'
                          : 'bg-aurora-cyan'
                      }`}
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
                    <span>
                      {item.status === 'pending' && '等待处理'}
                      {item.status === 'uploading' && '正在直传 R2 存储...'}
                      {item.status === 'processing' && '多级 LOD 裁切与 EXIF 脱敏中...'}
                      {item.status === 'ready' && '✓ 处理完成已入库'}
                    </span>
                    {item.status === 'ready' && (
                      <span className="text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle2 size={10} /> 就绪
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
