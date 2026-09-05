import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// ==========================================
// 1. 家庭空间与系统设置
// ==========================================

export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  welcomeMessage: text('welcome_message'),
  originalExifPolicy: text('original_exif_policy').default('preserve_all'), // preserve_all | strip_gps | strip_all
  createdAt: integer('created_at').notNull(),
});

export const householdSettings = sqliteTable('household_settings', {
  householdId: text('household_id').primaryKey().references(() => households.id, { onDelete: 'cascade' }),
  atmosphereJson: text('atmosphere_json'), // 氛围布光、色温偏好
  backgroundAudioAssetId: text('background_audio_asset_id'),
  updatedAt: integer('updated_at').notNull(),
});

// ==========================================
// 2. 用户、成员关系与鉴权
// ==========================================

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  emailNormalized: text('email_normalized').notNull().unique(),
  emailVerifiedAt: integer('email_verified_at'),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  sessionVersion: integer('session_version').default(1).notNull(), // 用于一键全局登出
  status: text('status').default('active').notNull(), // active | suspended | deleted
  createdAt: integer('created_at').notNull(),
});

export const householdMembers = sqliteTable(
  'household_members',
  {
    householdId: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // owner | member
    status: text('status').default('active').notNull(), // active | removed
    joinedAt: integer('joined_at').notNull(),
    removedAt: integer('removed_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.householdId, table.userId] }),
    userStatusIdx: index('idx_members_user_status').on(table.userId, table.status),
  })
);

// Cloudflare Access 稳定身份映射表 (支持 Google OAuth 与 Email OTP 统一多源绑定)
export const authIdentities = sqliteTable(
  'auth_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    emailAtLink: text('email_at_link').notNull(),
    createdAt: integer('created_at').notNull(),
    lastAuthenticatedAt: integer('last_authenticated_at').notNull(),
  },
  (table) => ({
    uniqueIssuerSubject: uniqueIndex('idx_auth_identities_issuer_sub').on(table.issuer, table.subject),
    userIndex: index('idx_auth_identities_user_id').on(table.userId),
  })
);

export const memberInvitations = sqliteTable(
  'member_invitations',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    emailNormalized: text('email_normalized').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by').notNull().references(() => users.id),
    expiresAt: integer('expires_at').notNull(),
    acceptedAt: integer('accepted_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    tokenExpIdx: index('idx_invites_token_exp').on(table.tokenHash, table.expiresAt),
  })
);

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
});

export const emailVerificationTokens = sqliteTable('email_verification_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    sessionVersion: integer('session_version').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (table) => ({
    tokenExpIdx: index('idx_sessions_token_exp').on(table.tokenHash, table.expiresAt),
  })
);

export const userPreferences = sqliteTable(
  'user_preferences',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    householdId: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    albumId: text('album_id'),
    viewMode: text('view_mode').default('tunnel'), // tunnel | grid | galaxy
    timeAnchor: integer('time_anchor'),
    audioEnabled: integer('audio_enabled').default(0),
    audioVolume: integer('audio_volume').default(70),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.householdId] }),
  })
);

// ==========================================
// 3. 相册、照片与资产表
// ==========================================

export const albums = sqliteTable('albums', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  coverPhotoId: text('cover_photo_id'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const photos = sqliteTable(
  'photos',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
    albumId: text('album_id').notNull().references(() => albums.id, { onDelete: 'cascade' }),
    title: text('title'),
    story: text('story'),
    takenAtSort: integer('taken_at_sort').notNull(), // 规范排序时间戳 (ms)
    takenAtLocal: text('taken_at_local').notNull(),
    timezoneOffsetMinutes: integer('timezone_offset_minutes'),
    timePrecision: text('time_precision').default('second'), // second | minute | day | unknown
    timeSource: text('time_source').default('exif'), // exif | user | file_ctime
    locationName: text('location_name'),
    width: integer('width'),
    height: integer('height'),
    originalFilename: text('original_filename').notNull(),
    contentHash: text('content_hash'), // 用于空间内防重传
    status: text('status').default('pending').notNull(), // pending | uploaded | processing | ready | failed | trashed | deleting
    processingError: text('processing_error'),
    deletedAt: integer('deleted_at'),
    purgeAfter: integer('purge_after'), // 回收站 30 天自动清理时间
    exifSafeJson: text('exif_safe_json'),
    createdBy: text('created_by').notNull().references(() => users.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    albumSortIdx: index('idx_photos_album_sort').on(table.albumId, table.status, table.takenAtSort, table.id),
    householdHashIdx: index('idx_photos_household_hash').on(table.householdId, table.contentHash, table.status),
    householdContentHashUnique: uniqueIndex('idx_photos_household_content_hash').on(table.householdId, table.contentHash),
    purgeIdx: index('idx_photos_purge').on(table.status, table.purgeAfter),
  })
);

export const photoAssets = sqliteTable(
  'photo_assets',
  {
    id: text('id').primaryKey(),
    photoId: text('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
    variant: text('variant').notNull(), // thumb_low | thumb_high | display | original | depth
    r2Key: text('r2_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width'),
    height: integer('height'),
  },
  (table) => ({
    photoVariantUnique: uniqueIndex('idx_photo_variant_unique').on(table.photoId, table.variant),
  })
);

export const audioAssets = sqliteTable('audio_assets', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull().unique(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  status: text('status').default('ready').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at').notNull(),
});

// ==========================================
// 4. 任务队列与事务 Outbox
// ==========================================

export const mediaJobs = sqliteTable(
  'media_jobs',
  {
    id: text('id').primaryKey(),
    photoId: text('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
    jobType: text('job_type').notNull(), // derive_lods | extract_exif | generate_depth
    status: text('status').default('pending').notNull(), // pending | leased | completed | failed | dead_letter
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    availableAt: integer('available_at').notNull(),
    leaseUntil: integer('lease_until'),
    lastErrorCode: text('last_error_code'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    photoJobUnique: uniqueIndex('idx_photo_job_unique').on(table.photoId, table.jobType),
    jobScheduleIdx: index('idx_media_jobs_schedule').on(table.status, table.availableAt, table.leaseUntil),
  })
);

export const outboxEvents = sqliteTable(
  'outbox_events',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payloadJson: text('payload_json').notNull(),
    availableAt: integer('available_at').notNull(),
    publishedAt: integer('published_at'),
    attempts: integer('attempts').default(0).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    outboxScheduleIdx: index('idx_outbox_schedule').on(table.publishedAt, table.availableAt),
  })
);

// ==========================================
// 5. 事件、标签与轻互动
// ==========================================

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startsAt: integer('starts_at'),
  endsAt: integer('ends_at'),
  createdAt: integer('created_at').notNull(),
});

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').default('custom'), // custom | person | trip | milestone
  createdAt: integer('created_at').notNull(),
});

export const photoEvents = sqliteTable(
  'photo_events',
  {
    photoId: text('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.photoId, table.eventId] }),
  })
);

export const photoTags = sqliteTable(
  'photo_tags',
  {
    photoId: text('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.photoId, table.tagId] }),
  })
);

export const likes = sqliteTable(
  'likes',
  {
    photoId: text('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.photoId, table.userId] }),
  })
);

export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    photoId: text('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (table) => ({
    photoCommentsIdx: index('idx_comments_photo').on(table.photoId, table.createdAt, table.id),
  })
);

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  householdId: text('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id').notNull().references(() => users.id),
  action: text('action').notNull(), // upload | delete | invite | remove_member | transfer_owner
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  metadataJson: text('metadata_json'),
  createdAt: integer('created_at').notNull(),
});
