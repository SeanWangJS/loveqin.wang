import crypto from 'crypto';

/**
 * 生成安全的随机 UUID
 */
export function generateId(prefix: string = ''): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid.replace(/-/g, '')}` : uuid;
}

/**
 * 生成安全的 32 字节高熵随机 Token (Hex)
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * SHA-256 哈希（用于存储会话 Token 和 邀请 Token，杜绝明文 Token 泄漏风险）
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * PBKDF2 密码加盐慢哈希（100,000 次迭代，SHA-512，兼容边缘运行时与 Node.js）
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * 恒定时间密码比对校验（防御时序攻击 Timing Attack）
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;

  return new Promise((resolve) => {
    crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
      if (err) return resolve(false);
      const keyBuffer = Buffer.from(key, 'hex');
      const match = crypto.timingSafeEqual(derivedKey, keyBuffer);
      resolve(match);
    });
  });
}
