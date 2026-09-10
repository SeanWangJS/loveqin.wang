import { PhotoItem, SpatialPosition } from '../types/gallery';

export const STORY_LAYER_CONFIG = {
  focusOffset: 0,
  fullOpacityDistance: 9,
  maxPreviewCharacters: 96,
  maxPreviewLines: 4,
  previewCharactersPerLine: 24,
  overheadX: 0,
  overheadY: 5.2,
  zOffset: -4.5,
  triggerDistance: 18,
  enterDuration: 0.72,
  holdDuration: 1.1,
  dissolveDuration: 1.05,
  maxForwardSpeed: 24,
} as const;

export interface StoryLayerEffect {
  color: string;
  glowColor: string;
  fontSize: number;
  textureWidth: number;
  textureHeight: number;
  maxPreviewCharacters: number;
  maxPreviewLines: number;
  previewCharactersPerLine: number;
  glowStrength: number;
  ringOpacity: number;
  effectIntensity: number;
}

export const STORY_LAYER_EFFECTS: Record<'high' | 'medium' | 'low', StoryLayerEffect> = {
  high: {
    color: '#e0f2fe',
    glowColor: '#38bdf8',
    fontSize: 126,
    textureWidth: 1024,
    textureHeight: 640,
    maxPreviewCharacters: 21,
    maxPreviewLines: 3,
    previewCharactersPerLine: 7,
    glowStrength: 1,
    ringOpacity: 0.34,
    effectIntensity: 0.62,
  },
  medium: {
    color: '#e0f2fe',
    glowColor: '#38bdf8',
    fontSize: 102,
    textureWidth: 768,
    textureHeight: 480,
    maxPreviewCharacters: 18,
    maxPreviewLines: 3,
    previewCharactersPerLine: 6,
    glowStrength: 0.72,
    ringOpacity: 0.26,
    effectIntensity: 0.48,
  },
  low: {
    color: '#e0f2fe',
    glowColor: '#38bdf8',
    fontSize: 84,
    textureWidth: 512,
    textureHeight: 320,
    maxPreviewCharacters: 15,
    maxPreviewLines: 3,
    previewCharactersPerLine: 5,
    glowStrength: 0.35,
    ringOpacity: 0.16,
    effectIntensity: 0.3,
  },
};

const GENERATED_STORY = '记录温暖而珍贵的时光回忆';
const EQUIPMENT_STORY_PATTERN = /^拍摄器材\s*[:：]/i;

export function hasMeaningfulStory(storyOrPhoto: Pick<PhotoItem, 'story'> | string): boolean {
  const story = typeof storyOrPhoto === 'string' ? storyOrPhoto : storyOrPhoto.story;
  const normalized = story.trim();

  return normalized.length > 0
    && normalized !== GENERATED_STORY
    && !EQUIPMENT_STORY_PATTERN.test(normalized);
}

export function getStoryPreview(
  story: string,
  maxCharacters: number = STORY_LAYER_CONFIG.maxPreviewCharacters,
  maxLines: number = STORY_LAYER_CONFIG.maxPreviewLines,
  charactersPerLine: number = STORY_LAYER_CONFIG.previewCharactersPerLine,
): string {
  const normalized = story.trim();
  const clipped = Array.from(normalized).slice(0, maxCharacters).join('');
  const lines: string[] = [];

  for (let index = 0; index < clipped.length && lines.length < maxLines; index += charactersPerLine) {
    lines.push(clipped.slice(index, index + charactersPerLine));
  }

  const consumedCharacters = lines.join('').length;
  const wasClipped = consumedCharacters < normalized.length;
  if (wasClipped && lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    lines[lines.length - 1] = `${lastLine.slice(0, Math.max(0, lastLine.length - 1))}…`;
  }

  return lines.join('\n');
}

export function getStoryFocusZ(cameraZ: number, focusOffset = STORY_LAYER_CONFIG.focusOffset): number {
  return cameraZ - focusOffset;
}

export function getStoryDistance(
  cameraZ: number,
  photoZ: number,
  focusOffset = STORY_LAYER_CONFIG.focusOffset,
): number {
  return Math.abs(getStoryAnchorZ(photoZ) - getStoryFocusZ(cameraZ, focusOffset));
}

export function getStoryOpacity(
  distance: number,
  triggerDistance: number = STORY_LAYER_CONFIG.triggerDistance,
  fullOpacityDistance: number = STORY_LAYER_CONFIG.fullOpacityDistance,
): number {
  if (distance >= triggerDistance) return 0;
  if (distance <= fullOpacityDistance) return 1;

  const progress = (triggerDistance - distance) / (triggerDistance - fullOpacityDistance);
  return progress * progress * (3 - 2 * progress);
}

export function getStoryAnchorZ(
  photoZ: number,
  zOffset: number = STORY_LAYER_CONFIG.zOffset,
): number {
  return photoZ + zOffset;
}

export interface StoryVisualState {
  opacity: number;
  dissolveProgress: number;
}

export type StoryAnimationPhase = 'entering' | 'holding' | 'dissolving' | 'completed';

export function getStoryAnimationDuration(
  enterDuration: number = STORY_LAYER_CONFIG.enterDuration,
  holdDuration: number = STORY_LAYER_CONFIG.holdDuration,
  dissolveDuration: number = STORY_LAYER_CONFIG.dissolveDuration,
): number {
  return enterDuration + holdDuration + dissolveDuration;
}

export function getStoryTriggerZ(
  photoZ: number,
  triggerDistance: number = STORY_LAYER_CONFIG.triggerDistance,
): number {
  return getStoryAnchorZ(photoZ) + triggerDistance;
}

export function isNormalForwardMotion(
  previousZ: number,
  currentZ: number,
  delta: number,
  maxForwardSpeed: number = STORY_LAYER_CONFIG.maxForwardSpeed,
): boolean {
  const forwardSpeed = (previousZ - currentZ) / Math.max(delta, 1 / 120);
  return forwardSpeed > 0 && forwardSpeed <= maxForwardSpeed;
}

export function getStoryAnimationState(
  elapsed: number,
  enterDuration: number = STORY_LAYER_CONFIG.enterDuration,
  holdDuration: number = STORY_LAYER_CONFIG.holdDuration,
  dissolveDuration: number = STORY_LAYER_CONFIG.dissolveDuration,
): StoryVisualState & { phase: StoryAnimationPhase } {
  if (elapsed < enterDuration) {
    const progress = elapsed / enterDuration;
    return {
      phase: 'entering',
      opacity: progress * progress * (3 - 2 * progress),
      dissolveProgress: 0,
    };
  }

  if (elapsed < enterDuration + holdDuration) {
    return { phase: 'holding', opacity: 1, dissolveProgress: 0 };
  }

  const dissolveElapsed = elapsed - enterDuration - holdDuration;
  if (dissolveElapsed < dissolveDuration) {
    const progress = dissolveElapsed / dissolveDuration;
    return {
      phase: 'dissolving',
      opacity: 1 - progress * progress * (3 - 2 * progress),
      dissolveProgress: progress,
    };
  }

  return { phase: 'completed', opacity: 0, dissolveProgress: 1 };
}

export function selectNearestStoryPhoto(
  photos: PhotoItem[],
  positions: Map<string, SpatialPosition>,
  cameraZ: number,
): PhotoItem | null {
  let nearest: PhotoItem | null = null;
  let nearestDistance = Infinity;

  for (const photo of photos) {
    if (!hasMeaningfulStory(photo)) continue;
    const position = positions.get(photo.id);
    if (!position) continue;

    const distance = getStoryDistance(cameraZ, position.z);
    if (distance < nearestDistance) {
      nearest = photo;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function getStoryLayerPosition(
  position: SpatialPosition,
): [number, number, number] {
  return [
    STORY_LAYER_CONFIG.overheadX,
    STORY_LAYER_CONFIG.overheadY,
    position.z + STORY_LAYER_CONFIG.zOffset,
  ];
}