/**
 * Web Crypto 标准安全加密工具模块
 * 适用于 Cloudflare Workers / Pages Functions 边缘运行时与现代化标准环境
 */

/**
 * 生成 32 字节高熵随机 Token (Hex)
 */
export function generateTokenWeb(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 哈希 (Hex)
 */
export async function sha256Web(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * PBKDF2 密码加盐慢哈希 (100,000 次迭代, SHA-512, 64 字节密钥)
 * 返回格式: `${saltHex}:${keyHex}`
 */
export async function hashPasswordWeb(password: string): Promise<string> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const saltHex = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-512',
    },
    keyMaterial,
    512 // 512 bits = 64 bytes
  );

  const keyHex = Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${keyHex}`;
}

/**
 * 恒定时间密码比对校验（防御时序攻击）
 */
export async function verifyPasswordWeb(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [saltHex, keyHex] = parts;
  if (!saltHex || !keyHex) return false;

  const hexPairs = saltHex.match(/.{1,2}/g);
  if (!hexPairs) return false;
  const saltBytes = new Uint8Array(hexPairs.map((byte) => parseInt(byte, 16)));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-512',
    },
    keyMaterial,
    512
  );

  const derivedHex = Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, '0')).join('');

  // 恒定时间比对
  if (derivedHex.length !== keyHex.length) return false;
  let diff = 0;
  for (let i = 0; i < derivedHex.length; i++) {
    diff |= derivedHex.charCodeAt(i) ^ keyHex.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 生成安全的 Session Cookie 响应头
 */
export function buildSessionCookie(token: string, maxAgeSeconds: number = 30 * 24 * 3600): string {
  return `session_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * 生成清空 Session Cookie 的响应头
 */
export function buildClearSessionCookie(): string {
  return `session_token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
