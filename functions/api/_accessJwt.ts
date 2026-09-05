/**
 * Cloudflare Access JWT 验签工具模块
 * 标准基于 Web Crypto API 实现 RS256 签名与 Claims 校验
 */

export interface AccessJwtPayload {
  aud: string | string[];
  email: string;
  sub: string;
  iss: string;
  exp: number;
  iat: number;
  nbf?: number;
  type?: string;
  identity_nonce?: string;
  custom?: Record<string, unknown>;
}

export interface AccessVerifyConfig {
  teamDomain?: string; // e.g. "loveqin" or "loveqin.cloudflareaccess.com"
  aud?: string;        // e.g. "app-aud-tag"
  environment?: string;// "production" | "preview" | "local"
}

export interface JwkKey {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
  use?: string;
}

// 模块级 JWKS 缓存 (缓存 1 小时)
interface CachedJwks {
  keys: JwkKey[];
  fetchedAt: number;
}

const jwksCache: Record<string, CachedJwks> = {};
const CACHE_TTL_MS = 60 * 60 * 1000;

export function setJwksForTesting(teamDomain: string, keys: JwkKey[]) {
  jwksCache[cleanTeamDomain(teamDomain)] = {
    keys,
    fetchedAt: Date.now(),
  };
}

export function clearJwksCacheForTesting() {
  for (const key of Object.keys(jwksCache)) {
    delete jwksCache[key];
  }
}

function cleanTeamDomain(domain: string): string {
  let cleaned = domain.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, '');
  cleaned = cleaned.replace(/\.cloudflareaccess\.com.*$/, '');
  cleaned = cleaned.replace(/\/.*$/, '');
  return cleaned;
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJwtPart<T>(b64Url: string): T | null {
  try {
    const bytes = base64UrlToUint8Array(b64Url);
    const str = new TextDecoder().decode(bytes);
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/**
 * 获取 Cloudflare Access 官方公钥集合 (JWKS)
 */
async function getAccessJwks(team: string): Promise<JwkKey[]> {
  const now = Date.now();
  const cached = jwksCache[team];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS && cached.keys.length > 0) {
    return cached.keys;
  }

  const certsUrl = `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(certsUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`ACCESS_CERTS_FETCH_FAILED: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { keys?: JwkKey[] };
  const keys = data.keys || [];
  jwksCache[team] = {
    keys,
    fetchedAt: now,
  };
  return keys;
}

/**
 * 校验 Cloudflare Access JWT Assertion
 */
export async function verifyCloudflareAccessJwt(
  jwtString: string | null | undefined,
  config: AccessVerifyConfig
): Promise<AccessJwtPayload | null> {
  if (!jwtString || typeof jwtString !== 'string') {
    return null;
  }

  const parts = jwtString.trim().split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. 解析 Header
  const header = parseJwtPart<{ alg?: string; kid?: string; typ?: string }>(headerB64);
  if (!header || header.alg !== 'RS256' || !header.kid) {
    return null;
  }

  // 2. 解析 Payload
  const payload = parseJwtPart<AccessJwtPayload>(payloadB64);
  if (!payload || !payload.email || !payload.sub || !payload.exp || !payload.iss) {
    return null;
  }

  // 3. 校验有效期 (允许 60 秒时钟误差)
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp + 60 < nowSec) {
    return null;
  }
  if (payload.nbf && payload.nbf - 60 > nowSec) {
    return null;
  }

  // 4. 校验 Audience (若配置了 CF_ACCESS_AUD)
  if (config.aud) {
    const expectedAud = config.aud.trim();
    if (Array.isArray(payload.aud)) {
      if (!payload.aud.includes(expectedAud)) {
        return null;
      }
    } else if (payload.aud !== expectedAud) {
      return null;
    }
  }

  // 5. 校验 Issuer 与验签
  const team = config.teamDomain ? cleanTeamDomain(config.teamDomain) : '';
  if (team) {
    const expectedIssuer = `https://${team}.cloudflareaccess.com`;
    if (payload.iss !== expectedIssuer) {
      return null;
    }

    try {
      const jwks = await getAccessJwks(team);
      const matchedKey = jwks.find((k) => k.kid === header.kid);
      if (!matchedKey) {
        return null;
      }

      const cryptoKey = await crypto.subtle.importKey(
        'jwk',
        {
          kty: 'RSA',
          alg: 'RS256',
          n: matchedKey.n,
          e: matchedKey.e,
          ext: true,
        },
        {
          name: 'RSASSA-PKCS1-v1_5',
          hash: 'SHA-256',
        },
        false,
        ['verify']
      );

      const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
      const signatureBytes = base64UrlToUint8Array(signatureB64);

      const isValid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        signatureBytes as unknown as BufferSource,
        signedData as unknown as BufferSource
      );

      if (!isValid) {
        return null;
      }
    } catch (err) {
      console.error('[AccessJWT] 验签异常:', err);
      return null;
    }
  }

  return payload;
}
