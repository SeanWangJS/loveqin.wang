import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SpiralGalaxyProps {
  opacity?: number;
  warpFactor?: number; // 0 (normal) -> 1 (max warp flare)
}

// 4 芒十字光学衍射星芒纹理 (Astronomical 4-Point Diamond Cross Diffraction Glint)
function createDiffractionGlintTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  // 1. 核心极亮白光光斑与微弱径向光晕
  const radial = ctx.createRadialGradient(c, c, 0, c, c, 48);
  radial.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  radial.addColorStop(0.12, 'rgba(255, 255, 255, 0.9)');
  radial.addColorStop(0.35, 'rgba(224, 242, 254, 0.45)');
  radial.addColorStop(0.7, 'rgba(186, 230, 253, 0.12)');
  radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, size, size);

  // 2. 细长水平主光芒 (Horizontal Spike)
  const spikeH = ctx.createLinearGradient(0, c, size, c);
  spikeH.addColorStop(0, 'rgba(255, 255, 255, 0)');
  spikeH.addColorStop(0.42, 'rgba(224, 242, 254, 0.25)');
  spikeH.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
  spikeH.addColorStop(0.58, 'rgba(224, 242, 254, 0.25)');
  spikeH.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = spikeH;
  ctx.fillRect(0, c - 1.5, size, 3);

  // 3. 细长垂直主光芒 (Vertical Spike)
  const spikeV = ctx.createLinearGradient(c, 0, c, size);
  spikeV.addColorStop(0, 'rgba(255, 255, 255, 0)');
  spikeV.addColorStop(0.42, 'rgba(224, 242, 254, 0.25)');
  spikeV.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
  spikeV.addColorStop(0.58, 'rgba(224, 242, 254, 0.25)');
  spikeV.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = spikeV;
  ctx.fillRect(c - 1.5, 0, 3, size);

  // 4. 辅助微斜对角光芒 (Subtle 45° X-rays)
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(Math.PI / 4);
  const diagH = ctx.createLinearGradient(-c * 0.45, 0, c * 0.45, 0);
  diagH.addColorStop(0, 'rgba(255, 255, 255, 0)');
  diagH.addColorStop(0.5, 'rgba(255, 255, 255, 0.4)');
  diagH.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = diagH;
  ctx.fillRect(-c * 0.45, -0.75, c * 0.9, 1.5);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 核心星云柔光贴图 (Galactic Core Soft Glow)
function createCoreGlowTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.1, 'rgba(255, 255, 255, 0.92)');
  grad.addColorStop(0.25, 'rgba(224, 242, 254, 0.65)');
  grad.addColorStop(0.45, 'rgba(186, 230, 253, 0.28)');
  grad.addColorStop(0.7, 'rgba(125, 211, 252, 0.08)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 片元着色器：高性能圆点高斯柔边 + Twinkle
const galaxyVertexShader = `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aTwinklePhase;
  attribute float aAlpha;

  uniform float uTime;
  uniform float uWarp;
  uniform float uPixelRatio;

  varying vec3 vColor;
  varying float vTwinkle;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;

    // 星星闪烁微动
    vTwinkle = 0.82 + 0.18 * sin(uTime * 3.2 + aTwinklePhase);

    vec3 pos = position;
    // 跃迁时星星受曲速力向外或向前轻微辐射拉伸
    if (uWarp > 0.0) {
      pos.xy += normalize(pos.xy + vec2(0.001)) * (uWarp * 3.5);
      pos.z += uWarp * 6.0;
    }

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // 随距离调整粒子视口像素大小
    float sizeFactor = (uWarp > 0.0) ? (1.0 + uWarp * 1.5) : 1.0;
    gl_PointSize = aSize * uPixelRatio * (28.0 / -mvPosition.z) * sizeFactor;
  }
`;

const galaxyFragmentShader = `
  precision highp float;

  varying vec3 vColor;
  varying float vTwinkle;
  varying float vAlpha;

  uniform float uGlobalOpacity;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distSq = dot(coord, coord);
    if (distSq > 0.25) discard;

    // 柔和高斯星光圆点
    float dist = sqrt(distSq) * 2.0;
    float core = exp(-dist * dist * 4.2);
    float halo = exp(-dist * 2.1) * 0.35;
    float intensity = core + halo;

    gl_FragColor = vec4(vColor * vTwinkle, intensity * vAlpha * uGlobalOpacity);
  }
`;

// 严格按照参考图 2 挑选与分布的 12 颗 Hero 亮星位置及十字星芒参数
const HERO_STARS = [
  // 1. 核心边缘伴星 (接近中心白炽区)
  { x: 0.45, y: -0.58, z: 0.05, size: 1.15, rotation: 0.05, color: '#ffffff' },
  // 2. 内圈主旋臂明珠 (1点钟方位，参考图特显眼亮星)
  { x: 0.72, y: 1.85, z: 0.08, size: 1.35, rotation: 0.12, color: '#ffffff' },
  // 3. 右下中圈旋臂亮星 (4点钟方位，极其醒目)
  { x: 2.38, y: -1.72, z: 0.06, size: 1.45, rotation: -0.08, color: '#ffffff' },
  // 4. 左上中圈主臂亮星 (10点钟方位)
  { x: -2.15, y: 2.45, z: 0.07, size: 1.25, rotation: 0.18, color: '#e0f2fe' },
  // 5. 上方外展部暖星 (12点钟方位)
  { x: 1.25, y: 2.75, z: 0.04, size: 1.1, rotation: -0.15, color: '#fed7aa' },
  // 6. 左侧主旋臂中段 (9点钟方位)
  { x: -3.15, y: 0.42, z: 0.06, size: 1.2, rotation: 0.22, color: '#ffffff' },
  // 7. 左下内旋副臂亮星 (7点钟方位)
  { x: -1.75, y: -1.55, z: 0.05, size: 1.15, rotation: -0.05, color: '#bae6fd' },
  // 8. 底部旋臂外缘 (6点钟方位)
  { x: 0.25, y: -3.55, z: 0.08, size: 1.28, rotation: 0.1, color: '#ffffff' },
  // 9. 远端顶部旋臂尖峰 (11点钟最外圈)
  { x: -0.35, y: 5.15, z: 0.05, size: 1.1, rotation: -0.2, color: '#ffffff' },
  // 10. 远端底部旋臂尖峰 (5点钟最外圈)
  { x: -0.42, y: -4.75, z: 0.04, size: 1.05, rotation: 0.14, color: '#ffffff' },
  // 11. 核心微距暖琥珀明星
  { x: -0.58, y: 0.35, z: 0.09, size: 0.95, rotation: 0.3, color: '#fbbf24' },
  // 12. 右外展细支臂伴星
  { x: 3.45, y: -0.85, z: 0.05, size: 1.0, rotation: -0.12, color: '#7dd3fc' },
];

export const SpiralGalaxy: React.FC<SpiralGalaxyProps> = ({
  opacity = 1.0,
  warpFactor = 0.0,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null);
  const coreGlowRef = useRef<THREE.Mesh>(null);
  const coreGlowOuterRef = useRef<THREE.Mesh>(null);

  // 1. 生成高精纹理
  const glintTexture = useMemo(() => createDiffractionGlintTexture(), []);
  const coreGlowTexture = useMemo(() => createCoreGlowTexture(), []);

  // 2. 程序化生成双对数主旋臂与星系尘埃粒子
  const { positions, colors, sizes, twinklePhases, alphas } = useMemo(() => {
    const TOTAL_STARS = 4600;
    const pos = new Float32Array(TOTAL_STARS * 3);
    const col = new Float32Array(TOTAL_STARS * 3);
    const siz = new Float32Array(TOTAL_STARS);
    const phases = new Float32Array(TOTAL_STARS);
    const alp = new Float32Array(TOTAL_STARS);

    // 调色盘配置（严格对照参考图 2）：纯白与冰蓝 ~70%，暖琥珀金 ~30%
    const whiteColor = new THREE.Color('#ffffff');
    const icyBlueColors = [
      new THREE.Color('#e0f2fe'),
      new THREE.Color('#bae6fd'),
      new THREE.Color('#7dd3fc'),
      new THREE.Color('#38bdf8'),
    ];
    const amberColors = [
      new THREE.Color('#f59e0b'),
      new THREE.Color('#fbbf24'),
      new THREE.Color('#f97316'),
      new THREE.Color('#fed7aa'),
      new THREE.Color('#fde68a'),
    ];

    let idx = 0;

    // A. 致密白炽核心聚星 (r < 1.6)
    const CORE_STARS = 750;
    for (let i = 0; i < CORE_STARS; i++) {
      const angle = Math.random() * Math.PI * 2;
      // 径向分布呈指数衰减聚集在中心
      const radius = Math.pow(Math.random(), 2.2) * 1.6;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const z = (Math.random() - 0.5) * 0.45 * (1.0 - radius / 1.6);

      pos[idx * 3] = x;
      pos[idx * 3 + 1] = y;
      pos[idx * 3 + 2] = z;

      // 核心大多为白热色与极浅冰蓝
      if (radius < 0.6 || Math.random() < 0.75) {
        col[idx * 3] = whiteColor.r;
        col[idx * 3 + 1] = whiteColor.g;
        col[idx * 3 + 2] = whiteColor.b;
      } else {
        const c = icyBlueColors[Math.floor(Math.random() * icyBlueColors.length)];
        col[idx * 3] = c.r;
        col[idx * 3 + 1] = c.g;
        col[idx * 3 + 2] = c.b;
      }

      siz[idx] = radius < 0.7 ? 3.8 + Math.random() * 4.5 : 2.5 + Math.random() * 3.5;
      phases[idx] = Math.random() * 10;
      alp[idx] = 0.85 + Math.random() * 0.15;
      idx++;
    }

    // B. 对数双旋臂与分支星群 (2 主臂，逆时针展开)
    const ARM_STARS = TOTAL_STARS - CORE_STARS - 350;
    const ARMS_COUNT = 2;
    const bSpiral = 0.192; // 螺线舒展系数
    const maxTheta = 3.65 * Math.PI; // 约 1.8 圈

    for (let i = 0; i < ARM_STARS; i++) {
      const armIndex = i % ARMS_COUNT;
      const armBaseAngle = armIndex * Math.PI; // 双臂相差 180 度

      // 沿旋臂分布，采样偏向中段
      const t = Math.pow(Math.random(), 0.82);
      const theta = 0.45 + t * (maxTheta - 0.45);

      // 对数螺线基准半径: r = a * exp(b * theta)
      const baseRadius = 1.15 * Math.exp(bSpiral * theta);

      // 旋臂宽度随半径增大而扩散（近窄远宽）
      const armWidth = 0.18 + baseRadius * 0.13;
      const radialOffset = (Math.random() - 0.5 + Math.random() - 0.5) * armWidth * 1.1;
      const tangentialOffset = (Math.random() - 0.5) * (armWidth * 0.65);

      const r = baseRadius + radialOffset;
      const finalAngle = theta + armBaseAngle + tangentialOffset / Math.max(0.5, r);

      // 逆时针舒展
      const x = r * Math.cos(finalAngle);
      const y = r * Math.sin(finalAngle);
      // 银河盘面厚度
      const z = (Math.random() - 0.5) * Math.max(0.08, 0.45 - r * 0.035);

      pos[idx * 3] = x;
      pos[idx * 3 + 1] = y;
      pos[idx * 3 + 2] = z;

      // 颜色分配：~28% 暖琥珀金，~50% 纯白，~22% 冰蓝
      const colorRoll = Math.random();
      let chosenColor: THREE.Color;
      if (colorRoll < 0.28) {
        chosenColor = amberColors[Math.floor(Math.random() * amberColors.length)];
      } else if (colorRoll < 0.78) {
        chosenColor = whiteColor;
      } else {
        chosenColor = icyBlueColors[Math.floor(Math.random() * icyBlueColors.length)];
      }

      col[idx * 3] = chosenColor.r;
      col[idx * 3 + 1] = chosenColor.g;
      col[idx * 3 + 2] = chosenColor.b;

      // 粒子大小分级：主体微光星粉 (65%) + 明亮星宿 (35%)
      if (Math.random() < 0.65) {
        siz[idx] = 1.8 + Math.random() * 2.2;
        alp[idx] = 0.65 + Math.random() * 0.3;
      } else {
        siz[idx] = 3.6 + Math.random() * 4.2;
        alp[idx] = 0.85 + Math.random() * 0.15;
      }

      phases[idx] = Math.random() * 10;
      idx++;
    }

    // C. 深空背景漂移弱星 (350 颗，增加空间深度)
    const BG_STARS = TOTAL_STARS - idx;
    for (let i = 0; i < BG_STARS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.0 + Math.random() * 8.5;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const z = (Math.random() - 0.5) * 1.5;

      pos[idx * 3] = x;
      pos[idx * 3 + 1] = y;
      pos[idx * 3 + 2] = z;

      const c = Math.random() < 0.2 ? amberColors[0] : (Math.random() < 0.5 ? whiteColor : icyBlueColors[0]);
      col[idx * 3] = c.r;
      col[idx * 3 + 1] = c.g;
      col[idx * 3 + 2] = c.b;

      siz[idx] = 1.2 + Math.random() * 1.8;
      phases[idx] = Math.random() * 10;
      alp[idx] = 0.25 + Math.random() * 0.35;
      idx++;
    }

    return {
      positions: pos,
      colors: col,
      sizes: siz,
      twinklePhases: phases,
      alphas: alp,
      starCount: TOTAL_STARS,
    };
  }, []);

  // 3. 粒子几何体与属性构建
  const pointsGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geom.setAttribute('aTwinklePhase', new THREE.BufferAttribute(twinklePhases, 1));
    geom.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    return geom;
  }, [positions, colors, sizes, twinklePhases, alphas]);

  // 4. 着色器材质 Uniforms
  const shaderUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWarp: { value: 0 },
    uGlobalOpacity: { value: opacity },
    uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
  }), []);

  // 5. 逐帧动力学自转与光效呼吸
  useFrame((state, delta) => {
    const time = state.clock.getElapsedTime();

    // 银河整体以极高质感的优雅速度缓慢逆时针自转
    if (groupRef.current) {
      groupRef.current.rotation.z += delta * 0.055;
    }

    if (shaderMatRef.current) {
      shaderMatRef.current.uniforms.uTime.value = time;
      shaderMatRef.current.uniforms.uWarp.value = warpFactor;
      shaderMatRef.current.uniforms.uGlobalOpacity.value = opacity;
    }

    // 核心光晕柔和呼吸微动
    if (coreGlowRef.current) {
      const pulse = 1.0 + Math.sin(time * 1.8) * 0.06;
      const warpScale = 1.0 + warpFactor * 3.5;
      coreGlowRef.current.scale.set(pulse * warpScale, pulse * warpScale, 1);

      const mat = coreGlowRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = (0.92 + Math.sin(time * 2.2) * 0.08) * opacity * (1.0 + warpFactor * 1.5);
      }
    }

    if (coreGlowOuterRef.current) {
      const pulseOuter = 1.0 + Math.sin(time * 1.2 + 1.0) * 0.08;
      const warpScale = 1.0 + warpFactor * 4.0;
      coreGlowOuterRef.current.scale.set(pulseOuter * warpScale, pulseOuter * warpScale, 1);

      const matOuter = coreGlowOuterRef.current.material as THREE.MeshBasicMaterial;
      if (matOuter) {
        matOuter.opacity = (0.55 + Math.sin(time * 1.5) * 0.05) * opacity * (1.0 + warpFactor * 2.0);
      }
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* 1. 致密核心高斯发光盘 (双层叠加大范围能量场) */}
      <mesh ref={coreGlowRef} position={[0, 0, 0.02]}>
        <planeGeometry args={[3.6, 3.6]} />
        <meshBasicMaterial
          map={coreGlowTexture}
          transparent
          opacity={0.92 * opacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <mesh ref={coreGlowOuterRef} position={[0, 0, 0.01]}>
        <planeGeometry args={[7.2, 7.2]} />
        <meshBasicMaterial
          map={coreGlowTexture}
          transparent
          opacity={0.45 * opacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      {/* 2. 数千颗全景对数旋臂星体与微光星粉 (GPU Shader Points) */}
      <points geometry={pointsGeometry}>
        <shaderMaterial
          ref={shaderMatRef}
          vertexShader={galaxyVertexShader}
          fragmentShader={galaxyFragmentShader}
          uniforms={shaderUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* 3. 严格复刻参考图 2 的 12 颗 Hero 明星与 4 芒十字衍射星芒 (Diffraction Spikes) */}
      <group>
        {HERO_STARS.map((star, idx) => {
          const warpOffset = warpFactor * 2.5;
          const posX = star.x * (1 + warpOffset * 0.2);
          const posY = star.y * (1 + warpOffset * 0.2);
          const posZ = star.z + warpOffset * 0.5;

          return (
            <mesh
              key={`hero-star-${idx}`}
              position={[posX, posY, posZ]}
              rotation={[0, 0, star.rotation]}
              scale={[star.size * (1 + warpFactor * 1.2), star.size * (1 + warpFactor * 1.2), 1]}
            >
              <planeGeometry args={[1.5, 1.5]} />
              <meshBasicMaterial
                map={glintTexture}
                color={star.color}
                transparent
                opacity={0.95 * opacity * (1 - warpFactor * 0.4)}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </mesh>
          );
        })}
      </group>
    </group>
  );
};
