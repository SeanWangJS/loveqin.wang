import { create } from 'zustand';
import { PhotoItem, QualityTier, SpatialPosition, ViewMode } from '../types/gallery';
import { computeTunnelPositions, getActivePhotoAtZ } from '../utils/spatialMapping';
import { generateMockPhotos } from '../mock/mockPhotos';

interface GalleryState {
  photos: PhotoItem[];
  positions: Map<string, SpatialPosition>;
  activePhoto: PhotoItem | null;
  selectedPhoto: PhotoItem | null;
  cameraZ: number;
  targetZ: number;
  minZ: number; // 最深处照片 Z 坐标 (如 -1800)
  maxZ: number; // 最前端照片 Z 坐标 (如 10)
  viewMode: ViewMode;
  qualityTier: QualityTier;
  isPlaying: boolean;
  activeYear: number;
  activeMonthSpan: string;

  // Actions
  setTargetZ: (z: number) => void;
  setCameraZ: (z: number) => void;
  setSelectedPhoto: (photo: PhotoItem | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setQualityTier: (tier: QualityTier) => void;
  togglePlay: () => void;
  jumpToYear: (year: number) => void;
  jumpToPhoto: (photoId: string) => void;
}

const initialPhotos = generateMockPhotos(500);
const initialPositions = computeTunnelPositions(initialPhotos);
const initialActive = initialPhotos[0];

// 计算边界 Z 坐标
let calculatedMinZ = 0;
initialPositions.forEach((pos) => {
  if (pos.z < calculatedMinZ) {
    calculatedMinZ = pos.z;
  }
});
const initialMaxZ = 12;

const date0 = new Date(initialActive.takenAt);
const initialYear = date0.getFullYear();
const initialMonthSpan = `${date0.toLocaleString('en-US', { month: 'short' })} - ${date0.toLocaleString('en-US', { month: 'long' })}`;

export const useGalleryStore = create<GalleryState>((set, get) => ({
  photos: initialPhotos,
  positions: initialPositions,
  activePhoto: initialActive,
  selectedPhoto: null,
  cameraZ: initialMaxZ,
  targetZ: initialMaxZ,
  minZ: calculatedMinZ,
  maxZ: initialMaxZ,
  viewMode: 'tunnel',
  qualityTier: 'high',
  isPlaying: false,
  activeYear: initialYear,
  activeMonthSpan: initialMonthSpan,

  setTargetZ: (targetZ: number) => {
    const { photos, positions, minZ, maxZ } = get();
    // 严格限制在照片纵深有效范围内，杜绝“跑飞黑屏”
    const clampedTargetZ = Math.min(maxZ + 2, Math.max(minZ - 5, targetZ));

    const active = getActivePhotoAtZ(photos, positions, clampedTargetZ);
    if (active) {
      const d = new Date(active.takenAt);
      const year = d.getFullYear();
      const month = d.toLocaleString('en-US', { month: 'short' });
      set({
        targetZ: clampedTargetZ,
        activePhoto: active,
        activeYear: year,
        activeMonthSpan: `${month} · ${d.getDate()}日`,
      });
    } else {
      set({ targetZ: clampedTargetZ });
    }
  },

  setCameraZ: (cameraZ: number) => set({ cameraZ }),

  setSelectedPhoto: (selectedPhoto) => set({ selectedPhoto }),

  setViewMode: (viewMode) => set({ viewMode }),

  setQualityTier: (qualityTier) => set({ qualityTier }),

  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),

  jumpToYear: (year: number) => {
    const { photos, positions } = get();
    const targetPhoto = photos.find((p) => new Date(p.takenAt).getFullYear() === year);
    if (targetPhoto) {
      const pos = positions.get(targetPhoto.id);
      if (pos) {
        get().setTargetZ(pos.z + 10);
      }
    }
  },

  jumpToPhoto: (photoId: string) => {
    const { positions } = get();
    const pos = positions.get(photoId);
    if (pos) {
      get().setTargetZ(pos.z + 10);
    }
  },
}));
