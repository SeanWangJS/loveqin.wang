import { describe, it, expect } from 'vitest';
import { buildDeterministicGhostMap } from './ghostShuffle';
import { PhotoItem } from '../types/gallery';

describe('Deterministic Ghost Shuffle Algorithm', () => {
  const createMockPhotos = (count: number): PhotoItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `photo-${i + 1}`,
      albumId: 'default',
      title: `Photo ${i + 1}`,
      story: `Story ${i + 1}`,
      takenAt: 1704067200000 + i * 86400000,
      takenAtSort: 1704067200000 + i * 86400000,
      takenAtLocal: new Date(1704067200000 + i * 86400000).toISOString(),
      locationName: 'Location',
      width: 1920,
      height: 1080,
      urlThumbLow: '',
      urlThumbHigh: '',
      urlDisplay: '',
      exif: {},
      likesCount: 0,
    }));

  it('should return empty map for empty photo list', () => {
    const map = buildDeterministicGhostMap([]);
    expect(map.size).toBe(0);
  });

  it('should fallback gracefully when only 1 photo exists', () => {
    const photos = createMockPhotos(1);
    const map = buildDeterministicGhostMap(photos, 9);
    expect(map.get('photo-1')?.length).toBe(9);
    expect(map.get('photo-1')?.[0].id).toBe('photo-1');
  });

  it('should select distinct photos without repeating itself when N >= 10', () => {
    const photos = createMockPhotos(15);
    const map = buildDeterministicGhostMap(photos, 9);

    for (const photo of photos) {
      const ghosts = map.get(photo.id)!;
      expect(ghosts.length).toBe(9);

      // 保证 9 张虚影全都不等于主照片自身
      for (const ghost of ghosts) {
        expect(ghost.id).not.toBe(photo.id);
      }

      // 保证 9 张虚影互不相同
      const ghostIds = ghosts.map((g) => g.id);
      const uniqueIds = new Set(ghostIds);
      expect(uniqueIds.size).toBe(9);
    }
  });

  it('should be 100% deterministic across multiple runs', () => {
    const photos = createMockPhotos(20);
    const mapA = buildDeterministicGhostMap(photos, 9);
    const mapB = buildDeterministicGhostMap(photos, 9);

    for (const photo of photos) {
      const ghostsA = mapA.get(photo.id)!.map((g) => g.id);
      const ghostsB = mapB.get(photo.id)!.map((g) => g.id);
      expect(ghostsA).toEqual(ghostsB);
    }
  });
});
