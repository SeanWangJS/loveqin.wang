import React, { useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PhotoItem, QualityTier, SpatialPosition } from '../../types/gallery';
import {
  getStoryAnimationState,
  getStoryTriggerZ,
  hasMeaningfulStory,
  isNormalForwardMotion,
} from '../../utils/storyLayer';
import { StoryLightLayer } from './StoryLightLayer';

interface ActiveStory {
  photo: PhotoItem;
  position: SpatialPosition;
  startedAt: number;
}

interface StoryLayerManagerProps {
  photos: PhotoItem[];
  positions: Map<string, SpatialPosition>;
  qualityTier: QualityTier;
}

export const StoryLayerManager: React.FC<StoryLayerManagerProps> = ({
  photos,
  positions,
  qualityTier,
}) => {
  const { camera } = useThree();
  const previousZRef = useRef<number | null>(null);
  const triggeredIdsRef = useRef(new Set<string>());
  const queueRef = useRef<PhotoItem[]>([]);
  const activeRef = useRef<ActiveStory | null>(null);
  const [activeStory, setActiveStory] = useState<ActiveStory | null>(null);

  useFrame(({ clock }, delta) => {
    const currentZ = camera.position.z;
    const previousZ = previousZRef.current;
    previousZRef.current = currentZ;

    if (previousZ === null) return;

    const forwardStep = previousZ - currentZ;
    const movingBackward = forwardStep < 0;
    const movingForward = isNormalForwardMotion(previousZ, currentZ, delta);
    const movingTooFast = forwardStep > 0 && !movingForward;

    if (movingBackward || movingTooFast) {
      queueRef.current = [];
      triggeredIdsRef.current.clear();
      if (activeRef.current) {
        activeRef.current = null;
        setActiveStory(null);
      }
      return;
    }

    if (activeRef.current) {
      const elapsed = clock.elapsedTime - activeRef.current.startedAt;
      const animation = getStoryAnimationState(elapsed);
      if (animation.phase === 'completed') {
        const nextPhoto = queueRef.current.shift();
        if (nextPhoto) {
          const nextPosition = positions.get(nextPhoto.id);
          if (nextPosition) {
            const nextActive = {
              photo: nextPhoto,
              position: nextPosition,
              startedAt: clock.elapsedTime,
            };
            activeRef.current = nextActive;
            setActiveStory(nextActive);
          }
        } else {
          activeRef.current = null;
          setActiveStory(null);
        }
      }
    }

    if (!movingForward) return;

    const crossedStories = photos
      .filter((photo) => hasMeaningfulStory(photo) && !triggeredIdsRef.current.has(photo.id))
      .filter((photo) => {
        const position = positions.get(photo.id);
        if (!position) return false;
        const triggerZ = getStoryTriggerZ(position.z);
        return previousZ > triggerZ && currentZ <= triggerZ;
      })
      .sort((left, right) => {
        const leftPosition = positions.get(left.id);
        const rightPosition = positions.get(right.id);
        return (rightPosition?.z ?? 0) - (leftPosition?.z ?? 0);
      });

    for (const photo of crossedStories) {
      triggeredIdsRef.current.add(photo.id);
      if (activeRef.current || queueRef.current.length > 0) {
        if (queueRef.current.length < 2) queueRef.current.push(photo);
        continue;
      }

      const position = positions.get(photo.id);
      if (!position) continue;
      const nextActive = { photo, position, startedAt: clock.elapsedTime };
      activeRef.current = nextActive;
      setActiveStory(nextActive);
    }
  });

  if (!activeStory) return null;

  return (
    <StoryLightLayer
      key={`story-${activeStory.photo.id}-${activeStory.startedAt}`}
      photo={activeStory.photo}
      positionData={activeStory.position}
      startedAt={activeStory.startedAt}
      qualityTier={qualityTier}
    />
  );
};