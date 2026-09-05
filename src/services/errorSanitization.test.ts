import { describe, it, expect, vi } from 'vitest';
import {
  createServerErrorResponse,
  createAuthErrorResponse,
  createApiErrorResponse,
} from '../../functions/api/_auth';
import { onRequest as handleMedia } from '../../functions/api/media/[photoId]/[variant]';
import { onRequest as handleDownload } from '../../functions/api/photos/[photoId]/download';
import { onRequestGet as handlePhotos } from '../../functions/api/photos';

describe('API 错误响应脱敏与内部实现细节防泄露测试 (Error Sanitization)', () => {
  describe('1. 基础错误响应脱敏工具 (_auth.ts)', () => {
    it('createServerErrorResponse 必须隐藏内部错误详情并返回统一状态码与 requestId', async () => {
      const sensitiveError = new Error('SqliteError: syntax error near "WHERE id = " (table: secret_users)');
      const req = new Request('https://loveqin.wang/api/photos', {
        headers: { 'cf-ray': 'ray_mock_test_123456' },
      });

      const res = createServerErrorResponse(sensitiveError, 'TestContext', req);
      expect(res.status).toBe(500);
      expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      expect(res.headers.get('Cache-Control')).toBe('no-store');

      const body = await res.json();
      expect(body.error).toBe('INTERNAL_SERVER_ERROR');
      expect(body.requestId).toBe('ray_mock_test_123456');

      // 关键安全断言：绝对不能向客户端泄露原始 SQL 报错、表名或敏感细节
      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain('SqliteError');
      expect(jsonStr).not.toContain('secret_users');
      expect(jsonStr).not.toContain('syntax error');
    });

    it('createAuthErrorResponse 应该规范化错误码并附加 no-store 缓存头', async () => {
      const res401 = createAuthErrorResponse(401, 'UNAUTHORIZED');
      expect(res401.status).toBe(401);
      expect(res401.headers.get('Cache-Control')).toBe('no-store');
      expect(await res401.json()).toEqual({ error: 'UNAUTHORIZED' });

      const resWithMsg = createAuthErrorResponse(403, 'FORBIDDEN: 无权访问该家庭空间');
      expect(resWithMsg.status).toBe(403);
      const body403 = await resWithMsg.json();
      expect(body403.error).toBe('FORBIDDEN');
      expect(body403.message).toBe('无权访问该家庭空间');
    });

    it('createApiErrorResponse 应该支持自定义状态码与业务错误码', async () => {
      const res404 = createApiErrorResponse(404, 'RESOURCE_NOT_FOUND', '资源不存在');
      expect(res404.status).toBe(404);
      expect(await res404.json()).toEqual({
        error: 'RESOURCE_NOT_FOUND',
        message: '资源不存在',
      });
    });
  });

  describe('2. 媒体流式端点 (GET /api/media/:photoId/:variant) 零 r2Key 泄露断言', () => {
    it('当 R2 对象存储中文件缺失时，返回 404 且响应体绝不泄露内部 r2Key 路径', async () => {
      const photoId = 'photo_sec_test_1';
      const mockHouseholdId = 'hh_sec_1';

      const mockDb: any = {
        prepare: vi.fn().mockImplementation((sql: string) => ({
          bind: vi.fn().mockImplementation((..._args: any[]) => {
            if (sql.includes('SELECT id, household_id, status, deleted_at FROM photos')) {
              return {
                first: vi.fn().mockResolvedValue({
                  id: photoId,
                  household_id: mockHouseholdId,
                  status: 'ready',
                  deleted_at: null,
                }),
              };
            }
            if (sql.includes('SELECT r2_key, mime_type FROM photo_assets')) {
              return {
                first: vi.fn().mockResolvedValue({
                  r2_key: `internal_vault/nested_secret_path/${mockHouseholdId}/${photoId}.webp`,
                  mime_type: 'image/webp',
                }),
              };
            }
            if (sql.includes('FROM users u')) {
              return {
                first: vi.fn().mockResolvedValue({
                  user_id: 'user_test_1',
                  display_name: '测试用户',
                  email: 'test@loveqin.wang',
                  user_status: 'active',
                  household_id: mockHouseholdId,
                  member_role: 'member',
                  member_status: 'active',
                }),
              };
            }
            return {
              first: vi.fn().mockResolvedValue(null),
              all: vi.fn().mockResolvedValue({ results: [] }),
            };
          }),
        })),
      };

      const mockBucket: any = {
        get: vi.fn().mockResolvedValue(null), // 模拟 R2 对象缺失
      };

      const req = new Request(`https://loveqin.wang/api/media/${photoId}/display`, {
        headers: { 'x-dev-mock-email': 'test@loveqin.wang' },
      });

      const res = await handleMedia({
        request: req,
        env: { DB: mockDb, BUCKET: mockBucket, ENVIRONMENT: 'local' } as any,
        params: { photoId, variant: 'display' },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('MEDIA_NOT_FOUND');

      // 核心安全红线：绝不暴露内部 r2Key 与目录结构
      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain('r2Key');
      expect(jsonStr).not.toContain('internal_vault');
      expect(jsonStr).not.toContain('nested_secret_path');
      expect(body.r2Key).toBeUndefined();
    });

    it('数据库抛出内部异常时，媒体端点返回 500 脱敏响应且绝不泄露异常原文', async () => {
      const mockDb: any = {
        prepare: vi.fn().mockImplementation(() => {
          throw new Error('D1_INTERNAL_CRASH: disk I/O error or constraint violation in sqlite');
        }),
      };

      const req = new Request('https://loveqin.wang/api/media/p1/display', {
        headers: { 'x-dev-mock-email': 'test@loveqin.wang' },
      });

      const res = await handleMedia({
        request: req,
        env: { DB: mockDb, BUCKET: {} as any, ENVIRONMENT: 'local' } as any,
        params: { photoId: 'p1', variant: 'display' },
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('INTERNAL_SERVER_ERROR');
      expect(body.requestId).toBeDefined();

      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain('D1_INTERNAL_CRASH');
      expect(jsonStr).not.toContain('sqlite');
    });
  });

  describe('3. 原图下载端点 (GET /api/photos/:photoId/download) 零 r2Key 泄露断言', () => {
    it('当 R2 原图文件缺失时，返回 404 且绝不泄露 r2Key 内部路径', async () => {
      const photoId = 'photo_download_sec_1';
      const mockHouseholdId = 'hh_sec_2';

      const mockDb: any = {
        prepare: vi.fn().mockImplementation((sql: string) => ({
          bind: vi.fn().mockImplementation((..._args: any[]) => {
            if (sql.includes('SELECT id, household_id, original_filename')) {
              return {
                first: vi.fn().mockResolvedValue({
                  id: photoId,
                  household_id: mockHouseholdId,
                  original_filename: 'family_raw.dng',
                  status: 'ready',
                  deleted_at: null,
                }),
              };
            }
            if (sql.includes('SELECT r2_key, mime_type FROM photo_assets')) {
              return {
                first: vi.fn().mockResolvedValue({
                  r2_key: `raw_storage_vault/${mockHouseholdId}/originals/${photoId}.dng`,
                  mime_type: 'image/x-adobe-dng',
                }),
              };
            }
            if (sql.includes('FROM users u')) {
              return {
                first: vi.fn().mockResolvedValue({
                  user_id: 'user_test_2',
                  display_name: '测试用户2',
                  email: 'test2@loveqin.wang',
                  user_status: 'active',
                  household_id: mockHouseholdId,
                  member_role: 'member',
                  member_status: 'active',
                }),
              };
            }
            return {
              first: vi.fn().mockResolvedValue(null),
              all: vi.fn().mockResolvedValue({ results: [] }),
            };
          }),
        })),
      };

      const mockBucket: any = {
        get: vi.fn().mockResolvedValue(null), // 模拟原图缺失
      };

      const req = new Request(`https://loveqin.wang/api/photos/${photoId}/download`, {
        headers: { 'x-dev-mock-email': 'test2@loveqin.wang' },
      });

      const res = await handleDownload({
        request: req,
        env: { DB: mockDb, BUCKET: mockBucket, ENVIRONMENT: 'local' } as any,
        params: { photoId },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('RAW_FILE_NOT_FOUND');

      // 核心安全红线：绝不暴露内部原图 r2Key
      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain('r2Key');
      expect(jsonStr).not.toContain('raw_storage_vault');
      expect(body.r2Key).toBeUndefined();
    });

    it('数据库抛出内部异常时，下载端点返回 500 脱敏响应', async () => {
      const mockDb: any = {
        prepare: vi.fn().mockImplementation(() => {
          throw new Error('D1_CORRUPTED_ERROR: table photos is malformed');
        }),
      };

      const req = new Request('https://loveqin.wang/api/photos/p1/download', {
        headers: { 'x-dev-mock-email': 'test@loveqin.wang' },
      });

      const res = await handleDownload({
        request: req,
        env: { DB: mockDb, BUCKET: {} as any, ENVIRONMENT: 'local' } as any,
        params: { photoId: 'p1' },
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('INTERNAL_SERVER_ERROR');
      expect(JSON.stringify(body)).not.toContain('D1_CORRUPTED_ERROR');
    });
  });

  describe('4. 照片列表端点 (GET /api/photos) 内部异常脱敏断言', () => {
    it('数据库故障或 SQL 错误时，照片列表端点返回 500 脱敏响应且绝不向客户端泄露 SQL 或表名', async () => {
      const mockDb: any = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes('FROM users u')) {
            return {
              bind: vi.fn().mockReturnValue({
                first: vi.fn().mockResolvedValue({
                  user_id: 'user_err_test',
                  display_name: '异常测试',
                  email: 'err@loveqin.wang',
                  user_status: 'active',
                  household_id: 'hh_err',
                  member_role: 'member',
                  member_status: 'active',
                }),
              }),
            };
          }
          // 照片列表查询抛出带敏感 schema 信息的数据库异常
          throw new Error('SqliteError: no such column: sensitive_internal_token in "photos" schema');
        }),
      };

      const req = new Request('https://loveqin.wang/api/photos', {
        headers: { 'x-dev-mock-email': 'err@loveqin.wang' },
      });

      const res = await handlePhotos({
        request: req,
        env: { DB: mockDb, BUCKET: {} as any, ENVIRONMENT: 'local' } as any,
        params: {},
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('INTERNAL_SERVER_ERROR');
      expect(body.requestId).toBeDefined();

      const jsonStr = JSON.stringify(body);
      expect(jsonStr).not.toContain('SqliteError');
      expect(jsonStr).not.toContain('sensitive_internal_token');
    });
  });
});
