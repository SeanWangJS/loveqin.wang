import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/api/photos/[photoId]/story';

function createMockDb(options: { member?: boolean; changes?: number } = {}) {
  const prepare = vi.fn().mockImplementation((sql: string) => {
    const binding = {
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(
        sql.includes('FROM auth_identities')
          ? null
          : options.member === false
            ? null
            : {
                user_id: 'user_family_1',
                display_name: '家庭成员',
                email: 'family@example.com',
                user_status: 'active',
                household_id: 'household_default',
                member_role: 'member',
                member_status: 'active',
              }
      ),
      run: vi.fn().mockResolvedValue(
        sql.trimStart().startsWith('UPDATE photos')
          ? { success: true, meta: { changes: options.changes ?? 1 } }
          : { success: true }
      ),
    };

    return { bind: vi.fn().mockReturnValue(binding) };
  });

  return { prepare };
}

function createRequest(body: unknown, init: RequestInit = {}) {
  return new Request('https://loveqin.wang/api/photos/photo_1/story', {
    method: 'PATCH',
    headers: {
      Origin: 'https://loveqin.wang',
      'Content-Type': 'application/json',
      'x-dev-mock-email': 'family@example.com',
      ...(init.headers || {}),
    },
    body: JSON.stringify(body),
    ...init,
  });
}

describe('照片故事协作 API', () => {
  it('活跃家庭成员可以修改故事并且只更新 story 字段', async () => {
    const db = createMockDb();
    const response = await onRequest({
      request: createRequest({ story: '那年夏天，我们一起去了海边。' }),
      env: { DB: db, ENVIRONMENT: 'local' },
      params: { photoId: 'photo_1' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 'photo_1',
      story: '那年夏天，我们一起去了海边。',
    });

    const updateCall = db.prepare.mock.calls.find(([sql]) => sql.trimStart().startsWith('UPDATE photos'));
    expect(updateCall?.[0]).toContain('household_id = ?');
  });

  it('没有同源 Origin 时拒绝写入', async () => {
    const response = await onRequest({
      request: createRequest({ story: '不应保存' }, { headers: { Origin: 'https://evil.example' } }),
      env: { DB: createMockDb(), ENVIRONMENT: 'local' },
      params: { photoId: 'photo_1' },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('FORBIDDEN_ORIGIN');
  });

  it('不在活跃家庭白名单中的用户不能修改故事', async () => {
    const response = await onRequest({
      request: createRequest({ story: '不应保存' }),
      env: { DB: createMockDb({ member: false }), ENVIRONMENT: 'local' },
      params: { photoId: 'photo_1' },
    });

    expect(response.status).toBe(401);
  });

  it('照片不属于当前家庭或不可用时返回 404', async () => {
    const response = await onRequest({
      request: createRequest({ story: '不应保存' }),
      env: { DB: createMockDb({ changes: 0 }), ENVIRONMENT: 'local' },
      params: { photoId: 'photo_1' },
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('PHOTO_NOT_FOUND');
  });

  it('拒绝超过 10000 个字符的故事', async () => {
    const response = await onRequest({
      request: createRequest({ story: 'x'.repeat(10001) }),
      env: { DB: createMockDb(), ENVIRONMENT: 'local' },
      params: { photoId: 'photo_1' },
    });

    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe('STORY_TOO_LONG');
  });

  it('其他 HTTP 方法不会被故事接口接受', async () => {
    const response = await onRequest({
      request: new Request('https://loveqin.wang/api/photos/photo_1/story', { method: 'POST' }),
      env: { DB: createMockDb(), ENVIRONMENT: 'local' },
      params: { photoId: 'photo_1' },
    });

    expect(response.status).toBe(405);
  });
});