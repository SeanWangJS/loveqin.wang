import * as THREE from 'three';

export interface TimeTemperatureTheme {
  fogColor: THREE.Color;
  pointLightColor: THREE.Color;
  directionalLightColor: THREE.Color;
  ambientColor: THREE.Color;
  rimColor: THREE.Color;
  name: string;
}

// 三大岁月色温基准锚点（2021 怀旧暖金，2023 青黛晨曦，2026 现代深空冰蓝）
const THEME_2021: TimeTemperatureTheme = {
  fogColor: new THREE.Color('#0d0a07'),
  pointLightColor: new THREE.Color('#f59e0b'),
  directionalLightColor: new THREE.Color('#fbbf24'),
  ambientColor: new THREE.Color('#fef3c7'),
  rimColor: new THREE.Color('#fbbf24'),
  name: '怀旧暖金 (2021)',
};

const THEME_2023: TimeTemperatureTheme = {
  fogColor: new THREE.Color('#070c14'),
  pointLightColor: new THREE.Color('#2dd4bf'),
  directionalLightColor: new THREE.Color('#5eead4'),
  ambientColor: new THREE.Color('#ccfbf1'),
  rimColor: new THREE.Color('#5eead4'),
  name: '青黛晨曦 (2023)',
};

const THEME_2026: TimeTemperatureTheme = {
  fogColor: new THREE.Color('#06080b'),
  pointLightColor: new THREE.Color('#38bdf8'),
  directionalLightColor: new THREE.Color('#e0f2fe'),
  ambientColor: new THREE.Color('#e0f2fe'),
  rimColor: new THREE.Color('#38bdf8'),
  name: '深空冰蓝 (2026)',
};

/**
 * 根据当前活跃年份计算平滑插值的岁月色温配置
 */
export function getTimeTemperature(year: number): TimeTemperatureTheme {
  // 限制年份在 2021 ~ 2026 之间
  const clampedYear = Math.min(2026, Math.max(2021, year));

  if (clampedYear <= 2023) {
    // 2021 -> 2023 插值 (0.0 -> 1.0)
    const factor = (clampedYear - 2021) / (2023 - 2021);
    return {
      fogColor: THEME_2021.fogColor.clone().lerp(THEME_2023.fogColor, factor),
      pointLightColor: THEME_2021.pointLightColor.clone().lerp(THEME_2023.pointLightColor, factor),
      directionalLightColor: THEME_2021.directionalLightColor.clone().lerp(THEME_2023.directionalLightColor, factor),
      ambientColor: THEME_2021.ambientColor.clone().lerp(THEME_2023.ambientColor, factor),
      rimColor: THEME_2021.rimColor.clone().lerp(THEME_2023.rimColor, factor),
      name: `岁月过渡 (${clampedYear})`,
    };
  } else {
    // 2023 -> 2026 插值 (0.0 -> 1.0)
    const factor = (clampedYear - 2023) / (2026 - 2023);
    return {
      fogColor: THEME_2023.fogColor.clone().lerp(THEME_2026.fogColor, factor),
      pointLightColor: THEME_2023.pointLightColor.clone().lerp(THEME_2026.pointLightColor, factor),
      directionalLightColor: THEME_2023.directionalLightColor.clone().lerp(THEME_2026.directionalLightColor, factor),
      ambientColor: THEME_2023.ambientColor.clone().lerp(THEME_2026.ambientColor, factor),
      rimColor: THEME_2023.rimColor.clone().lerp(THEME_2026.rimColor, factor),
      name: `岁月过渡 (${clampedYear})`,
    };
  }
}
