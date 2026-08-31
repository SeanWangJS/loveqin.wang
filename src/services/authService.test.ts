import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../drizzle/schema';
import { AuthService } from './authService';

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // 初始化内存表结构
  sqlite.exec(`
    CREATE TABLE households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      welcome_message TEXT,
      original_exif_policy TEXT DEFAULT 'preserve_all',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email_normalized TEXT NOT NULL UNIQUE,
      email_verified_at INTEGER,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      session_version INTEGER DEFAULT 1 NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE household_members (
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL,
      joined_at INTEGER NOT NULL,
      removed_at INTEGER,
      PRIMARY KEY (household_id, user_id)
    );

    CREATE TABLE member_invitations (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      email_normalized TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      session_version INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE albums (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      cover_photo_id TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  return drizzle(sqlite, { schema });
}

describe('AuthService & RBAC Security Engine', () => {
  let authService: AuthService;

  beforeEach(() => {
    const db = createTestDb();
    authService = new AuthService(db);
  });

  it('should initialize Owner and prevent double initialization', async () => {
    const initRes = await authService.initOwner({
      householdName: 'Qin & Wang 的家庭空间',
      email: 'Owner@loveqin.wang',
      displayName: 'Qin',
      password: 'StrongPassword123!',
    });

    expect(initRes.role).toBe('owner');
    expect(initRes.email).toBe('owner@loveqin.wang');
    expect(initRes.sessionToken).toBeDefined();

    // 再次调用初始化应该被严格拒绝
    await expect(
      authService.initOwner({
        householdName: 'Hacked Household',
        email: 'hacker@evil.com',
        displayName: 'Hacker',
        password: 'Password123!',
      })
    ).rejects.toThrow(/INITIALIZATION_ALREADY_COMPLETED/);
  });

  it('should verify login credentials and validate sessions', async () => {
    await authService.initOwner({
      householdName: 'Qin & Wang 的家庭空间',
      email: 'owner@loveqin.wang',
      displayName: 'Qin',
      password: 'StrongPassword123!',
    });

    // 密码错误登录失败
    await expect(
      authService.login('owner@loveqin.wang', 'WrongPassword!')
    ).rejects.toThrow(/INVALID_CREDENTIALS/);

    // 正确登录
    const loginRes = await authService.login('owner@loveqin.wang', 'StrongPassword123!');
    expect(loginRes.role).toBe('owner');
    expect(loginRes.user.displayName).toBe('Qin');

    // 验证 Session Token
    const session = await authService.validateSession(loginRes.sessionToken);
    expect(session).not.toBeNull();
    expect(session?.user.email).toBe('owner@loveqin.wang');
    expect(session?.role).toBe('owner');
  });

  it('should support single-use invitation flow for Members', async () => {
    const owner = await authService.initOwner({
      householdName: 'Qin & Wang 的家庭空间',
      email: 'owner@loveqin.wang',
      displayName: 'Owner',
      password: 'Password123!',
    });

    // Owner 发起邀请
    const invite = await authService.createInvitation(
      owner.householdId,
      owner.userId,
      'member@loveqin.wang'
    );
    expect(invite.rawToken).toBeDefined();
    expect(invite.email).toBe('member@loveqin.wang');

    // 被邀请人接受邀请
    const acceptRes = await authService.acceptInvitation(
      invite.rawToken,
      'Friend Member',
      'MemberPassword123!'
    );
    expect(acceptRes.role).toBe('member');
    expect(acceptRes.sessionToken).toBeDefined();

    // 再次使用同一邀请 Token 必须被拒绝（单次使用保证）
    await expect(
      authService.acceptInvitation(
        invite.rawToken,
        'Another Guy',
        'AnotherPassword!'
      )
    ).rejects.toThrow(/INVALID_OR_EXPIRED_INVITATION/);

    // 验证新 Member 的 Session
    const memberSession = await authService.validateSession(acceptRes.sessionToken);
    expect(memberSession?.role).toBe('member');
    expect(memberSession?.user.displayName).toBe('Friend Member');
  });

  it('should revoke all active sessions on logoutAll', async () => {
    const owner = await authService.initOwner({
      householdName: 'Qin & Wang 的家庭空间',
      email: 'owner@loveqin.wang',
      displayName: 'Owner',
      password: 'Password123!',
    });

    const loginRes = await authService.login('owner@loveqin.wang', 'Password123!');
    expect(await authService.validateSession(loginRes.sessionToken)).not.toBeNull();

    // 全局退出下线
    await authService.logoutAll(owner.userId);

    // 旧 Session 应该全部失效
    expect(await authService.validateSession(loginRes.sessionToken)).toBeNull();
    expect(await authService.validateSession(owner.sessionToken)).toBeNull();
  });
});
