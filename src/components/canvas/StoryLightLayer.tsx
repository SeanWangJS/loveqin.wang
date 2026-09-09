import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PhotoItem, QualityTier, SpatialPosition } from '../../types/gallery';
import {
  getStoryAnimationState,
  getStoryLayerPosition,
  getStoryPreview,
  STORY_LAYER_CONFIG,
  STORY_LAYER_EFFECTS,
} from '../../utils/storyLayer';

const STORY_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uWave;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 transformed = position;
    transformed.z += sin((position.x + uTime * 0.35) * 2.0) * 0.004 * uWave;
    transformed.y += sin(position.x * 1.4 + uTime * 0.55) * 0.004 * uWave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const STORY_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uDissolve;
  uniform float uGlowStrength;
  uniform float uTime;
  uniform float uReveal;
  uniform float uIntensity;
  varying vec2 vUv;

  float hash(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  void main() {
    vec4 textSample = texture2D(uMap, vUv);
    float grain = hash(floor(vUv * vec2(96.0, 48.0)));
    float remaining = smoothstep(uDissolve - 0.12, uDissolve + 0.12, grain);
    float revealMask = smoothstep(-0.08, 0.16, uReveal - vUv.x);
    float revealEdge = (1.0 - smoothstep(0.0, 0.08, abs(vUv.x - uReveal)))
      * (1.0 - step(0.995, uReveal));
    float shimmerPosition = mod(uTime * 0.08, 1.35) - 0.18;
    float shimmer = exp(-pow((vUv.x - shimmerPosition) * 18.0, 2.0))
      * (1.0 - step(0.99, uReveal));
    vec3 edgeColor = textSample.rgb;
    edgeColor += vec3(0.55, 0.95, 0.9) * revealEdge * 0.75 * uIntensity;
    edgeColor += vec3(0.5, 0.9, 0.84) * shimmer * 0.2 * uIntensity;
    float alpha = textSample.a * uOpacity * revealMask * remaining;
    alpha += revealEdge * uOpacity * 0.08 * uIntensity;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(edgeColor, alpha);
  }
`;

interface StoryUniforms extends Record<string, THREE.IUniform> {
  uMap: THREE.IUniform<THREE.Texture | null>;
  uOpacity: THREE.IUniform<number>;
  uDissolve: THREE.IUniform<number>;
  uGlowStrength: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uReveal: THREE.IUniform<number>;
  uIntensity: THREE.IUniform<number>;
  uWave: THREE.IUniform<number>;
}

function createStoryUniforms(): StoryUniforms {
  return {
    uMap: { value: null },
    uOpacity: { value: 0 },
    uDissolve: { value: 0 },
    uGlowStrength: { value: 1 },
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uIntensity: { value: 1 },
    uWave: { value: 1 },
  };
}

interface StoryTextureEntry {
  texture: THREE.CanvasTexture;
  references: number;
}

const storyTextureCache = new Map<string, StoryTextureEntry>();

function createStoryTexture(story: string, qualityTier: QualityTier): THREE.CanvasTexture {
  const effect = STORY_LAYER_EFFECTS[qualityTier];
  const canvas = document.createElement('canvas');
  canvas.width = effect.textureWidth;
  canvas.height = effect.textureHeight;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('无法创建故事文字 Canvas');
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `500 ${effect.fontSize}px "Noto Sans SC", "Microsoft YaHei", sans-serif`;
  context.shadowColor = effect.glowColor;
  context.shadowBlur = 16 * effect.glowStrength;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.fillStyle = effect.color;

  const lines = getStoryPreview(
    story,
    effect.maxPreviewCharacters,
    effect.maxPreviewLines,
    effect.previewCharactersPerLine,
  ).split('\n');
  const lineHeight = effect.fontSize * 1.35;
  const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => {
    context.fillText(line, canvas.width / 2, startY + index * lineHeight);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function acquireStoryTexture(story: string, qualityTier: QualityTier): THREE.CanvasTexture {
  const key = `${qualityTier}:${story}`;
  const cached = storyTextureCache.get(key);
  if (cached) {
    cached.references += 1;
    return cached.texture;
  }

  const texture = createStoryTexture(story, qualityTier);
  storyTextureCache.set(key, { texture, references: 1 });
  return texture;
}

function releaseStoryTexture(story: string, qualityTier: QualityTier) {
  const key = `${qualityTier}:${story}`;
  const cached = storyTextureCache.get(key);
  if (!cached) return;

  cached.references -= 1;
  if (cached.references <= 0) {
    cached.texture.dispose();
    storyTextureCache.delete(key);
  }
}

interface StoryLightLayerProps {
  photo: PhotoItem;
  positionData: SpatialPosition;
  startedAt: number;
  qualityTier: QualityTier;
}

export const StoryLightLayer: React.FC<StoryLightLayerProps> = ({
  photo,
  positionData,
  startedAt,
  qualityTier,
}) => {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const uniformsRef = useRef<StoryUniforms>(createStoryUniforms());
  const haloUniformsRef = useRef<StoryUniforms>(createStoryUniforms());
  const displayedOpacityRef = useRef(0);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringAMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const basePosition = getStoryLayerPosition(positionData);
  const effect = STORY_LAYER_EFFECTS[qualityTier];

  useEffect(() => {
    const acquiredTexture = acquireStoryTexture(photo.story, qualityTier);
    uniformsRef.current.uMap.value = acquiredTexture;
    haloUniformsRef.current.uMap.value = acquiredTexture;
    uniformsRef.current.uGlowStrength.value = effect.glowStrength;
    haloUniformsRef.current.uGlowStrength.value = effect.glowStrength;
    uniformsRef.current.uIntensity.value = effect.effectIntensity;
    haloUniformsRef.current.uIntensity.value = effect.effectIntensity;
    setTexture(acquiredTexture);

    return () => {
      releaseStoryTexture(photo.story, qualityTier);
    };
  }, [photo.story, qualityTier]);

  useFrame(({ clock }, delta) => {
    const elapsed = clock.elapsedTime - startedAt;
    const animation = getStoryAnimationState(elapsed);
    const reveal = animation.phase === 'entering'
      ? THREE.MathUtils.clamp(elapsed / STORY_LAYER_CONFIG.enterDuration, 0, 1)
      : 1;
    displayedOpacityRef.current = THREE.MathUtils.damp(
      displayedOpacityRef.current,
      animation.opacity,
      3.2,
      delta,
    );
    uniformsRef.current.uOpacity.value = displayedOpacityRef.current;
    uniformsRef.current.uDissolve.value = animation.dissolveProgress;
    uniformsRef.current.uTime.value = clock.elapsedTime;
    uniformsRef.current.uReveal.value = reveal;
    uniformsRef.current.uWave.value = 1 + animation.dissolveProgress * 2.5;
    haloUniformsRef.current.uOpacity.value = displayedOpacityRef.current * 0.2;
    haloUniformsRef.current.uDissolve.value = animation.dissolveProgress;
    haloUniformsRef.current.uTime.value = clock.elapsedTime * 1.08;
    haloUniformsRef.current.uReveal.value = reveal;
    haloUniformsRef.current.uWave.value = 1 + animation.dissolveProgress * 3;

    if (groupRef.current) {
      groupRef.current.position.y = basePosition[1] + Math.sin(clock.elapsedTime * 1.3) * 0.035;
    }

    const pulse = 1 + Math.sin(clock.elapsedTime * 1.4) * 0.015;
    ringARef.current?.scale.set(pulse, 0.34 * pulse, 1);
    if (ringARef.current) ringARef.current.rotation.z = clock.elapsedTime * 0.035;
    const ringEnergy = displayedOpacityRef.current * effect.ringOpacity;
    if (ringAMaterialRef.current) ringAMaterialRef.current.opacity = ringEnergy;
  });

  if (!texture) return null;

  return (
    <group
      ref={groupRef}
      position={basePosition}
      rotation={[0, 0, 0]}
      scale={positionData.scale * 0.86}
      renderOrder={120}
    >
      <mesh ref={ringARef} position={[0, 0, 0.005]}>
        <ringGeometry args={[2.7, 2.72, 96]} />
        <meshBasicMaterial
          ref={ringAMaterialRef}
          color="#b8eee5"
          transparent
          opacity={0}
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[4.6, 1.44]} />
        <shaderMaterial
          uniforms={uniformsRef.current}
          vertexShader={STORY_VERTEX_SHADER}
          fragmentShader={STORY_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh position={[0, 0, 0.02]} scale={1.035}>
        <planeGeometry args={[4.6, 1.44]} />
        <shaderMaterial
          uniforms={haloUniformsRef.current}
          vertexShader={STORY_VERTEX_SHADER}
          fragmentShader={STORY_FRAGMENT_SHADER}
          transparent
          depthWrite={false}
          toneMapped={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
};