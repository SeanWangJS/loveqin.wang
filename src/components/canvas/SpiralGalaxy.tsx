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

// 悬臂常数与螺线流体力学参数
const THETA_MIN = 0.45;
const THETA_SPAN = 11.017;
const SPIRAL_B = 0.192; // 螺线舒展系数
const BASE_A = 1.15;    // 悬臂起始基准半径

// GPU 片元与顶点着色器：向心流体流线方程（Inward Streamline Fluid Flow）的悬臂星河向心漂流算法
// 优化紧凑属性打包（Packed Attributes），星体如河流漂浮物般缓缓冲向悬臂中心
const galaxyVertexShader = `
  uniform float uTime;
  uniform float uWarp;
  uniform float uPixelRatio;

  attribute vec3 aColor;
  attribute float aSize;
  attribute vec4 aFlowParams;  // (theta0 / radius, armAngle / angle0, speed, transverse)
  attribute vec4 aMiscParams;  // (isType, twinklePhase, baseAlpha, eddyFreq)
  attribute vec2 aExtraParams; // (eddyPhase, baseZ)

  varying vec3 vColor;
  varying float vTwinkle;
  varying float vAlpha;

  const float THETA_MIN = 0.45;
  const float THETA_SPAN = 11.017;
  const float SPIRAL_B = 0.192;
  const float BASE_A = 1.15;

  void main() {
    vColor = aColor;
    float twinklePhase = aMiscParams.y;
    vTwinkle = 0.82 + 0.18 * sin(uTime * 2.8 + twinklePhase);

    float isType = aMiscParams.x;
    float baseAlpha = aMiscParams.z;
    float eddyFreq = aMiscParams.w;
    float eddyPhase = aExtraParams.x;
    float baseZ = aExtraParams.y;

    vec3 pos = vec3(0.0);
    float streamAlpha = 1.0;

    if (isType < 0.5) {
      // === 1. 悬臂星河流线向心漂移算法 (Spiral Inward Streamline Flow) ===
      float theta0 = aFlowParams.x;
      float armAngle = aFlowParams.y;
      float speed = aFlowParams.z;
      float transverse = aFlowParams.w;

      // 沿对数螺线河道以更舒缓的优雅流速向悬臂中心方向流动 (theta 递减)
      float thetaOffset = mod(theta0 - uTime * speed - THETA_MIN, THETA_SPAN);
      if (thetaOffset < 0.0) thetaOffset += THETA_SPAN;
      float currentTheta = thetaOffset + THETA_MIN;
      
      // 河道中心线半径: r = a * exp(b * theta)
      float baseRadius = BASE_A * exp(SPIRAL_B * currentTheta);
      
      // 河道宽度随距离增大而扩散
      float armWidth = 0.18 + baseRadius * 0.13;
      
      // 流体微涡扰动 (Fluid Eddy Perturbation)：漂浮物随水波轻微横向晃动
      float eddy = sin(uTime * eddyFreq + eddyPhase) * (armWidth * 0.24);
      float radialOffset = transverse * armWidth + eddy;
      
      // 切向漂移微扰
      float tangential = cos(uTime * eddyFreq * 0.85 + eddyPhase) * (armWidth * 0.12);
      
      float r = baseRadius + radialOffset;
      float finalAngle = currentTheta + armAngle + tangential / max(0.5, r);
      
      pos.x = r * cos(finalAngle);
      pos.y = r * sin(finalAngle);
      
      // 3D 浮游微波上下起伏 (Ripple bobbing)
      float bob = sin(uTime * eddyFreq + eddyPhase * 1.8) * 0.035;
      pos.z = (baseZ + bob) * max(0.18, 1.0 - baseRadius * 0.07);
      
      // 两端平滑淡入淡出：外围外梢柔和淡入，靠近核心中心平滑汇入
      float streamNorm = (currentTheta - THETA_MIN) / THETA_SPAN;
      float fadeInOuter = 1.0 - smoothstep(0.86, 1.0, streamNorm);
      float fadeIntoCore = smoothstep(0.0, 0.08, streamNorm);
      streamAlpha = fadeInOuter * fadeIntoCore;

    } else if (isType < 1.5) {
      // === 2. 致密核心差动漩涡旋转 (Core Vortex Differential Dynamics) ===
      float coreRadius = aFlowParams.x;
      float coreAngle0 = aFlowParams.y;
      float coreSpeed = aFlowParams.z;

      float omega = coreSpeed / (0.42 + coreRadius * 0.85);
      float angle = coreAngle0 - uTime * omega;
      
      float breath = 1.0 + 0.02 * sin(uTime * 1.5 + twinklePhase);
      pos.x = coreRadius * cos(angle) * breath;
      pos.y = coreRadius * sin(angle) * breath;
      pos.z = baseZ;
      streamAlpha = 1.0;

    } else {
      // === 3. 深空背景恒星微漂移 (Deep Space Celestial Drift) ===
      float bgRadius = aFlowParams.x;
      float bgAngle0 = aFlowParams.y;

      float angle = bgAngle0 - uTime * 0.004;
      pos.x = bgRadius * cos(angle);
      pos.y = bgRadius * sin(angle);
      pos.z = baseZ;
      streamAlpha = 0.35;
    }

    // 跃迁冲刺模式 (Warp Plunge)
    if (uWarp > 0.0) {
      pos.xy += normalize(pos.xy + vec2(0.001)) * (uWarp * 3.5);
      pos.z += uWarp * 6.0;
    }

    vAlpha = baseAlpha * streamAlpha;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float sizeFactor = (uWarp > 0.0) ? (1.0 + uWarp * 1.5) : 1.0;
    gl_PointSize = max(2.0, aSize * uPixelRatio * (28.0 / -mvPosition.z) * sizeFactor);
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

    // 柔和高斯星光圆点与内聚核心
    float dist = sqrt(distSq) * 2.0;
    float core = exp(-dist * dist * 4.5);
    float halo = exp(-dist * 2.2) * 0.35;
    float alpha = (core + halo) * vAlpha * uGlobalOpacity;

    gl_FragColor = vec4(vColor * vTwinkle, alpha);
  }
`;

type HeroStarConfig =
  | {
      isCore: true;
      radius: number;
      angle0: number;
      speed: number;
      z: number;
      size: number;
      color: string;
    }
  | {
      isCore: false;
      armIndex: number;
      theta0: number;
      speed: number;
      transverse: number;
      eddyFreq: number;
      eddyPhase: number;
      z: number;
      size: number;
      color: string;
    };

// 12 颗 Hero 明星的向心流体漂浮运动配置（严格跟随旋臂河道向中心流动与核心漩涡运转）
const HERO_STAR_CONFIGS: HeroStarConfig[] = [
  // A. 核心内圈旋涡伴星 (Core Vortex)
  { isCore: true, radius: 0.65, angle0: 4.8, speed: 0.13, z: 0.06, size: 1.15, color: '#ffffff' },
  { isCore: true, radius: 0.58, angle0: 2.2, speed: 0.15, z: 0.08, size: 0.95, color: '#fbbf24' },

  // B. 旋臂 1 (Arm 0) 上的流体飘浮明珠 (跟随流线向中心聚拢漂移，更宁静舒缓)
  { isCore: false, armIndex: 0, theta0: 1.25, speed: 0.095, transverse: 0.12, eddyFreq: 0.9, eddyPhase: 0.5, z: 0.08, size: 1.35, color: '#ffffff' },
  { isCore: false, armIndex: 0, theta0: 3.35, speed: 0.090, transverse: -0.10, eddyFreq: 0.8, eddyPhase: 1.8, z: 0.07, size: 1.25, color: '#e0f2fe' },
  { isCore: false, armIndex: 0, theta0: 5.50, speed: 0.085, transverse: 0.22, eddyFreq: 0.75, eddyPhase: 3.2, z: 0.06, size: 1.20, color: '#ffffff' },
  { isCore: false, armIndex: 0, theta0: 7.75, speed: 0.080, transverse: -0.05, eddyFreq: 0.65, eddyPhase: 4.5, z: 0.08, size: 1.28, color: '#ffffff' },
  { isCore: false, armIndex: 0, theta0: 9.90, speed: 0.075, transverse: 0.16, eddyFreq: 0.55, eddyPhase: 2.1, z: 0.05, size: 1.10, color: '#ffffff' },

  // C. 旋臂 2 (Arm 1) 上的流体飘浮明珠 (对向旋臂流线向中心聚拢漂移)
  { isCore: false, armIndex: 1, theta0: 1.70, speed: 0.100, transverse: -0.15, eddyFreq: 0.85, eddyPhase: 1.1, z: 0.06, size: 1.45, color: '#ffffff' },
  { isCore: false, armIndex: 1, theta0: 3.90, speed: 0.090, transverse: 0.18, eddyFreq: 0.8, eddyPhase: 2.7, z: 0.04, size: 1.10, color: '#fed7aa' },
  { isCore: false, armIndex: 1, theta0: 6.10, speed: 0.085, transverse: -0.12, eddyFreq: 0.7, eddyPhase: 0.9, z: 0.05, size: 1.15, color: '#bae6fd' },
  { isCore: false, armIndex: 1, theta0: 8.30, speed: 0.080, transverse: 0.10, eddyFreq: 0.6, eddyPhase: 5.0, z: 0.05, size: 1.00, color: '#7dd3fc' },
  { isCore: false, armIndex: 1, theta0: 10.2, speed: 0.075, transverse: -0.06, eddyFreq: 0.5, eddyPhase: 3.6, z: 0.04, size: 1.05, color: '#ffffff' },
];

export const SpiralGalaxy: React.FC<SpiralGalaxyProps> = ({
  opacity = 1.0,
  warpFactor = 0.0,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const shaderMatRef = useRef<THREE.ShaderMaterial>(null);
  const coreGlowRef = useRef<THREE.Mesh>(null);
  const coreGlowOuterRef = useRef<THREE.Mesh>(null);
  const heroMeshRefs = useRef<Array<THREE.Mesh | null>>([]);

  // 1. 生成高精光学纹理
  const glintTexture = useMemo(() => createDiffractionGlintTexture(), []);
  const coreGlowTexture = useMemo(() => createCoreGlowTexture(), []);

  // 2. 程序化生成双悬臂流体属性与星系粒子流线参数
  const { geometry } = useMemo(() => {
    const TOTAL_STARS = 4600;

    const positions = new Float32Array(TOTAL_STARS * 3);
    const col = new Float32Array(TOTAL_STARS * 3);
    const siz = new Float32Array(TOTAL_STARS);
    const flowParams = new Float32Array(TOTAL_STARS * 4); // theta0/radius, armAngle/angle0, speed, transverse
    const miscParams = new Float32Array(TOTAL_STARS * 4); // isType, twinklePhase, baseAlpha, eddyFreq
    const extraParams = new Float32Array(TOTAL_STARS * 2); // eddyPhase, baseZ

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

    // A. 致密白炽核心旋涡群 (750 颗)
    const CORE_STARS = 750;
    for (let i = 0; i < CORE_STARS; i++) {
      const isType = 1.0;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.pow(Math.random(), 2.2) * 1.55;
      // 核心速度因子（中心稍快，但整体更加宁静悠扬，~0.13）
      const speed = 0.13 + (Math.random() - 0.5) * 0.04;
      const baseZ = (Math.random() - 0.5) * 0.45 * (1.0 - radius / 1.6);
      const twinklePhase = Math.random() * 10;
      const baseAlpha = 0.85 + Math.random() * 0.15;
      const size = radius < 0.7 ? 4.2 + Math.random() * 5.0 : 2.8 + Math.random() * 3.8;

      // 初始空间坐标
      positions[idx * 3] = radius * Math.cos(angle);
      positions[idx * 3 + 1] = radius * Math.sin(angle);
      positions[idx * 3 + 2] = baseZ;

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

      siz[idx] = size;

      flowParams[idx * 4] = radius;
      flowParams[idx * 4 + 1] = angle;
      flowParams[idx * 4 + 2] = speed;
      flowParams[idx * 4 + 3] = 0.0;

      miscParams[idx * 4] = isType;
      miscParams[idx * 4 + 1] = twinklePhase;
      miscParams[idx * 4 + 2] = baseAlpha;
      miscParams[idx * 4 + 3] = 1.0;

      extraParams[idx * 2] = 0.0;
      extraParams[idx * 2 + 1] = baseZ;

      idx++;
    }

    // B. 对数双旋臂流体星河 (3500 颗，向心流体)
    const ARM_STARS = TOTAL_STARS - CORE_STARS - 350;
    const ARMS_COUNT = 2;

    for (let i = 0; i < ARM_STARS; i++) {
      const isType = 0.0;
      const armIndex = i % ARMS_COUNT;
      const armAngle = armIndex * Math.PI; // 悬臂相差 180 度

      // 沿旋臂分布，初始位置随机分布在整条悬臂河流上
      const t = Math.pow(Math.random(), 0.85);
      const theta0 = THETA_MIN + t * THETA_SPAN;

      // 流速分布：舒缓宁静的向心漂移速度 ~0.088 rad/s
      const speed = 0.088 + (Math.random() - 0.5) * 0.03;

      // 横向航道分布：正态聚拢于河道中心
      const u = Math.random() - 0.5 + Math.random() - 0.5;
      const transverse = u * 1.1;

      // 涡流频率与相位：更舒缓的水波晃动
      const eddyFreq = 0.75 + Math.random() * 0.6;
      const eddyPhase = Math.random() * Math.PI * 2;
      const baseZ = (Math.random() - 0.5) * 0.45;
      const twinklePhase = Math.random() * 10;

      // 计算初始静态位置
      const baseRadius = BASE_A * Math.exp(SPIRAL_B * theta0);
      const armWidth = 0.18 + baseRadius * 0.13;
      const eddy = Math.sin(eddyPhase) * (armWidth * 0.24);
      const radialOffset = transverse * armWidth + eddy;
      const tangential = Math.cos(eddyPhase) * (armWidth * 0.12);
      const r = baseRadius + radialOffset;
      const finalAngle = theta0 + armAngle + tangential / Math.max(0.5, r);

      positions[idx * 3] = r * Math.cos(finalAngle);
      positions[idx * 3 + 1] = r * Math.sin(finalAngle);
      positions[idx * 3 + 2] = baseZ * Math.max(0.18, 1.0 - baseRadius * 0.07);

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
      let size: number;
      let baseAlpha: number;
      if (Math.random() < 0.65) {
        size = 2.2 + Math.random() * 2.5;
        baseAlpha = 0.70 + Math.random() * 0.25;
      } else {
        size = 4.2 + Math.random() * 4.8;
        baseAlpha = 0.88 + Math.random() * 0.12;
      }

      siz[idx] = size;

      flowParams[idx * 4] = theta0;
      flowParams[idx * 4 + 1] = armAngle;
      flowParams[idx * 4 + 2] = speed;
      flowParams[idx * 4 + 3] = transverse;

      miscParams[idx * 4] = isType;
      miscParams[idx * 4 + 1] = twinklePhase;
      miscParams[idx * 4 + 2] = baseAlpha;
      miscParams[idx * 4 + 3] = eddyFreq;

      extraParams[idx * 2] = eddyPhase;
      extraParams[idx * 2 + 1] = baseZ;

      idx++;
    }

    // C. 深空背景漂移弱星 (350 颗)
    const BG_STARS = TOTAL_STARS - idx;
    for (let i = 0; i < BG_STARS; i++) {
      const isType = 2.0;
      const bgRadius = 2.2 + Math.random() * 8.5;
      const bgAngle0 = Math.random() * Math.PI * 2;
      const baseZ = (Math.random() - 0.5) * 1.5;
      const twinklePhase = Math.random() * 10;
      const baseAlpha = 0.35 + Math.random() * 0.35;
      const size = 1.4 + Math.random() * 2.2;

      positions[idx * 3] = bgRadius * Math.cos(bgAngle0);
      positions[idx * 3 + 1] = bgRadius * Math.sin(bgAngle0);
      positions[idx * 3 + 2] = baseZ;

      const c = Math.random() < 0.2 ? amberColors[0] : (Math.random() < 0.5 ? whiteColor : icyBlueColors[0]);
      col[idx * 3] = c.r;
      col[idx * 3 + 1] = c.g;
      col[idx * 3 + 2] = c.b;

      siz[idx] = size;

      flowParams[idx * 4] = bgRadius;
      flowParams[idx * 4 + 1] = bgAngle0;
      flowParams[idx * 4 + 2] = 0.004;
      flowParams[idx * 4 + 3] = 0.0;

      miscParams[idx * 4] = isType;
      miscParams[idx * 4 + 1] = twinklePhase;
      miscParams[idx * 4 + 2] = baseAlpha;
      miscParams[idx * 4 + 3] = 1.0;

      extraParams[idx * 2] = 0.0;
      extraParams[idx * 2 + 1] = baseZ;

      idx++;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geom.setAttribute('aFlowParams', new THREE.BufferAttribute(flowParams, 4));
    geom.setAttribute('aMiscParams', new THREE.BufferAttribute(miscParams, 4));
    geom.setAttribute('aExtraParams', new THREE.BufferAttribute(extraParams, 2));

    // 计算实际包围球体，避免视锥体剔除错误
    geom.computeBoundingSphere();

    return { geometry: geom };
  }, []);

  // 3. 着色器材质 Uniforms
  const shaderUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uWarp: { value: 0 },
    uGlobalOpacity: { value: opacity },
    uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
  }), []);

  // 4. 逐帧动力学：向心流线漂移驱动与 Hero 明星漂浮定位
  useFrame((state, delta) => {
    const time = state.clock.getElapsedTime();

    // 整个星系外部只保留极其微弱的慢速漫游漂移（~0.003 rad/s），同向内旋
    if (groupRef.current) {
      groupRef.current.rotation.z -= delta * 0.003;
    }

    if (shaderMatRef.current) {
      shaderMatRef.current.uniforms.uTime.value = time;
      shaderMatRef.current.uniforms.uWarp.value = warpFactor;
      shaderMatRef.current.uniforms.uGlobalOpacity.value = opacity;
    }

    // 核心星云柔和呼吸与内层漩涡自旋 (同向内旋，更加舒缓)
    if (coreGlowRef.current) {
      coreGlowRef.current.rotation.z -= delta * 0.02;
      const pulse = 1.0 + Math.sin(time * 1.4) * 0.04;
      const warpScale = 1.0 + warpFactor * 3.5;
      coreGlowRef.current.scale.set(pulse * warpScale, pulse * warpScale, 1);

      const mat = coreGlowRef.current.material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = (0.92 + Math.sin(time * 1.8) * 0.08) * opacity * (1.0 + warpFactor * 1.5);
      }
    }

    if (coreGlowOuterRef.current) {
      coreGlowOuterRef.current.rotation.z -= delta * 0.01;
      const pulseOuter = 1.0 + Math.sin(time * 1.0 + 1.0) * 0.05;
      const warpScale = 1.0 + warpFactor * 4.0;
      coreGlowOuterRef.current.scale.set(pulseOuter * warpScale, pulseOuter * warpScale, 1);

      const matOuter = coreGlowOuterRef.current.material as THREE.MeshBasicMaterial;
      if (matOuter) {
        matOuter.opacity = (0.55 + Math.sin(time * 1.2) * 0.05) * opacity * (1.0 + warpFactor * 2.0);
      }
    }

    // 5. Hero 明星实时向心漂浮位置计算（严格同步向心流线动力学）
    HERO_STAR_CONFIGS.forEach((cfg, idx) => {
      const mesh = heroMeshRefs.current[idx];
      if (!mesh) return;

      let x = 0;
      let y = 0;
      let z = cfg.z;
      let streamAlpha = 1.0;

      if (cfg.isCore) {
        // 核心漩涡差动 (向内同向漩涡)
        const omega = cfg.speed / (0.42 + cfg.radius * 0.85);
        const angle = cfg.angle0 - time * omega;
        x = cfg.radius * Math.cos(angle);
        y = cfg.radius * Math.sin(angle);
      } else {
        // 悬臂流线向心漂移（星河流体向核心方向聚拢流动）
        const raw = (cfg.theta0 - time * cfg.speed - THETA_MIN) % THETA_SPAN;
        const offset = ((raw % THETA_SPAN) + THETA_SPAN) % THETA_SPAN;
        const currentTheta = offset + THETA_MIN;

        const baseRadius = BASE_A * Math.exp(SPIRAL_B * currentTheta);
        const armWidth = 0.18 + baseRadius * 0.13;
        const eddy = Math.sin(time * cfg.eddyFreq + cfg.eddyPhase) * (armWidth * 0.24);
        const tangential = Math.cos(time * cfg.eddyFreq * 0.85 + cfg.eddyPhase) * (armWidth * 0.12);

        const r = baseRadius + cfg.transverse * armWidth + eddy;
        const finalAngle = currentTheta + cfg.armIndex * Math.PI + tangential / Math.max(0.5, r);

        x = r * Math.cos(finalAngle);
        y = r * Math.sin(finalAngle);

        const s = (currentTheta - THETA_MIN) / THETA_SPAN;
        const fadeIn = Math.min(1.0, Math.max(0.0, (1.0 - s) / 0.12));
        const fadeOut = Math.min(1.0, Math.max(0.0, s / 0.08));
        streamAlpha = fadeIn * fadeOut;
      }

      const warpOffset = warpFactor * 2.5;
      const posX = x * (1 + warpOffset * 0.2);
      const posY = y * (1 + warpOffset * 0.2);
      const posZ = z + warpOffset * 0.5;

      mesh.position.set(posX, posY, posZ);
      mesh.rotation.z += delta * 0.08; // 十字星芒缓慢自旋微闪

      const starMat = mesh.material as THREE.MeshBasicMaterial;
      if (starMat) {
        starMat.opacity = 0.95 * opacity * streamAlpha * (1 - warpFactor * 0.4);
      }
    });
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

      {/* 2. 数千颗全景对数旋臂星体与微光星粉 (GPU Inward Streamline Fluid Points) */}
      <points geometry={geometry} frustumCulled={false}>
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

      {/* 3. 严格同步向心流体漂浮运动的 12 颗 Hero 明星与 4 芒十字衍射星芒 (Diffraction Spikes) */}
      <group>
        {HERO_STAR_CONFIGS.map((star, idx) => (
          <mesh
            key={`hero-star-${idx}`}
            ref={(el) => { heroMeshRefs.current[idx] = el; }}
            position={[0, 0, star.z]}
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
        ))}
      </group>
    </group>
  );
};
