import { describe, it, expect } from 'vitest';
import { getTimeTemperature } from './timeTemperature';

describe('Time Temperature Color Shift System', () => {
  it('should return golden warm theme for year 2021', () => {
    const theme2021 = getTimeTemperature(2021);
    expect(theme2021.pointLightColor.r).toBeGreaterThan(0.9); // Gold/amber is high in red
    expect(theme2021.pointLightColor.b).toBeLessThan(0.2); // Low blue
  });

  it('should return ice-blue theme for year 2026', () => {
    const theme2026 = getTimeTemperature(2026);
    expect(theme2026.pointLightColor.b).toBeGreaterThan(0.9); // Cyan/blue is high in blue
  });

  it('should interpolate smoothly between 2021 and 2026', () => {
    const theme2021 = getTimeTemperature(2021);
    const theme2023 = getTimeTemperature(2023);
    const theme2026 = getTimeTemperature(2026);

    // Blue component should increase monotonically from 2021 to 2026
    expect(theme2021.pointLightColor.b).toBeLessThan(theme2023.pointLightColor.b);
    expect(theme2023.pointLightColor.b).toBeLessThan(theme2026.pointLightColor.b);
  });
});
