import React, { useEffect, useState } from 'react';
import { X, Heart, MapPin, Calendar, Camera, Aperture, Clock, Zap, Download, Edit3, Save, Loader2 } from 'lucide-react';
import { useGalleryStore } from '../../stores/useGalleryStore';

export const PhotoDetailModal: React.FC = () => {
  const selectedPhoto = useGalleryStore((s) => s.selectedPhoto);
  const setSelectedPhoto = useGalleryStore((s) => s.setSelectedPhoto);
  const updatePhotoStory = useGalleryStore((s) => s.updatePhotoStory);
  const isInitialLoading = useGalleryStore((s) => s.isInitialLoading);
  const isWarping = useGalleryStore((s) => s.isWarping);
  const [isEditingStory, setIsEditingStory] = useState(false);
  const [storyDraft, setStoryDraft] = useState('');
  const [isSavingStory, setIsSavingStory] = useState(false);
  const [storyError, setStoryError] = useState('');

  useEffect(() => {
    setStoryDraft(selectedPhoto?.story || '');
    setIsEditingStory(false);
    setStoryError('');
  }, [selectedPhoto?.id, selectedPhoto?.story]);

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

  if (!selectedPhoto || isInitialLoading || isWarping) return null;

  const handleSaveStory = async () => {
    setIsSavingStory(true);
    setStoryError('');
    try {
      await updatePhotoStory(selectedPhoto.id, storyDraft);
      setIsEditingStory(false);
    } catch (error) {
      setStoryError(error instanceof Error ? error.message : '照片故事保存失败，请稍后重试');
    } finally {
      setIsSavingStory(false);
    }
  };

  return (
    <div className="atlas-modal-overlay">
      {/* 背景点击关闭遮罩 */}
      <div
        className="absolute inset-0"
        onClick={() => setSelectedPhoto(null)}
      />

      {/* 弹窗主体 */}
      <section className="atlas-modal">
        <div className="atlas-modal-image">
          <img
            src={selectedPhoto.urlDisplay}
            alt={selectedPhoto.title}
            className="atlas-modal-photo"
          />
        </div>

        <div className="atlas-modal-details">
          <div>
            <div className="atlas-modal-title-row">
              <div>
                <span className="atlas-eyebrow">A MOMENT IN TIME</span>
                <h3 className="atlas-modal-title">
                  {selectedPhoto.title}
                </h3>
                <div className="atlas-modal-location">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>{selectedPhoto.locationName}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedPhoto(null)}
                className="atlas-modal-close"
                title="关闭详情 (Esc)"
                aria-label="关闭照片详情"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="atlas-modal-date">
              <Calendar className="h-3.5 w-3.5" />
              <span>{selectedPhoto.takenAtLocal}</span>
            </div>

            <div className="atlas-story-section">
              <div className="atlas-story-heading">
                <span>照片故事</span>
                {!isEditingStory && (
                  <button
                    type="button"
                    onClick={() => setIsEditingStory(true)}
                    className="atlas-story-edit"
                    title="编辑照片故事"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>编辑</span>
                  </button>
                )}
              </div>
              {isEditingStory ? (
                <>
                  <textarea
                    value={storyDraft}
                    onChange={(event) => setStoryDraft(event.target.value)}
                    maxLength={10000}
                    rows={6}
                    autoFocus
                    className="atlas-story-editor"
                    aria-label="照片故事"
                  />
                  <div className="atlas-story-actions">
                    <span>{storyDraft.length}/10000</span>
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          setStoryDraft(selectedPhoto.story || '');
                          setStoryError('');
                          setIsEditingStory(false);
                        }}
                        disabled={isSavingStory}
                        className="atlas-text-button"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveStory}
                        disabled={isSavingStory}
                        className="atlas-save-button"
                      >
                        {isSavingStory ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        <span>保存</span>
                      </button>
                    </div>
                  </div>
                  {storyError && <p className="atlas-story-error">{storyError}</p>}
                </>
              ) : (
                <p className="atlas-story-copy">{selectedPhoto.story || '还没有写下这张照片的故事。'}</p>
              )}
            </div>

            <div className="atlas-exif-section">
              <div className="atlas-exif-heading">
                <Camera className="h-3.5 w-3.5" />
                <span>拍摄信息</span>
              </div>
              <div className="atlas-exif-grid">
                <div>
                  <span>相机型号</span>
                  <strong>{selectedPhoto.exif.cameraModel || 'Sony A7R V'}</strong>
                </div>
                <div>
                  <span>镜头焦段</span>
                  <strong>{selectedPhoto.exif.focalLength || '35mm'}</strong>
                </div>
                <div>
                  <Aperture className="h-3.5 w-3.5" />
                  <span>光圈</span>
                  <strong>{selectedPhoto.exif.aperture || '未记录'}</strong>
                </div>
                <div>
                  <Clock className="h-3.5 w-3.5" />
                  <span>快门速度</span>
                  <strong>{selectedPhoto.exif.shutterSpeed || '未记录'}</strong>
                </div>
                <div>
                  <Zap className="h-3.5 w-3.5" />
                  <span>ISO 感光度</span>
                  <strong>{selectedPhoto.exif.iso ? `ISO ${selectedPhoto.exif.iso}` : '未记录'}</strong>
                </div>
                <div>
                  <span>色彩空间</span>
                  <strong>{selectedPhoto.exif.colorSpace || '未记录'}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="atlas-modal-footer">
            <div className="atlas-like-count" title="回忆微光 (只读视图)">
              <Heart className="h-4 w-4" />
              <span>回忆微光 ({selectedPhoto.likesCount})</span>
            </div>

            <a
              href={`/api/photos/${selectedPhoto.id}/download`}
              download={selectedPhoto.originalFilename || `${selectedPhoto.title}.jpg`}
              target="_blank"
              rel="noopener noreferrer"
              className="atlas-download-button"
              title="下载全高清私密原图"
            >
              <Download className="h-4 w-4" />
              <span>下载原图</span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};
