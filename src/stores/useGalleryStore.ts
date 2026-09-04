import { create } from 'zustand';
import { PhotoItem, QualityTier, SpatialPosition, ViewMode } from '../types/gallery';
import { computeTunnelPositions, getActivePhotoAtZ } from '../utils/spatialMapping';

interface GalleryState {
  photos: PhotoItem[];
  positions: Map<string, SpatialPosition>;
  activePhoto: PhotoItem | null;
  selectedPhoto: PhotoItem | null;
  cameraZ: number;
  targetZ: number;
  minZ: number;
  maxZ: number;
  viewMode: ViewMode;
  qualityTier: QualityTier;
  isPlaying: boolean;
  activeYear: number;
  activeMonthSpan: string;
  isInitialLoading: boolean;
  loadingProgress: number;
  isWarping: boolean;
  isWarpRequested: boolean;
  isCorridorReady: boolean;
  warpFlash: number;

  // Actions
  setIsInitialLoading: (loading: boolean) => void;
  setLoadingProgress: (progress: number) => void;
  setIsWarping: (warping: boolean) => void;
  setIsWarpRequested: (requested: boolean) => void;
  setIsCorridorReady: (ready: boolean) => void;
  setWarpFlash: (flash: number) => void;
  setPhotos: (photos: PhotoItem[]) => void;
  setTargetZ: (z: number) => void;
  setCameraZ: (z: number) => void;
  setSelectedPhoto: (photo: PhotoItem | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setQualityTier: (tier: QualityTier) => void;
  togglePlay: () => void;
  jumpToYear: (year: number) => void;
  jumpToPhoto: (photoId: string) => void;
  fetchPhotos: () => Promise<void>;
}

function recalculateSpatialState(photos: PhotoItem[]) {
  if (!photos || photos.length === 0) {
    return {
      photos: [],
      positions: new Map<string, SpatialPosition>(),
      minZ: 0,
      maxZ: 12,
    };
  }

  const sorted = [...photos].sort((a, b) => b.takenAtSort - a.takenAtSort);
  const positions = computeTunnelPositions(sorted);

  let calculatedMinZ = 0;
  positions.forEach((pos) => {
    if (pos.z < calculatedMinZ) {
      calculatedMinZ = pos.z;
    }
  });
  const maxZ = 12;

  return {
    photos: sorted,
    positions,
    minZ: calculatedMinZ,
    maxZ,
  };
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  photos: [],
  positions: new Map<string, SpatialPosition>(),
  activePhoto: null,
  selectedPhoto: null,
  cameraZ: 12,
  targetZ: 12,
  minZ: 0,
  maxZ: 12,
  viewMode: 'tunnel',
  qualityTier: 'high',
  isPlaying: false,
  activeYear: new Date().getFullYear(),
  activeMonthSpan: '',
  isInitialLoading: true,
  loadingProgress: 0,
  isWarping: false,
  isWarpRequested: false,
  isCorridorReady: false,
  warpFlash: 0,

  setIsInitialLoading: (isInitialLoading: boolean) => set({ isInitialLoading }),
  setLoadingProgress: (loadingProgress: number) => set({ loadingProgress }),
  setIsWarping: (isWarping: boolean) => set({ isWarping }),
  setIsWarpRequested: (isWarpRequested: boolean) => set({ isWarpRequested }),
  setIsCorridorReady: (isCorridorReady: boolean) => set({ isCorridorReady }),
  setWarpFlash: (warpFlash: number) => set({ warpFlash }),

  setPhotos: (newPhotos: PhotoItem[]) => {
    const derived = recalculateSpatialState(newPhotos);
    const active = derived.photos[0] || null;
    const year = active ? new Date(active.takenAt).getFullYear() : new Date().getFullYear();
    const span = active
      ? `${new Date(active.takenAt).toLocaleString('en-US', { month: 'short' })} - ${new Date(active.takenAt).toLocaleString('en-US', { month: 'long' })}`
      : '';

    set({
      photos: derived.photos,
      positions: derived.positions,
      minZ: derived.minZ,
      maxZ: derived.maxZ,
      activePhoto: active,
      activeYear: year,
      activeMonthSpan: span,
    });
  },

  setTargetZ: (targetZ: number) => {
    const { photos, positions, minZ, maxZ } = get();
    if (!photos || photos.length === 0) {
      set({ targetZ });
      return;
    }

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

  fetchPhotos: async () => {
    try {
      const res = await fetch('/api/photos');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          get().setPhotos(data);
          return;
        }
      }
    } catch (err) {
      console.warn('API /api/photos 请求失败:', err);
      // 仅在本地开发调试环境下尝试动态异步加载 fallback，生产打包绝不静态泄露
      if (import.meta.env.DEV) {
        try {
          const fallback = await import('../data/photos.json');
          const data = fallback.default || fallback;
          if (Array.isArray(data) && data.length > 0) {
            get().setPhotos(data as PhotoItem[]);
          }
        } catch {}
      }
    }
  },
}));
