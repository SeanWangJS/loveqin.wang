export type ViewMode = 'tunnel' | 'grid' | 'galaxy';
export type QualityTier = 'high' | 'medium' | 'low';

export interface ExifSafeData {
  cameraModel?: string;
  lensModel?: string;
  focalLength?: string;
  aperture?: string;
  shutterSpeed?: string;
  iso?: number;
  colorSpace?: string;
}

export interface PhotoItem {
  id: string;
  albumId: string;
  title: string;
  story: string;
  takenAt: number; // Unix timestamp in ms
  takenAtSort: number;
  takenAtLocal: string;
  locationName: string;
  width: number;
  height: number;
  urlThumbLow: string;
  urlThumbHigh: string;
  urlDisplay: string;
  exif: ExifSafeData;
  likesCount: number;
  isLiked?: boolean;
}

export interface SpatialPosition {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotationY: number;
  rotationX: number;
  rotationZ: number;
}
