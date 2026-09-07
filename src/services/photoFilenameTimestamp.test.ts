import { describe, expect, it } from 'vitest';
import { parseFilenameTimestamp } from './photoFilenameTimestamp';

describe('parseFilenameTimestamp', () => {
  const referenceNow = Date.UTC(2026, 8, 7);

  it('解析 mmexport 文件名中的 Unix 毫秒时间戳', () => {
    expect(parseFilenameTimestamp('mmexport1495709624210.jpg', referenceNow)).toBe(1495709624210);
  });

  it('支持时间戳位于其他文件名片段之后', () => {
    expect(parseFilenameTimestamp('IMG_2017_1495709624210_copy.jpg', referenceNow)).toBe(1495709624210);
  });

  it('拒绝没有 13 位时间戳或超出合理范围的数字', () => {
    expect(parseFilenameTimestamp('photo-1234567890.jpg', referenceNow)).toBeNull();
    expect(parseFilenameTimestamp('photo-0999999999999.jpg', referenceNow)).toBeNull();
    expect(parseFilenameTimestamp('photo-2999999999999.jpg', referenceNow)).toBeNull();
  });
});
