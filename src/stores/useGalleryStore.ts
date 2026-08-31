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
  minZ: number;
  maxZ: number;
  viewMode: ViewMode;
  qualityTier: QualityTier;
  isPlaying: boolean;
  activeYear: number;
  activeMonthSpan: string;

  // Actions
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

const initialPhotos = generateMockPhotos(500);
const initialDerived = recalculateSpatialState(initialPhotos);
const initialActive = initialDerived.photos[0];

const date0 = new Date(initialActive.takenAt);
const initialYear = date0.getFullYear();
const initialMonthSpan = `${date0.toLocaleString('en-US', { month: 'short' })} - ${date0.toLocaleString('en-US', { month: 'long' })}`;

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

  setPhotos: (newPhotos: PhotoItem[]) => {
    const derived = recalculateSpatialState(newPhotos);
    set({
      photos: derived.photos,
      positions: derived.positions,
      minZ: derived.minZ,
      maxZ: derived.maxZ,
    });
  },

  setTargetZ: (targetZ: number) => {
    const { photos, positions, minZ, maxZ } = get();
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
