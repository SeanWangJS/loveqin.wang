import { describe, expect, it } from 'vitest';
import { PhotoItem, SpatialPosition } from '../types/gallery';
import {
  getStoryAnimationState,
  getStoryTriggerZ,
  isNormalForwardMotion,
  getStoryLayerPosition,
  getStoryOpacity,
  getStoryPreview,
  hasMeaningfulStory,
  selectNearestStoryPhoto,
} from './storyLayer';

function createPhoto(id: string, story: string): PhotoItem {
  return { id, story } as PhotoItem;
}

function createPosition(z: number): SpatialPosition {
  return { x: 1, y: 2, z, scale: 1.5, rotationX: 0, rotationY: 0, rotationZ: 0 };
}

describe('story layer rules', () => {
  it('only accepts meaningful user stories', () => {
    expect(hasMeaningfulStory('')).toBe(false);
    expect(hasMeaningfulStory('   ')).toBe(false);
    expect(hasMeaningfulStory('记录温暖而珍贵的时光回忆')).toBe(false);
    expect(hasMeaningfulStory('拍摄器材: Sony A7')).toBe(false);
    expect(hasMeaningfulStory('拍摄器材：Sony A7')).toBe(false);
    expect(hasMeaningfulStory('那天的风很轻，我们在湖边待到日落。')).toBe(true);
  });

  it('wraps and clips previews without changing the full story', () => {
    expect(getStoryPreview('春天的第一场雨\n我们一起走回家')).toBe('春天的第一场雨\n我们一起走回家');
    expect(getStoryPreview('123456789', 7, 1, 7)).toBe('123456…');
  });

  it('uses a smooth bounded opacity curve around the focus', () => {
    expect(getStoryOpacity(8)).toBe(1);
    expect(getStoryOpacity(24)).toBe(0);
    expect(getStoryOpacity(16)).toBeGreaterThan(0);
    expect(getStoryOpacity(16)).toBeLessThan(1);
  });

  it('uses the rendered story depth for the trigger line', () => {
    expect(getStoryTriggerZ(-12)).toBeCloseTo(1.5);
  });

  it('plays a fixed enter, hold, and dissolve timeline', () => {
    expect(getStoryAnimationState(0).phase).toBe('entering');
    expect(getStoryAnimationState(0.72)).toEqual({ phase: 'holding', opacity: 1, dissolveProgress: 0 });
    expect(getStoryAnimationState(1.82)).toEqual({ phase: 'dissolving', opacity: 1, dissolveProgress: 0 });
    expect(getStoryAnimationState(2.345).dissolveProgress).toBeCloseTo(0.5);
    expect(getStoryAnimationState(2.87)).toEqual({ phase: 'completed', opacity: 0, dissolveProgress: 1 });
  });

  it('only allows normal forward motion to trigger stories', () => {
    expect(isNormalForwardMotion(0, -0.2, 1 / 60)).toBe(true);
    expect(isNormalForwardMotion(0, 0.2, 1 / 60)).toBe(false);
    expect(isNormalForwardMotion(0, -2, 1 / 60)).toBe(false);
  });

  it('selects the nearest photo with a meaningful story', () => {
    const first = createPhoto('first', '拍摄器材: Sony');
    const second = createPhoto('second', '湖边的日落');
    const third = createPhoto('third', '那年冬天');
    const positions = new Map([
      ['first', createPosition(-10)],
      ['second', createPosition(-18)],
      ['third', createPosition(-38)],
    ]);

    expect(selectNearestStoryPhoto([first, second, third], positions, 0)?.id).toBe('second');
  });

  it('places the story overhead with an independent depth offset', () => {
    const [x, y, z] = getStoryLayerPosition(createPosition(-12));
    expect(x).toBe(0);
    expect(y).toBeCloseTo(5.2);
    expect(z).toBeCloseTo(-16.5);
  });
});