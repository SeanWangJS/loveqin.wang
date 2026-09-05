import { describe, it, expect, vi } from 'vitest';
import { isLoopbackAddress, extractDevAuth, createDevApiMiddleware } from '../server/devApiMiddleware';
import type { Connect } from 'vite';

function createMockReqRes(options: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}) {
  const req = {
    url: options.url || '/api/photos',
    method: options.method || 'GET',
    headers: options.headers || {},
    socket: {
      remoteAddress: options.remoteAddress ?? '127.0.0.1',
    },
  } as unknown as Connect.IncomingMessage;

  let statusCode = 200;
  const headers: Record<string, string> = {};
  let body = '';

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader: vi.fn((key: string, val: string) => {
      headers[key.toLowerCase()] = val;
    }),
    getHeader: vi.fn((key: string) => headers[key.toLowerCase()]),
    end: vi.fn((chunk?: any) => {
      if (chunk) {
        body = typeof chunk === 'string' ? chunk : chunk.toString();
      }
    }),
  };

  return {
    req,
    res,
    getStatus: () => statusCode,
    getHeader: (key: string) => headers[key.toLowerCase()],
    getBodyJson: () => (body ? JSON.parse(body) : null),
  };
}

describe('Vite 开发 API 代理安全隔离测试 (devApiMiddleware.ts)', () => {
  describe('1. 本地回环地址安全防护 (Loopback Guard)', () => {
    it('isLoopbackAddress 应该精准判定回环与非回环地址', () => {
      expect(isLoopbackAddress('127.0.0.1')).toBe(true);
      expect(isLoopbackAddress('::1')).toBe(true);
      expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
      expect(isLoopbackAddress('localhost')).toBe(true);
      expect(isLoopbackAddress(undefined)).toBe(true); // mock default

      // 局域网或公网 IP 必须判定为非回环
      expect(isLoopbackAddress('192.168.1.100')).toBe(false);
      expect(isLoopbackAddress('10.0.0.5')).toBe(false);
      expect(isLoopbackAddress('172.16.0.1')).toBe(false);
      expect(isLoopbackAddress('8.8.8.8')).toBe(false);
    });

    it('来自局域网非回环 IP 的 API 请求必须坚决拦截并返回 403 Forbidden', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/api/photos',
        method: 'GET',
        remoteAddress: '192.168.1.50',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(mock.getStatus()).toBe(403);
      expect(mock.getBodyJson()?.error).toBe('FORBIDDEN_NON_LOOPBACK');
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('2. 显式开发凭据安全校验 (Fail-Closed)', () => {
    it('extractDevAuth: 无凭据时返回 authenticated: false', () => {
      const req = { headers: {} } as Connect.IncomingMessage;
      const res = extractDevAuth(req);
      expect(res.authenticated).toBe(false);
      expect(res.reason).toBe('DEV_AUTH_REQUIRED');
    });

    it('extractDevAuth: 携带 Cookie 或 Header 时成功识别', () => {
      // Cookie
      const reqWithCookie = { headers: { cookie: 'dev_session=local_viewer; other=1' } } as unknown as Connect.IncomingMessage;
      expect(extractDevAuth(reqWithCookie).authenticated).toBe(true);

      // x-local-dev-auth
      const reqWithHeader = { headers: { 'x-local-dev-auth': '1' } } as unknown as Connect.IncomingMessage;
      expect(extractDevAuth(reqWithHeader).authenticated).toBe(true);

      // x-dev-mock-email
      const reqWithMockEmail = { headers: { 'x-dev-mock-email': 'qin@loveqin.wang' } } as unknown as Connect.IncomingMessage;
      const authMockEmail = extractDevAuth(reqWithMockEmail);
      expect(authMockEmail.authenticated).toBe(true);
      expect(authMockEmail.user?.email).toBe('qin@loveqin.wang');
    });

    it('无开发凭据访问 GET /api/photos 必须返回 401 DEV_AUTH_REQUIRED', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/api/photos',
        method: 'GET',
        remoteAddress: '127.0.0.1',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(mock.getStatus()).toBe(401);
      expect(mock.getBodyJson()?.error).toBe('DEV_AUTH_REQUIRED');
      expect(next).not.toHaveBeenCalled();
    });

    it('无开发凭据访问 GET /api/media/:photoId/:variant 必须返回 401', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/api/media/photo_123/thumb_low',
        method: 'GET',
        remoteAddress: '127.0.0.1',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(mock.getStatus()).toBe(401);
      expect(mock.getBodyJson()?.error).toBe('DEV_AUTH_REQUIRED');
    });

    it('无开发凭据访问 GET /api/photos/:photoId/download 必须返回 401', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/api/photos/photo_123/download',
        method: 'GET',
        remoteAddress: '127.0.0.1',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(mock.getStatus()).toBe(401);
      expect(mock.getBodyJson()?.error).toBe('DEV_AUTH_REQUIRED');
    });

    it('无开发凭据访问 GET /api/auth/session 必须返回 401', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/api/auth/session',
        method: 'GET',
        remoteAddress: '127.0.0.1',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(mock.getStatus()).toBe(401);
      expect(mock.getBodyJson()?.authenticated).toBe(false);
      expect(mock.getBodyJson()?.error).toBe('DEV_AUTH_REQUIRED');
    });
  });

  describe('3. 认证通过与会话维持 (Session Activation & Verification)', () => {
    it('携带 x-local-dev-auth 请求 /api/auth/session 成功返回 200 并签发 dev_session Cookie', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/api/auth/session',
        method: 'GET',
        headers: { 'x-local-dev-auth': '1' },
        remoteAddress: '127.0.0.1',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(mock.getStatus()).toBe(200);
      expect(mock.getBodyJson()?.authenticated).toBe(true);
      expect(mock.getBodyJson()?.role).toBe('viewer');
      expect(mock.getHeader('set-cookie')).toContain('dev_session=local_viewer');
    });

    it('POST /api/auth/dev-login 允许开发环境一键激活会话并返回 200', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/api/auth/dev-login',
        method: 'POST',
        remoteAddress: '127.0.0.1',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(mock.getStatus()).toBe(200);
      expect(mock.getBodyJson()?.success).toBe(true);
      expect(mock.getHeader('set-cookie')).toContain('dev_session=local_viewer');
    });

    it('携带 Cookie: dev_session=local_viewer 能够成功请求 /api/photos 并返回列表', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/api/photos',
        method: 'GET',
        headers: { cookie: 'dev_session=local_viewer' },
        remoteAddress: '127.0.0.1',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(mock.getStatus()).toBe(200);
      expect(Array.isArray(mock.getBodyJson())).toBe(true);
    });
  });

  describe('4. 只读契约防线与非 API 路径直通', () => {
    it('即使携带有效开发凭据，对 /api/photos 发起写操作 (POST) 仍强制返回 405', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/api/photos',
        method: 'POST',
        headers: { 'x-local-dev-auth': '1' },
        remoteAddress: '127.0.0.1',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(mock.getStatus()).toBe(405);
      expect(mock.getBodyJson()?.error).toBe('METHOD_NOT_ALLOWED');
      expect(mock.getHeader('allow')).toContain('GET');
    });

    it('静态文件与前端路由请求 (非 /api/) 直接 pass through 至 next()', async () => {
      const middleware = createDevApiMiddleware();
      const next = vi.fn();
      const mock = createMockReqRes({
        url: '/src/App.tsx',
        method: 'GET',
        remoteAddress: '127.0.0.1',
      });

      await middleware(mock.req, mock.res as any, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
