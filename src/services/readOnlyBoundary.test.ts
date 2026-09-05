import { describe, it, expect, vi } from 'vitest';
import { onRequest as handlePhotos } from '../../functions/api/photos';
import { onRequest as handleDownload } from '../../functions/api/photos/[photoId]/download';
import { onRequest as handleMedia } from '../../functions/api/media/[photoId]/[variant]';
import { onRequest as handleSession } from '../../functions/api/auth/session';
import fs from 'fs';
import path from 'path';

describe('只读发布边界契约测试 (Read-Only Boundary)', () => {
  describe('服务端 405 Method Not Allowed 拦截防线', () => {
    it('POST /api/photos 必须被拒绝并返回 405 及 Allow: GET, HEAD 头', async () => {
      const req = new Request('https://loveqin.wang/api/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Photo' }),
      });

      const res = await handlePhotos({
        request: req,
        env: { DB: {} as any, BUCKET: {} },
        params: {},
      });

      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toContain('GET');
      const body = await res.json();
      expect(body.error).toBe('METHOD_NOT_ALLOWED');
      expect(body.message).toContain('只读发布版本');
    });

    it('DELETE /api/photos 与 PUT /api/photos 必须被拒绝并返回 405', async () => {
      for (const method of ['DELETE', 'PUT', 'PATCH']) {
        const req = new Request('https://loveqin.wang/api/photos', { method });
        const res = await handlePhotos({
          request: req,
          env: { DB: {} as any, BUCKET: {} },
          params: {},
        });
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toContain('GET');
        const body = await res.json();
        expect(body.error).toBe('METHOD_NOT_ALLOWED');
      }
    });

    it('POST /api/photos/:photoId/download 必须被拒绝并返回 405', async () => {
      const req = new Request('https://loveqin.wang/api/photos/photo_123/download', {
        method: 'POST',
      });

      const res = await handleDownload({
        request: req,
        env: { DB: {} as any, BUCKET: {} as any },
        params: { photoId: 'photo_123' },
      });

      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toContain('GET');
      const body = await res.json();
      expect(body.error).toBe('METHOD_NOT_ALLOWED');
    });

    it('POST /api/media/:photoId/:variant 必须被拒绝并返回 405', async () => {
      const req = new Request('https://loveqin.wang/api/media/photo_123/display', {
        method: 'POST',
      });

      const res = await handleMedia({
        request: req,
        env: { DB: {} as any, BUCKET: {} as any },
        params: { photoId: 'photo_123', variant: 'display' },
      });

      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toContain('GET');
      const body = await res.json();
      expect(body.error).toBe('METHOD_NOT_ALLOWED');
    });

    it('POST /api/auth/session 必须被拒绝并返回 405', async () => {
      const req = new Request('https://loveqin.wang/api/auth/session', {
        method: 'POST',
      });

      const res = await handleSession({
        request: req,
        env: { DB: {} as any, BUCKET: {} },
        params: {},
      });

      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toContain('GET');
      const body = await res.json();
      expect(body.error).toBe('METHOD_NOT_ALLOWED');
    });
  });

  describe('普通只读访客 (role: viewer) 具有完整合法的只读读取与下载权限', () => {
    it('普通访客能够正常查询照片列表、派生媒体与原图下载，无需任何 Owner 权限', async () => {
      const mockHouseholdId = 'hh_readonly_test';
      const mockPhotoId = 'p_readonly_1';

      const mockDb: any = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          return {
            bind: vi.fn().mockImplementation((..._args: any[]) => {
              if (sql.includes('FROM users u')) {
                // 白名单核验：返回 active 的用户与家庭成员 (role 为 viewer)
                return {
                  first: vi.fn().mockResolvedValue({
                    user_id: 'user_viewer_1',
                    display_name: '普通访客',
                    email: 'viewer@loveqin.wang',
                    user_status: 'active',
                    household_id: mockHouseholdId,
                    member_role: 'member',
                    member_status: 'active',
                  }),
                };
              }
              if (sql.includes('FROM photos WHERE id = ?')) {
                return {
                  first: vi.fn().mockResolvedValue({
                    id: mockPhotoId,
                    household_id: mockHouseholdId,
                    original_filename: 'family.jpg',
                    status: 'ready',
                    deleted_at: null,
                  }),
                };
              }
              if (sql.includes('SELECT r2_key, mime_type FROM photo_assets')) {
                return {
                  first: vi.fn().mockResolvedValue({
                    r2_key: `originals/${mockHouseholdId}/${mockPhotoId}.jpg`,
                    mime_type: 'image/jpeg',
                  }),
                };
              }
              if (sql.includes('SELECT id, album_id, title, story')) {
                return {
                  all: vi.fn().mockResolvedValue({
                    results: [
                      {
                        id: mockPhotoId,
                        album_id: 'album_1',
                        title: 'Sunset',
                        story: 'Happy memory',
                        taken_at_sort: 1000,
                        taken_at_local: '2023-01-01T12:00:00',
                        location_name: 'Park',
                        width: 1920,
                        height: 1080,
                        exif_safe_json: '{}',
                      },
                    ],
                  }),
                };
              }
              return {
                first: vi.fn().mockResolvedValue(null),
                all: vi.fn().mockResolvedValue({ results: [] }),
              };
            }),
          };
        }),
      };

      const mockBucket: any = {
        get: vi.fn().mockResolvedValue({
          body: new ReadableStream(),
          size: 1024,
          httpEtag: '"mock-etag"',
          httpMetadata: { contentType: 'image/jpeg' },
        }),
      };

      // 1. 照片列表：GET /api/photos
      const listReq = new Request('https://loveqin.wang/api/photos', {
        headers: { 'x-dev-mock-email': 'viewer@loveqin.wang' },
      });
      const listRes = await handlePhotos({
        request: listReq,
        env: { DB: mockDb, BUCKET: mockBucket, ENVIRONMENT: 'local' } as any,
        params: {},
      });
      expect(listRes.status).toBe(200);

      // 2. 派生媒体：GET /api/media/:photoId/display
      const mediaReq = new Request(`https://loveqin.wang/api/media/${mockPhotoId}/display`, {
        headers: { 'x-dev-mock-email': 'viewer@loveqin.wang' },
      });
      const mediaRes = await handleMedia({
        request: mediaReq,
        env: { DB: mockDb, BUCKET: mockBucket, ENVIRONMENT: 'local' } as any,
        params: { photoId: mockPhotoId, variant: 'display' },
      });
      expect(mediaRes.status).toBe(200);

      // 3. 原图下载：GET /api/photos/:photoId/download
      const downloadReq = new Request(`https://loveqin.wang/api/photos/${mockPhotoId}/download`, {
        headers: { 'x-dev-mock-email': 'viewer@loveqin.wang' },
      });
      const downloadRes = await handleDownload({
        request: downloadReq,
        env: { DB: mockDb, BUCKET: mockBucket, ENVIRONMENT: 'local' } as any,
        params: { photoId: mockPhotoId },
      });
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get('Content-Disposition')).toContain('family.jpg');
    });
  });

  describe('前端只读一致性静态验证', () => {
    it('前端组件目录中不得存在任何 alert() 伪交互或未实现的假动作', () => {
      const componentsDir = path.resolve(__dirname, '../components');
      const files = fs.readdirSync(componentsDir, { recursive: true }) as string[];

      for (const file of files) {
        if (file.endsWith('.tsx') || file.endsWith('.ts')) {
          const filePath = path.join(componentsDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          expect(content).not.toContain('alert(');
        }
      }
    });

    it('前端组件与状态中不得包含任何 OwnerStudio 遗留模块', () => {
      const srcDir = path.resolve(__dirname, '..');
      const files = fs.readdirSync(srcDir, { recursive: true }) as string[];

      for (const file of files) {
        if ((file.endsWith('.tsx') || file.endsWith('.ts')) && !file.includes('.test.')) {
          const filePath = path.join(srcDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          expect(content).not.toContain('OwnerStudioDrawer');
          expect(content).not.toContain('BatchUploadPanel');
        }
      }
    });
  });
});
