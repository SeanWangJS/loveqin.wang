import { eq, and, isNull, gt, sql } from 'drizzle-orm';
import { AppDatabase } from '../drizzle/db';
import * as schema from '../drizzle/schema';
import { generateId, generateSecureToken, hashPassword, hashToken, verifyPassword } from './cryptoUtils';

export class AuthService {
  constructor(private db: AppDatabase) {}

  /**
   * Owner 首次单次部署初始化（创建家庭空间与初始 Owner 账号）
   */
  async initOwner(params: {
    householdName: string;
    email: string;
    displayName: string;
    password: string;
  }) {
    const existingCount = this.db.select({ count: sql<number>`count(*)` }).from(schema.households).get();
    if (existingCount && existingCount.count > 0) {
      throw new Error('INITIALIZATION_ALREADY_COMPLETED: 家庭空间已完成初始化，禁止重复初始化');
    }

    const now = Date.now();
    const householdId = generateId('hh');
    const userId = generateId('usr');
    const passwordHash = await hashPassword(params.password);
    const emailNormalized = params.email.trim().toLowerCase();

    // 1. 创建家庭空间
    this.db.insert(schema.households).values({
      id: householdId,
      name: params.householdName,
      welcomeMessage: `欢迎来到 ${params.householdName} 的珍藏空间`,
      createdAt: now,
    }).run();

    // 2. 创建用户
    this.db.insert(schema.users).values({
      id: userId,
      emailNormalized,
      emailVerifiedAt: now,
      displayName: params.displayName,
      passwordHash,
      sessionVersion: 1,
      status: 'active',
      createdAt: now,
    }).run();

    // 3. 绑定 Owner 角色
    this.db.insert(schema.householdMembers).values({
      householdId,
      userId,
      role: 'owner',
      status: 'active',
      joinedAt: now,
    }).run();

    // 4. 创建默认相册
    const defaultAlbumId = generateId('alb');
    this.db.insert(schema.albums).values({
      id: defaultAlbumId,
      householdId,
      name: '时光精选相册',
      description: '记录我们一路走来的美好回忆',
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }).run();

    // 5. 生成初始 Session
    const sessionToken = generateSecureToken();
    this.db.insert(schema.sessions).values({
      id: generateId('ses'),
      userId,
      tokenHash: hashToken(sessionToken),
      sessionVersion: 1,
      expiresAt: now + 30 * 86400000, // 30 天有效
      lastSeenAt: now,
    }).run();

    return {
      householdId,
      userId,
      email: emailNormalized,
      displayName: params.displayName,
      role: 'owner' as const,
      sessionToken,
    };
  }

  /**
   * 用户登录（密码校验与 Session 签发）
   */
  async login(email: string, password: string) {
    const emailNormalized = email.trim().toLowerCase();
    const user = this.db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.emailNormalized, emailNormalized), eq(schema.users.status, 'active')))
      .get();

    if (!user) {
      throw new Error('INVALID_CREDENTIALS: 账号或密码错误');
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new Error('INVALID_CREDENTIALS: 账号或密码错误');
    }

    // 查询成员所属家庭与角色
    const member = this.db
      .select({
        householdId: schema.householdMembers.householdId,
        role: schema.householdMembers.role,
        householdName: schema.households.name,
      })
      .from(schema.householdMembers)
      .innerJoin(schema.households, eq(schema.householdMembers.householdId, schema.households.id))
      .where(and(eq(schema.householdMembers.userId, user.id), eq(schema.householdMembers.status, 'active')))
      .get();

    if (!member) {
      throw new Error('FORBIDDEN_NO_MEMBERSHIP: 账号未绑定任何有效家庭空间');
    }

    const now = Date.now();
    const sessionToken = generateSecureToken();
    this.db.insert(schema.sessions).values({
      id: generateId('ses'),
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      sessionVersion: user.sessionVersion,
      expiresAt: now + 30 * 86400000,
      lastSeenAt: now,
    }).run();

    return {
      user: {
        id: user.id,
        email: user.emailNormalized,
        displayName: user.displayName,
      },
      householdId: member.householdId,
      householdName: member.householdName,
      role: member.role as 'owner' | 'member',
      sessionToken,
    };
  }

  /**
   * 校验 Session Token 并加载用户会话与权限
   */
  async validateSession(sessionToken: string) {
    const tokenHash = hashToken(sessionToken);
    const now = Date.now();

    const session = this.db
      .select({
        sessionId: schema.sessions.id,
        sessionVersion: schema.sessions.sessionVersion,
        user: schema.users,
        member: schema.householdMembers,
        household: schema.households,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
      .innerJoin(schema.householdMembers, eq(schema.users.id, schema.householdMembers.userId))
      .innerJoin(schema.households, eq(schema.householdMembers.householdId, schema.households.id))
      .where(
        and(
          eq(schema.sessions.tokenHash, tokenHash),
          isNull(schema.sessions.revokedAt),
          gt(schema.sessions.expiresAt, now),
          eq(schema.users.status, 'active'),
          eq(schema.householdMembers.status, 'active')
        )
      )
      .get();

    if (!session) return null;

    // 检查 Session Version（若用户修改过密码则直接失效）
    if (session.sessionVersion !== session.user.sessionVersion) {
      return null;
    }

    // 延展更新活跃时间
    this.db
      .update(schema.sessions)
      .set({ lastSeenAt: now })
      .where(eq(schema.sessions.id, session.sessionId))
      .run();

    return {
      user: {
        id: session.user.id,
        email: session.user.emailNormalized,
        displayName: session.user.displayName,
      },
      householdId: session.household.id,
      householdName: session.household.name,
      role: session.member.role as 'owner' | 'member',
    };
  }

  /**
   * 退出当前设备
   */
  async logout(sessionToken: string) {
    const tokenHash = hashToken(sessionToken);
    this.db
      .update(schema.sessions)
      .set({ revokedAt: Date.now() })
      .where(eq(schema.sessions.tokenHash, tokenHash))
      .run();
  }

  /**
   * 退出全部设备（提升 session_version）
   */
  async logoutAll(userId: string) {
    this.db
      .update(schema.users)
      .set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` })
      .where(eq(schema.users.id, userId))
      .run();
  }

  /**
   * Owner 创建成员邀请 Token（单次有效，仅存哈希）
   */
  async createInvitation(householdId: string, actorUserId: string, targetEmail: string) {
    // 校验 Actor 必须为 Owner
    const member = this.db
      .select()
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.userId, actorUserId),
          eq(schema.householdMembers.role, 'owner'),
          eq(schema.householdMembers.status, 'active')
        )
      )
      .get();

    if (!member) {
      throw new Error('FORBIDDEN_NOT_OWNER: 只有空间 Owner 有权邀请新成员');
    }

    const emailNormalized = targetEmail.trim().toLowerCase();
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const now = Date.now();
    const expiresAt = now + 7 * 86400000; // 7 天有效期

    const inviteId = generateId('inv');
    this.db.insert(schema.memberInvitations).values({
      id: inviteId,
      householdId,
      emailNormalized,
      tokenHash,
      invitedBy: actorUserId,
      expiresAt,
      createdAt: now,
    }).run();

    return {
      invitationId: inviteId,
      rawToken,
      expiresAt,
      email: emailNormalized,
    };
  }

  /**
   * 接受邀请并创建 Member 账号
   */
  async acceptInvitation(rawToken: string, displayName: string, password: string) {
    const tokenHash = hashToken(rawToken);
    const now = Date.now();

    const invite = this.db
      .select()
      .from(schema.memberInvitations)
      .where(
        and(
          eq(schema.memberInvitations.tokenHash, tokenHash),
          isNull(schema.memberInvitations.acceptedAt),
          isNull(schema.memberInvitations.revokedAt),
          gt(schema.memberInvitations.expiresAt, now)
        )
      )
      .get();

    if (!invite) {
      throw new Error('INVALID_OR_EXPIRED_INVITATION: 邀请链接无效或已过期');
    }

    // 检查邮箱是否已存在账号
    let userId: string;
    const existingUser = this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.emailNormalized, invite.emailNormalized))
      .get();

    if (existingUser) {
      userId = existingUser.id;
    } else {
      userId = generateId('usr');
      const passwordHash = await hashPassword(password);
      this.db.insert(schema.users).values({
        id: userId,
        emailNormalized: invite.emailNormalized,
        emailVerifiedAt: now,
        displayName,
        passwordHash,
        sessionVersion: 1,
        status: 'active',
        createdAt: now,
      }).run();
    }

    // 加入家庭空间成员
    this.db.insert(schema.householdMembers).values({
      householdId: invite.householdId,
      userId,
      role: 'member',
      status: 'active',
      joinedAt: now,
    }).run();

    // 标记邀请已消费（单次使用不可复用）
    this.db
      .update(schema.memberInvitations)
      .set({ acceptedAt: now })
      .where(eq(schema.memberInvitations.id, invite.id))
      .run();

    // 生成 Session
    const sessionToken = generateSecureToken();
    this.db.insert(schema.sessions).values({
      id: generateId('ses'),
      userId,
      tokenHash: hashToken(sessionToken),
      sessionVersion: 1,
      expiresAt: now + 30 * 86400000,
      lastSeenAt: now,
    }).run();

    return {
      userId,
      householdId: invite.householdId,
      role: 'member' as const,
      sessionToken,
    };
  }

  /**
   * Owner 移除成员并立即注销其会话
   */
  async removeMember(householdId: string, actorUserId: string, targetUserId: string) {
    if (actorUserId === targetUserId) {
      throw new Error('CANNOT_REMOVE_SELF: Owner 不能将自己从空间移除');
    }

    const actor = this.db
      .select()
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.userId, actorUserId),
          eq(schema.householdMembers.role, 'owner')
        )
      )
      .get();

    if (!actor) {
      throw new Error('FORBIDDEN_NOT_OWNER: 只有空间 Owner 有权移除成员');
    }

    const now = Date.now();
    this.db
      .update(schema.householdMembers)
      .set({ status: 'removed', removedAt: now })
      .where(
        and(
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.userId, targetUserId)
        )
      )
      .run();

    // 立即撤销该用户所有活跃 Session
    this.logoutAll(targetUserId);
  }
}
