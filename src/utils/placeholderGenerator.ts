import * as THREE from 'three';

const placeholderCache = new Map<string, THREE.CanvasTexture>();

const GRADIENT_PALETTES = [
  ['#0f172a', '#1e293b', '#0284c7'], // 深空海蓝
  ['#18181b', '#27272a', '#0d9488'], // 极光黛绿
  ['#1e1b4b', '#312e81', '#6366f1'], // 幻夜星云
  ['#172554', '#1e3a8a', '#38bdf8'], // 冰川幽蓝
  ['#09090b', '#1c1917', '#d97706'], // 暮光晚霞
  ['#042f2e', '#115e59', '#2dd4bf'], // 碧波湖畔
];

/**
 * 0ms 纯本地生成电影感微光渐变卡片占位图（保证在无网/弱网/断网环境下 100% 呈现高保真视觉）
 */
export function getCardPlaceholderTexture(title: string, location: string, id: string): THREE.CanvasTexture {
  if (placeholderCache.has(id)) {
    return placeholderCache.get(id)!;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  const ctx = canvas.getContext('2d')!;

  // 基于 ID 选择协调渐变色板
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash += id.charCodeAt(i);
  const palette = GRADIENT_PALETTES[hash % GRADIENT_PALETTES.length];

  // 1. 绘制纵深径向+线性混合背景
  const grad = ctx.createLinearGradient(0, 0, 600, 400);
  grad.addColorStop(0, palette[0]);
  grad.addColorStop(0.5, palette[1]);
  grad.addColorStop(1, palette[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 600, 400);

  // 2. 绘制微光几何星芒装饰
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.beginPath();
  ctx.arc(450, 100, 120, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.beginPath();
  ctx.arc(150, 300, 160, 0, Math.PI * 2);
  ctx.fill();

  // 3. 绘制相框网格暗纹
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 40; x < 600; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 400);
    ctx.stroke();
  }

  // 4. 绘制地点与标题标识
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(title.slice(0, 14), 40, 320);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '18px "PingFang SC", sans-serif';
  ctx.fillText(`📍 ${location.split(' · ')[0]}`, 40, 355);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  placeholderCache.set(id, texture);

  return texture;
}
