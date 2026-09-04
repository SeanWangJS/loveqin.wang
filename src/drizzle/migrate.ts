import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { getDatabase } from './db';
import * as schema from './schema';
import { eq } from 'drizzle-orm';
import path from 'path';

export async function runMigrations() {
  console.log('🔄 正在应用 Drizzle 数据库迁移至本地 D1 (.local-d1.sqlite)...');
  
  const db = getDatabase();
  const migrationsFolder = path.resolve(process.cwd(), 'drizzle', 'migrations');
  
  // 1. 执行 SQL 迁移
  migrate(db, { migrationsFolder });
  console.log('✓ 数据表结构迁移完成 (22 张表已就绪)！');

  // 2. 检查并注入默认家庭空间、Owner 用户与默认相册
  const defaultHouseholdId = 'household_default';
  const defaultOwnerId = 'user_owner_default';
  const defaultAlbumId = 'album_default';
  const now = Date.now();

  const existingHousehold = db.select().from(schema.households).where(eq(schema.households.id, defaultHouseholdId)).get();
  if (!existingHousehold) {
    console.log('🌱 正在初始化默认家庭空间与空间 Owner 账户...');
    db.insert(schema.households).values({
      id: defaultHouseholdId,
      name: '爱琴之境 · 家庭相册',
      welcomeMessage: '记录时光流转，珍藏共同回忆',
      originalExifPolicy: 'preserve_all',
      createdAt: now,
    }).run();

    db.insert(schema.users).values({
      id: defaultOwnerId,
      emailNormalized: 'owner@loveqin.wang',
      displayName: '空间主人',
      passwordHash: 'local_hash_placeholder',
      sessionVersion: 1,
      status: 'active',
      createdAt: now,
    }).run();

    db.insert(schema.householdMembers).values({
      householdId: defaultHouseholdId,
      userId: defaultOwnerId,
      role: 'owner',
      status: 'active',
      joinedAt: now,
    }).run();
  }

  const existingAlbum = db.select().from(schema.albums).where(eq(schema.albums.id, defaultAlbumId)).get();
  if (!existingAlbum) {
    console.log('🌱 正在创建默认相册 (album_default)...');
    db.insert(schema.albums).values({
      id: defaultAlbumId,
      householdId: defaultHouseholdId,
      name: '时光珍藏相册',
      description: '所有珍藏的照片回忆与美好瞬间',
      createdBy: defaultOwnerId,
      createdAt: now,
      updatedAt: now,
    }).run();
  }

  console.log('🎉 本地 D1 边缘数据库已完全就绪！');
}

// 允许直接作为 CLI 执行
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ 迁移执行失败:', err);
      process.exit(1);
    });
}
