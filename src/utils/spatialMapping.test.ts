import { describe, it, expect } from 'vitest';
import { computeTunnelPositions, getActivePhotoAtZ } from './spatialMapping';
import { PhotoItem } from '../types/gallery';

describe('Spatial Mapping Algorithm', () => {
  const createMockPhoto = (id: string, timestamp: number): PhotoItem => ({
    id,
    albumId: 'default',
    title: `Photo ${id}`,
    story: `Story for ${id}`,
    takenAt: timestamp,
    takenAtSort: timestamp,
    takenAtLocal: new Date(timestamp).toISOString(),
    locationName: 'Test Location',
    width: 1920,
    height: 1080,
    urlThumbLow: '',
    urlThumbHigh: '',
    urlDisplay: '',
    exif: {},
    likesCount: 0,
  });

  it('should guarantee strictly monotonic decreasing Z coordinates with minimum spacing', () => {
    const baseTime = Date.parse('2024-01-01T12:00:00Z');
    const photos: PhotoItem[] = [
      createMockPhoto('p1', baseTime),
      createMockPhoto('p2', baseTime + 50),
      createMockPhoto('p3', baseTime + 100),
      createMockPhoto('p4', baseTime + 86400000),
      createMockPhoto('p5', baseTime + 365 * 86400000),
    ];

    const positions = computeTunnelPositions(photos, { dMin: 3.5, alpha: 2.5 });

    const p1 = positions.get('p1')!;
    const p2 = positions.get('p2')!;
    const p3 = positions.get('p3')!;
    const p4 = positions.get('p4')!;
    const p5 = positions.get('p5')!;

    expect(p1.z).toBe(0);
    expect(p1.z - p2.z).toBeGreaterThanOrEqual(3.5);
    expect(p2.z - p3.z).toBeGreaterThanOrEqual(3.5);
    expect(p3.z - p4.z).toBeGreaterThan(p2.z - p3.z);

    const yearGapZ = p4.z - p5.z;
    expect(yearGapZ).toBeGreaterThan(p3.z - p4.z);
    expect(yearGapZ).toBeLessThan(50);
  });

  it('should alternate sides (left/right) across the tunnel corridor and face inward', () => {
    const baseTime = Date.parse('2024-01-01T12:00:00Z');
    const photos = [
      createMockPhoto('p1', baseTime),
      createMockPhoto('p2', baseTime + 1000),
      createMockPhoto('p3', baseTime + 2000),
      createMockPhoto('p4', baseTime + 3000),
    ];

    const positions = computeTunnelPositions(photos, { channelWidth: 4.0 });

    const p1 = positions.get('p1')!;
    const p2 = positions.get('p2')!;

    expect(p1.x).toBeLessThan(-3.0); // Left
    expect(p2.x).toBeGreaterThan(3.0); // Right

    // Left wall photos should rotate +Y inward toward corridor centerline
    expect(p1.rotationY).toBeGreaterThan(0.25);
    // Right wall photos should rotate -Y inward toward corridor centerline
    expect(p2.rotationY).toBeLessThan(-0.25);
  });

  it('should find the active photo corresponding to camera Z position', () => {
    const baseTime = Date.parse('2024-01-01T12:00:00Z');
    const photos = [
      createMockPhoto('p1', baseTime),
      createMockPhoto('p2', baseTime + 86400000),
      createMockPhoto('p3', baseTime + 2 * 86400000),
    ];

    const positions = computeTunnelPositions(photos, { dMin: 4 });
    const p2Z = positions.get('p2')!.z;

    const active = getActivePhotoAtZ(photos, positions, p2Z + 10);
    expect(active?.id).toBe('p2');
  });
});
