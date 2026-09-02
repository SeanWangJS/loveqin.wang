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

  it('should keep chronological Z order with compact deterministic spacing', () => {
    const baseTime = Date.parse('2024-01-01T12:00:00Z');
    const photos: PhotoItem[] = [
      createMockPhoto('p1', baseTime),
      createMockPhoto('p2', baseTime + 50),
      createMockPhoto('p3', baseTime + 86400000),
      createMockPhoto('p4', baseTime + 365 * 86400000),
      createMockPhoto('p5', baseTime + 2 * 365 * 86400000),
    ];

    const positions = computeTunnelPositions(photos, { dMin: 3.5, zJitter: 0.12 });

    const p1 = positions.get('p1')!;
    const p2 = positions.get('p2')!;
    const p3 = positions.get('p3')!;
    const p4 = positions.get('p4')!;
    const p5 = positions.get('p5')!;

    expect(p1.z).toBe(0);
    expect(p1.z - p2.z).toBeGreaterThanOrEqual(3.5);
    expect(p1.z - p2.z).toBeLessThanOrEqual(3.5 * 1.12);
    expect(p2.z - p3.z).toBeGreaterThanOrEqual(3.5);
    expect(p2.z - p3.z).toBeLessThanOrEqual(3.5 * 1.12);
    expect(p3.z - p4.z).toBeGreaterThanOrEqual(3.5);
    expect(p3.z - p4.z).toBeLessThanOrEqual(3.5 * 1.12);
    expect(p4.z - p5.z).toBeGreaterThanOrEqual(3.5);
    expect(p4.z - p5.z).toBeLessThanOrEqual(3.5 * 1.12);
  });

  it('should ignore timestamp gaps when calculating Z spacing', () => {
    const baseTime = Date.parse('2024-01-01T12:00:00Z');
    const photos = [
      createMockPhoto('p1', baseTime),
      createMockPhoto('p2', baseTime + 1000),
      createMockPhoto('p3', baseTime + 10 * 86400000),
    ];
    const photosWithDifferentGaps = [
      createMockPhoto('p1', baseTime),
      createMockPhoto('p2', baseTime + 30 * 86400000),
      createMockPhoto('p3', baseTime + 31 * 86400000),
    ];

    const positions = computeTunnelPositions(photos);
    const positionsWithDifferentGaps = computeTunnelPositions(photosWithDifferentGaps);

    for (const photo of photos) {
      expect(positions.get(photo.id)!.z).toBe(positionsWithDifferentGaps.get(photo.id)!.z);
    }
  });

  it('should alternate sides (left/right) across the tunnel corridor and face toward the viewer', () => {
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

    expect(p1.rotationY).toBeGreaterThan(1.5);
    expect(p1.rotationY).toBeLessThan(1.7);
    expect(p2.rotationY).toBeLessThan(-1.5);
    expect(p2.rotationY).toBeGreaterThan(-1.7);
  });

  it('should make the nearest cards larger while keeping layout deterministic', () => {
    const baseTime = Date.parse('2024-01-01T12:00:00Z');
    const photos = [
      createMockPhoto('p1', baseTime),
      createMockPhoto('p2', baseTime + 1000),
      createMockPhoto('p3', baseTime + 2000),
      createMockPhoto('p4', baseTime + 3000),
      createMockPhoto('p5', baseTime + 4000),
      createMockPhoto('p6', baseTime + 5000),
      createMockPhoto('p7', baseTime + 6000),
    ];

    const positions = computeTunnelPositions(photos);
    const repeatPositions = computeTunnelPositions(photos);

    expect(positions.get('p1')!.scale).toBeGreaterThan(positions.get('p7')!.scale);
    expect(positions.get('p1')!.scale).toBe(repeatPositions.get('p1')!.scale);
    expect(positions.get('p1')!.rotationY).toBe(repeatPositions.get('p1')!.rotationY);
  });

  it('should distribute cards across a safe X range deterministically', () => {
    const baseTime = Date.parse('2024-01-01T12:00:00Z');
    const photos = [
      createMockPhoto('p1', baseTime),
      createMockPhoto('p2', baseTime + 1000),
      createMockPhoto('p3', baseTime + 2000),
      createMockPhoto('p4', baseTime + 3000),
    ];

    const positions = computeTunnelPositions(photos);
    const repeatPositions = computeTunnelPositions(photos);

    for (const photo of photos) {
      const position = positions.get(photo.id)!;
      expect(Math.abs(position.x)).toBeGreaterThanOrEqual(4.55);
      expect(Math.abs(position.x)).toBeLessThanOrEqual(6.45);
      expect(position.x).toBe(repeatPositions.get(photo.id)!.x);
    }

    expect(new Set(photos.map((photo) => positions.get(photo.id)!.x)).size).toBeGreaterThan(2);
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
