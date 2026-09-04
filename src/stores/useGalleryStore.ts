import { create } from 'zustand';
import { PhotoItem, QualityTier, SpatialPosition, ViewMode } from '../types/gallery';
import { computeTunnelPositions, getActivePhotoAtZ } from '../utils/spatialMapping';
import realPhotosData from '../data/photos.json';

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

// 彻底切断对 500 张 Mock 模拟照片的依赖，完全由真实相册数据驱动
const realPhotos = Array.isArray(realPhotosData) && realPhotosData.length > 0
  ? (realPhotosData as PhotoItem[])
  : [];

const initialDerived = recalculateSpatialState(realPhotos);
const initialActive = initialDerived.photos[0] || null;

const initialYear = initialActive
  ? new Date(initialActive.takenAt).getFullYear()
  : new Date().getFullYear();

const initialMonthSpan = initialActive
  ? `${new Date(initialActive.takenAt).toLocaleString('en-US', { month: 'short' })} - ${new Date(initialActive.takenAt).toLocaleString('en-US', { month: 'long' })}`
  : '';

export const useGalleryStore = create<GalleryState>((set, get) => ({
  photos: initialDerived.photos,
  positions: initialDerived.positions,
  activePhoto: initialActive,
  selectedPhoto: null,
  cameraZ: initialDerived.maxZ,
  targetZ: initialDerived.maxZ,
  minZ: initialDerived.minZ,
  maxZ: initialDerived.maxZ,
  viewMode: 'tunnel',
  qualityTier: 'high',
  isPlaying: false,
  activeYear: initialYear,
  activeMonthSpan: initialMonthSpan,
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
}));
