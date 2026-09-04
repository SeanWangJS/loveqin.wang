import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import ExifReader from 'exifreader';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { spawnSync } from 'child_process';
import { getDatabase } from '../src/drizzle/db';
import * as schema from '../src/drizzle/schema';
import { runMigrations } from '../src/drizzle/migrate';
import { eq } from 'drizzle-orm';
import { buildPhotoAssetKey, getLocalObjectPath, LOCAL_OBJECT_STORE_DIR } from '../src/services/assetKeyUtils';

// 支持的照片文件扩展名与约束上限
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.heic', '.heif']);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MiB (PRD 规范)
const MAX_PIXEL_COUNT = 100_000_000;    // 100 MP (PRD 规范)

interface ExifSafeData {
  cameraModel?: string;
  lensModel?: string;
  focalLength?: string;
  aperture?: string;
  shutterSpeed?: string;
  iso?: number;
  colorSpace?: string;
}

interface PhotoItem {
  id: string;
  albumId: string;
  title: string;
  story: string;
  takenAt: number;
  takenAtSort: number;
  takenAtLocal: string;
  locationName: string;
  width: number;
  height: number;
  urlThumbLow: string;
  urlThumbHigh: string;
  urlDisplay: string;
  exif: ExifSafeData;
  likesCount: number;
  isLiked?: boolean;
}

// 1. 读取环境配置或 .r2-env.json
function loadConfig() {
  let envConfig: Record<string, string> = {};
  const configPath = path.resolve(process.cwd(), '.r2-env.json');
  if (fs.existsSync(configPath)) {
    try {
      envConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      console.warn('⚠️ 警告: .r2-env.json 解析失败，将尝试环境变量或 Wrangler');
    }
  }

  const accountId = envConfig.R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = envConfig.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = envConfig.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
  const bucketName = envConfig.R2_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'gallery-media-private';

  const isS3Configured = Boolean(accountId && accessKeyId && secretAccessKey && bucketName);

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    isS3Configured,
  };
}

// 获取项目内部安装的 Wrangler JS 入口
function getWranglerBin(): string {
  return path.resolve(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
}

// 2. 检查 Wrangler 登录凭证（使用纯 node 二进制调用，shell: false 彻底消除命令注入风险）
function checkWranglerAuth(): boolean {
  try {
    const wranglerBin = getWranglerBin();
    if (!fs.existsSync(wranglerBin)) return false;

    const res = spawnSync(process.execPath, [wranglerBin, 'whoami'], {
      encoding: 'utf-8',
      timeout: 4000,
      shell: false,
    });
    if (res.error || res.status !== 0) return false;
    const output = res.stdout || '';
    return output.includes('You are logged in') || output.includes('account');
  } catch {
    return false;
  }
}

// 3. 通过 Wrangler CLI 参数化安全上传单个文件至 R2 (杜绝命令拼接注入)
function uploadViaWrangler(bucketName: string, remoteKey: string, localFilePath: string) {
  const wranglerBin = getWranglerBin();
  const res = spawnSync(process.execPath, [wranglerBin, 'r2', 'object', 'put', `${bucketName}/${remoteKey}`, `--file=${localFilePath}`], {
    encoding: 'utf-8',
    timeout: 60000,
    shell: false,
  });

  if (res.error || res.status !== 0) {
    const errMsg = res.stderr || res.stdout || res.error?.message || '未知错误';
    throw new Error(`Wrangler 上传失败 [${remoteKey}]: ${errMsg}`);
  }
  return true;
}

// 3.1 通过 Wrangler CLI 安全删除单个 R2 对象 (用于 Saga 补偿回滚)
function deleteViaWrangler(bucketName: string, remoteKey: string) {
  const wranglerBin = getWranglerBin();
  const res = spawnSync(process.execPath, [wranglerBin, 'r2', 'object', 'delete', `${bucketName}/${remoteKey}`, '-y'], {
    encoding: 'utf-8',
    timeout: 30000,
    shell: false,
  });

  if (res.error || res.status !== 0) {
    const errMsg = res.stderr || res.stdout || res.error?.message || '未知错误';
    console.warn(`   ⚠️ Wrangler 回滚删除 R2 对象失败 [${remoteKey}]: ${errMsg}`);
  }
}

// 3.2 Saga 事务补偿：发生局部故障时回滚清理已上传的云端 R2 对象
async function rollbackR2Uploads(s3Client: S3Client | null, useWrangler: boolean, bucketName: string, keys: string[]) {
  if (keys.length === 0) return;
  console.log(`   🔄 触发 Saga 补偿事务: 正在回滚清理 ${keys.length} 个已上传的云端 R2 对象...`);
  for (const key of keys) {
    try {
      if (s3Client) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
      } else if (useWrangler) {
        deleteViaWrangler(bucketName, key);
      }
      console.log(`      ✓ 已回滚清理云端对象: ${key}`);
    } catch (cleanupErr) {
      console.warn(`      ⚠️ 回滚清理云端对象失败 [${key}]:`, cleanupErr);
    }
  }
  console.log(`   ✓ Saga 补偿完成: 云端半成品对象已清理`);
}

// SQL 字符串安全转义 (防注入与语法断裂)
function escapeSqlString(val: string | null | undefined): string {
  if (val === null || val === undefined) return 'NULL';
  return `'${val.replace(/'/g, "''")}'`;
}

// SQL 数值安全转义
function escapeSqlNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return 'NULL';
  return String(val);
}

// 4. 解析照片拍摄时间与 EXIF 器材参数 (严谨对齐本地墙上时区与 timeSource 来源)
async function extractMetadata(_filePath: string, buffer: Buffer, mtimeMs: number, tzOffsetMinutes: number) {
  let tags: Record<string, unknown> = {};
  try {
    tags = ExifReader.load(buffer) as Record<string, unknown>;
  } catch {
    // 特殊图片无 EXIF，走备选
  }

  let takenAt = mtimeMs;
  let timeSource = 'file_mtime';
  let timePrecision = 'minute';

  // 无 EXIF 时，使用空间本地时区格式化墙上时间（避免 UTC toISOString 造成的时间漂移）
  const localDate = new Date(mtimeMs + tzOffsetMinutes * 60 * 1000);
  let takenAtLocal = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, '0')}-${String(localDate.getUTCDate()).padStart(2, '0')} ${String(localDate.getUTCHours()).padStart(2, '0')}:${String(localDate.getUTCMinutes()).padStart(2, '0')}:${String(localDate.getUTCSeconds()).padStart(2, '0')}`;

  const dateTag = (tags['DateTimeOriginal'] || tags['CreateDate'] || tags['DateTime']) as { description?: string } | undefined;
  if (dateTag && dateTag.description) {
    const rawDateStr = dateTag.description.trim();
    const match = rawDateStr.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const hour = match[4] ? parseInt(match[4], 10) : 12;
      const minute = match[5] ? parseInt(match[5], 10) : 0;
      const second = match[6] ? parseInt(match[6], 10) : 0;

      // 使用空间统一时区偏移计算基准 UTC 时间戳
      const utcTimestamp = Date.UTC(year, month, day, hour, minute, second) - tzOffsetMinutes * 60 * 1000;
      if (!isNaN(utcTimestamp)) {
        takenAt = utcTimestamp;
        takenAtLocal = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
        timeSource = 'exif';
        timePrecision = 'second';
      }
    }
  }

  const make = (tags['Make'] as { description?: string } | undefined)?.description || '';
  const model = (tags['Model'] as { description?: string } | undefined)?.description || '';
  const cameraModel = [make, model].filter(Boolean).join(' ').trim() || undefined;

  const lensModel = (tags['LensModel'] as { description?: string } | undefined)?.description || undefined;
  const focalLength = (tags['FocalLength'] as { description?: string } | undefined)?.description || undefined;
  const aperture = (tags['FNumber'] as { description?: string } | undefined)?.description || undefined;
  const shutterSpeed = (tags['ExposureTime'] as { description?: string } | undefined)?.description || undefined;
  const isoVal = (tags['ISOSpeedRatings'] as { value?: number } | undefined)?.value;
  const iso = typeof isoVal === 'number' ? isoVal : undefined;
  const colorSpace = (tags['ColorSpace'] as { description?: string } | undefined)?.description || undefined;

  const exif: ExifSafeData = {
    cameraModel,
    lensModel,
    focalLength,
    aperture,
    shutterSpeed,
    iso,
    colorSpace,
  };

  return { takenAt, takenAtLocal, timeSource, timePrecision, exif };
}

// 生成基于家庭空间命名空间与 96-bit SHA-256 哈希的稳定 ID
function generateStablePhotoId(householdId: string, contentHash: string): string {
  const cleanHousehold = householdId.replace(/^household_/, '');
  return `p_${cleanHousehold}_${contentHash.slice(0, 24)}`;
}

// 5. 核心全自动多级 LOD 处理与 R2/D1 流水线
async function runUploadPipeline() {
  console.log('================================================================');
  console.log('🌌 3D 时光长廊 · 真实照片全自动多级 LOD 压缩与 R2 / D1 流水线');
  console.log('================================================================\n');

  // 1. 初始化本地 SQLite 数据库与 Drizzle 迁移
  console.log('🔄 正在应用 Drizzle 数据库迁移至本地 D1 (.local-d1.sqlite)...');
  await runMigrations();
  const db = getDatabase();

  const rawPhotosDir = path.resolve(process.cwd(), 'raw_photos');
  if (!fs.existsSync(rawPhotosDir)) {
    fs.mkdirSync(rawPhotosDir, { recursive: true });
    console.log(`📁 已创建原始照片放置目录: ${rawPhotosDir}`);
    console.log('💡 请将需要导入的真实相册照片复制到该目录下，再次运行 pnpm photo:import 即可！');
    return;
  }

  const allEntries = fs.readdirSync(rawPhotosDir);
  const files = allEntries.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  });

  if (files.length === 0) {
    console.log(`ℹ️ 在 ${rawPhotosDir} 中未检测到支持的图片文件。`);
    console.log('💡 请将图片（.jpg / .png / .webp / .heic 等）放入该目录后重试。');
    return;
  }

  console.log(`📸 发现待处理照片: ${files.length} 张`);

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
使用方式: pnpm photo:import [选项]

选项:
  --remote, --cloud    上传派生图至 Cloudflare R2，并同步元数据至 Cloudflare D1
  --upload-r2-only     与 --remote 配合使用，仅上传媒体至 R2，跳过远程 D1 数据库同步
  --allow-partial      允许批处理部分失败继续退出码为 0（默认在有失败项时以 1 退出）
  --help, -h           显示此帮助信息
`);
    process.exit(0);
  }

  const isRemote = process.argv.includes('--remote') || process.argv.includes('--cloud');
  const uploadR2Only = process.argv.includes('--upload-r2-only');
  const allowPartial = process.argv.includes('--allow-partial');
  let s3Client: S3Client | null = null;
  let useWrangler = false;

  if (isRemote) {
    const config = loadConfig();
    if (config.isS3Configured) {
      console.log(`🚀 [云端直传通道 1] 已启用 S3 高速并发直传通道 (Bucket: ${config.bucketName})`);
      s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
    } else {
      const isWranglerAuthed = checkWranglerAuth();
      if (isWranglerAuthed) {
        console.log(`⚡ [云端直传通道 2] 检测到已登录的 Wrangler 账号，启用【Wrangler 原生直传】(Bucket: ${config.bucketName})！`);
        useWrangler = true;
      } else {
        throw new Error('REMOTE_AUTH_FAILED: 未检测到 S3 凭据或已登录的 Wrangler 账号，无法执行 --remote。请先运行 pnpm wrangler login');
      }
    }
  } else {
    console.log('💡 [本地优先私密模式: 私有对象池 (.local-object-store) + 本地 D1 数据库]');
    console.log('   - 彻底移出 public/ 公开目录，保障私密照片 100% 物理隔离；');
    console.log('   - 生成三级 WebP LOD 并写入私有对象目录；');
    console.log('   - 完整元数据与 EXIF 写入本地 D1 SQLite 数据库 (.local-d1.sqlite)；');
    console.log('   - 前端通过开发服务器本地受保护路由 (/api/media/...) 安全获取流式图像！\n');
  }

  // 确保本地私有对象目录存在
  if (!fs.existsSync(LOCAL_OBJECT_STORE_DIR)) {
    fs.mkdirSync(LOCAL_OBJECT_STORE_DIR, { recursive: true });
  }

  const householdId = 'household_default';
  const defaultAlbumId = 'album_default';
  const tzOffsetMinutes = -new Date().getTimezoneOffset(); // 自动对齐本机真实时区

  const processedPhotos: PhotoItem[] = [];
  const sqlStatements: string[] = [];
  let successCount = 0;
  let failedCount = 0;
  const failedItems: Array<{ file: string; error: string }> = [];

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    const filePath = path.join(rawPhotosDir, fileName);
    const fileStat = fs.statSync(filePath);

    console.log(`\n[${i + 1}/${files.length}] 正在检验与分析: ${fileName}...`);

    // P2 校验 1: 单文件 50 MiB 限制
    if (fileStat.size > MAX_FILE_SIZE) {
      console.warn(`   ⚠️ 警告: 文件大小 ${(fileStat.size / (1024 * 1024)).toFixed(1)} MiB 超出 50 MiB 规范上限，跳过处理。`);
      failedCount++;
      failedItems.push({ file: fileName, error: 'FILE_TOO_LARGE (>50MiB)' });
      continue;
    }

    const rawBuffer = fs.readFileSync(filePath);

    // P1 优化: 稳定 ID 基于家庭空间命名空间与内容 SHA-256 哈希
    const contentHash = crypto.createHash('sha256').update(rawBuffer).digest('hex');
    const photoId = generateStablePhotoId(householdId, contentHash);

    // P2 校验 2: 图片格式与 100 MP 解码像素限制
    let sharpInstance: sharp.Sharp;
    let metadata: sharp.Metadata;
    try {
      sharpInstance = sharp(rawBuffer).rotate();
      metadata = await sharpInstance.metadata();
    } catch (err) {
      console.warn(`   ⚠️ 警告: 无法解码图片内容 (${String(err)})，跳过。`);
      failedCount++;
      failedItems.push({ file: fileName, error: 'DECODE_FAILED' });
      continue;
    }

    const width = metadata.width || 1920;
    const height = metadata.height || 1080;
    const totalPixels = width * height;

    if (totalPixels > MAX_PIXEL_COUNT) {
      console.warn(`   ⚠️ 警告: 图片总像素 ${(totalPixels / 1_000_000).toFixed(1)} MP 超出 100 MP 规范上限，跳过处理。`);
      failedCount++;
      failedItems.push({ file: fileName, error: 'PIXEL_LIMIT_EXCEEDED (>100MP)' });
      continue;
    }

    // 查重：若同家庭空间已存在且内容一致，检查本地资产是否齐全
    const keyOriginal = buildPhotoAssetKey(householdId, photoId, 'original', path.extname(fileName));
    const keyDisplay = buildPhotoAssetKey(householdId, photoId, 'display');
    const keyThumbHigh = buildPhotoAssetKey(householdId, photoId, 'thumb_high');
    const keyThumbLow = buildPhotoAssetKey(householdId, photoId, 'thumb_low');

    const pathOriginal = getLocalObjectPath(keyOriginal);
    const pathDisplay = getLocalObjectPath(keyDisplay);
    const pathThumbHigh = getLocalObjectPath(keyThumbHigh);
    const pathThumbLow = getLocalObjectPath(keyThumbLow);

    const existingPhoto = db.select().from(schema.photos).where(eq(schema.photos.id, photoId)).get();
    const assetsAllReady = fs.existsSync(pathOriginal) && fs.existsSync(pathDisplay) && fs.existsSync(pathThumbHigh) && fs.existsSync(pathThumbLow);

    if (existingPhoto && existingPhoto.status === 'ready' && assetsAllReady && !isRemote) {
      console.log(`   ⏭️ 照片已存在且数据完整 (${photoId})，跳过切图处理。`);
      const exif = existingPhoto.exifSafeJson ? JSON.parse(existingPhoto.exifSafeJson) : {};
      processedPhotos.push({
        id: photoId,
        albumId: defaultAlbumId,
        title: existingPhoto.title || path.parse(fileName).name,
        story: existingPhoto.story || '',
        takenAt: existingPhoto.takenAtSort,
        takenAtSort: existingPhoto.takenAtSort,
        takenAtLocal: existingPhoto.takenAtLocal,
        locationName: existingPhoto.locationName || 'Family Memories',
        width: existingPhoto.width || width,
        height: existingPhoto.height || height,
        urlThumbLow: `/api/media/${photoId}/thumb_low`,
        urlThumbHigh: `/api/media/${photoId}/thumb_high`,
        urlDisplay: `/api/media/${photoId}/display`,
        exif,
        likesCount: 0,
        isLiked: false,
      });
      successCount++;
      continue;
    }

    // P1 状态机流转: 1. 写入 processing 状态
    const now = Date.now();
    const { takenAt, takenAtLocal, timeSource, timePrecision, exif } = await extractMetadata(filePath, rawBuffer, fileStat.mtimeMs, tzOffsetMinutes);

    if (!existingPhoto) {
      db.insert(schema.photos).values({
        id: photoId,
        householdId,
        albumId: defaultAlbumId,
        title: path.parse(fileName).name,
        story: exif.cameraModel ? `拍摄器材: ${exif.cameraModel}` : '记录温暖而珍贵的时光回忆',
        takenAtSort: takenAt,
        takenAtLocal,
        timezoneOffsetMinutes: tzOffsetMinutes,
        timePrecision,
        timeSource,
        locationName: 'Family Memories',
        width,
        height,
        originalFilename: fileName,
        contentHash,
        status: 'processing',
        exifSafeJson: JSON.stringify(exif),
        createdBy: 'user_owner_default',
        createdAt: now,
        updatedAt: now,
      }).run();
    } else {
      db.update(schema.photos)
        .set({ status: 'processing', updatedAt: now })
        .where(eq(schema.photos.id, photoId))
        .run();
    }

    const writtenLocalFiles: string[] = [];
    const uploadedR2Keys: string[] = [];

    try {
      // 2. 生成多级 LOD 派生图
      const thumbLowBuffer = await sharp(rawBuffer)
        .rotate()
        .resize(256, 256, { fit: 'inside' })
        .webp({ quality: 65 })
        .toBuffer();

      const thumbHighBuffer = await sharp(rawBuffer)
        .rotate()
        .resize(1024, 1024, { fit: 'inside' })
        .webp({ quality: 80 })
        .toBuffer();

      const displayBuffer = await sharp(rawBuffer)
        .rotate()
        .resize(2560, 2560, { fit: 'inside' })
        .webp({ quality: 85 })
        .toBuffer();

      console.log(`   ✓ 三级 LOD 派生图就绪: low(${(thumbLowBuffer.length / 1024).toFixed(1)}KB), high(${(thumbHighBuffer.length / 1024).toFixed(1)}KB), disp(${(displayBuffer.length / 1024).toFixed(1)}KB)`);

      // 3. 写入私有对象目录 (.local-object-store/${r2Key})，完全隔离公开 public/ 目录
      const fileTasks = [
        { key: keyThumbLow, buffer: thumbLowBuffer, localPath: pathThumbLow, mime: 'image/webp' },
        { key: keyThumbHigh, buffer: thumbHighBuffer, localPath: pathThumbHigh, mime: 'image/webp' },
        { key: keyDisplay, buffer: displayBuffer, localPath: pathDisplay, mime: 'image/webp' },
        { key: keyOriginal, buffer: rawBuffer, localPath: pathOriginal, mime: metadata.format ? `image/${metadata.format}` : 'application/octet-stream' },
      ];

      for (const t of fileTasks) {
        fs.mkdirSync(path.dirname(t.localPath), { recursive: true });
        fs.writeFileSync(t.localPath, t.buffer);
        writtenLocalFiles.push(t.localPath);
      }
      console.log(`   ✓ 私有对象存储物理写入完成 (.local-object-store/)`);

      // 4. 若为远程模式，执行 R2 上传 (并记录 uploadedR2Keys 以便异常时 Saga 补偿回滚)
      const config = loadConfig();
      if (s3Client) {
        console.log(`   ☁️ 正在通过 S3 协议上传至 R2...`);
        for (const t of fileTasks) {
          await s3Client.send(
            new PutObjectCommand({
              Bucket: config.bucketName,
              Key: t.key,
              Body: t.buffer,
              ContentType: t.mime,
            })
          );
          uploadedR2Keys.push(t.key);
        }
        console.log(`   ✓ [S3] R2 上传完成`);
      } else if (useWrangler) {
        console.log(`   ⚡ 正在通过 Wrangler 原生安全调用直传至 R2...`);
        for (const t of fileTasks) {
          uploadViaWrangler(config.bucketName, t.key, t.localPath);
          uploadedR2Keys.push(t.key);
        }
        console.log(`   ✓ [Wrangler] R2 上传完成`);
      }

      // 5. 写入/更新 photo_assets 表并推进状态为 ready (原子事务包裹)
      const assetInserts = [
        { id: `${photoId}_thumb_low`, photoId, variant: 'thumb_low', r2Key: keyThumbLow, mimeType: 'image/webp', byteSize: thumbLowBuffer.length, width: Math.min(256, width), height: Math.min(256, height) },
        { id: `${photoId}_thumb_high`, photoId, variant: 'thumb_high', r2Key: keyThumbHigh, mimeType: 'image/webp', byteSize: thumbHighBuffer.length, width: Math.min(1024, width), height: Math.min(1024, height) },
        { id: `${photoId}_display`, photoId, variant: 'display', r2Key: keyDisplay, mimeType: 'image/webp', byteSize: displayBuffer.length, width: Math.min(2560, width), height: Math.min(2560, height) },
        { id: `${photoId}_original`, photoId, variant: 'original', r2Key: keyOriginal, mimeType: metadata.format ? `image/${metadata.format}` : 'application/octet-stream', byteSize: rawBuffer.length, width, height },
      ];

      db.transaction((tx) => {
        for (const a of assetInserts) {
          tx.insert(schema.photoAssets)
            .values(a)
            .onConflictDoUpdate({
              target: [schema.photoAssets.photoId, schema.photoAssets.variant],
              set: {
                r2Key: a.r2Key,
                byteSize: a.byteSize,
                width: a.width,
                height: a.height,
              },
            })
            .run();
        }

        tx.update(schema.photos)
          .set({
            status: 'ready',
            takenAtSort: takenAt,
            takenAtLocal,
            timeSource,
            timePrecision,
            width,
            height,
            exifSafeJson: JSON.stringify(exif),
            updatedAt: Date.now(),
          })
          .where(eq(schema.photos.id, photoId))
          .run();
      });

      console.log(`   ✓ [D1] 事务已原子提交: ready`);

      // 收集用于远程 Cloudflare D1 边缘数据库同步的 SQL 语句
      const photoSql = `INSERT INTO photos (id, household_id, album_id, title, story, taken_at_sort, taken_at_local, timezone_offset_minutes, time_precision, time_source, location_name, width, height, original_filename, content_hash, status, exif_safe_json, created_by, created_at, updated_at) VALUES (${escapeSqlString(photoId)}, ${escapeSqlString(householdId)}, ${escapeSqlString(defaultAlbumId)}, ${escapeSqlString(path.parse(fileName).name)}, ${escapeSqlString(exif.cameraModel ? `拍摄器材: ${exif.cameraModel}` : '记录温暖而珍贵的时光回忆')}, ${escapeSqlNumber(takenAt)}, ${escapeSqlString(takenAtLocal)}, ${escapeSqlNumber(tzOffsetMinutes)}, ${escapeSqlString(timePrecision)}, ${escapeSqlString(timeSource)}, ${escapeSqlString('Family Memories')}, ${escapeSqlNumber(width)}, ${escapeSqlNumber(height)}, ${escapeSqlString(fileName)}, ${escapeSqlString(contentHash)}, 'ready', ${escapeSqlString(JSON.stringify(exif))}, 'user_owner_default', ${now}, ${Date.now()}) ON CONFLICT(id) DO UPDATE SET title = excluded.title, story = excluded.story, taken_at_sort = excluded.taken_at_sort, taken_at_local = excluded.taken_at_local, width = excluded.width, height = excluded.height, status = excluded.status, exif_safe_json = excluded.exif_safe_json, updated_at = excluded.updated_at;`;

      const assetSqls = assetInserts.map((a) => {
        return `INSERT INTO photo_assets (id, photo_id, variant, r2_key, mime_type, byte_size, width, height) VALUES (${escapeSqlString(a.id)}, ${escapeSqlString(a.photoId)}, ${escapeSqlString(a.variant)}, ${escapeSqlString(a.r2Key)}, ${escapeSqlString(a.mimeType)}, ${escapeSqlNumber(a.byteSize)}, ${escapeSqlNumber(a.width)}, ${escapeSqlNumber(a.height)}) ON CONFLICT(photo_id, variant) DO UPDATE SET r2_key = excluded.r2_key, byte_size = excluded.byte_size, width = excluded.width, height = excluded.height;`;
      });

      sqlStatements.push(photoSql, ...assetSqls);

      processedPhotos.push({
        id: photoId,
        albumId: defaultAlbumId,
        title: path.parse(fileName).name,
        story: exif.cameraModel ? `拍摄器材: ${exif.cameraModel}` : '记录温暖而珍贵的时光回忆',
        takenAt,
        takenAtSort: takenAt,
        takenAtLocal,
        locationName: 'Family Memories',
        width,
        height,
        urlThumbLow: `/api/media/${photoId}/thumb_low`,
        urlThumbHigh: `/api/media/${photoId}/thumb_high`,
        urlDisplay: `/api/media/${photoId}/display`,
        exif,
        likesCount: 0,
        isLiked: false,
      });

      successCount++;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`   ❌ 处理失败 [${photoId}]:`, errMsg);
      failedCount++;
      failedItems.push({ file: fileName, error: errMsg });

      // 异常清理 1: 清理本地局部生成的半成品文件
      for (const tempPath of writtenLocalFiles) {
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
          } catch {}
        }
      }

      // 异常清理 2: Saga 事务补偿 - 回滚清理本次已上传至 R2 的云端脏数据
      const config = loadConfig();
      await rollbackR2Uploads(s3Client, useWrangler, config.bucketName, uploadedR2Keys);

      // 异常清理 3: 标记本地数据库记录为 failed 并保存错误详情
      db.update(schema.photos)
        .set({ status: 'failed', processingError: errMsg, updatedAt: Date.now() })
        .where(eq(schema.photos.id, photoId))
        .run();
    }
  }

  // 6. 按时间先后正序排列并同步内部开发缓存 (仅作为本地离线测试备用，绝不发布到生产 public 目录)
  processedPhotos.sort((a, b) => a.takenAt - b.takenAt);

  const dataOutputDir = path.resolve(process.cwd(), 'src', 'data');
  if (!fs.existsSync(dataOutputDir)) {
    fs.mkdirSync(dataOutputDir, { recursive: true });
  }

  fs.writeFileSync(path.join(dataOutputDir, 'photos.json'), JSON.stringify(processedPhotos, null, 2));

  // 清理公开目录中旧的遗留静态照片文件（确保杜绝公开暴露）
  const publicPhotosDir = path.resolve(process.cwd(), 'public', 'photos');
  if (fs.existsSync(publicPhotosDir)) {
    fs.rmSync(publicPhotosDir, { recursive: true, force: true });
  }
  const publicPhotosJson = path.resolve(process.cwd(), 'public', 'photos.json');
  if (fs.existsSync(publicPhotosJson)) {
    fs.rmSync(publicPhotosJson, { force: true });
  }

  console.log('\n================================================================');
  console.log(`🎉 批量处理全部完成！成功: ${successCount} 张，失败: ${failedCount} 张`);
  console.log(`🔒 私有对象存储: .local-object-store/ (物理隔离，未发布到任何公开目录)`);
  console.log(`📄 本地 D1 数据库: .local-d1.sqlite (已更新 photos & photo_assets)`);
  console.log(`🌐 访问方式: 通过开发 API (GET /api/photos & GET /api/media/:id/:variant)`);

  if (isRemote) {
    if (uploadR2Only) {
      console.log('\n☁️ [云端存储同步完成 (已指定 --upload-r2-only)]:');
      console.log('   已成功将图片派生图推送到 Cloudflare R2 存储桶，跳过 D1 数据库同步。');
      console.log('   如需将元数据同步至 Cloudflare D1 边缘数据库，可不带 --upload-r2-only 再次运行。');
    } else if (sqlStatements.length > 0) {
      console.log('\n☁️ [正在同步元数据至 Cloudflare D1 边缘数据库 (gallery-d1)]...');
      const tempSqlPath = path.resolve(process.cwd(), '.temp-d1-sync.sql');
      try {
        const fullSql = [
          '-- Auto-generated D1 sync SQL by upload-to-r2 pipeline',
          "INSERT OR IGNORE INTO households (id, name, created_at) VALUES ('household_default', 'Default Household', unixepoch() * 1000);",
          "INSERT OR IGNORE INTO albums (id, household_id, title, is_default, created_at) VALUES ('album_default', 'household_default', 'Default Album', 1, unixepoch() * 1000);",
          "INSERT OR IGNORE INTO users (id, email, display_name, status, created_at) VALUES ('user_owner_default', 'owner@loveqin.wang', 'Family Admin', 'active', unixepoch() * 1000);",
          "INSERT OR IGNORE INTO household_members (household_id, user_id, role, status, joined_at) VALUES ('household_default', 'user_owner_default', 'owner', 'active', unixepoch() * 1000);",
          ...sqlStatements,
        ].join('\n\n');

        fs.writeFileSync(tempSqlPath, fullSql, 'utf-8');

        const wranglerBin = getWranglerBin();
        console.log('   ⚡ 正在执行: wrangler d1 execute gallery-d1 --remote --file=.temp-d1-sync.sql -y');
        const res = spawnSync(process.execPath, [wranglerBin, 'd1', 'execute', 'gallery-d1', '--remote', `--file=${tempSqlPath}`, '-y'], {
          encoding: 'utf-8',
          timeout: 120000,
          shell: false,
        });

        if (res.error || res.status !== 0) {
          const errMsg = res.stderr || res.stdout || res.error?.message || '未知错误';
          console.error(`   ⚠️ 远程 D1 数据库同步遇到异常: ${errMsg}`);
          console.error('   💡 提示: 您可以稍后通过检查 wrangler 登录状态和网络权限后重试。');
        } else {
          console.log('   ✓ 远程 Cloudflare D1 边缘数据库已同步成功！');
        }
      } catch (d1Err) {
        console.error('   ⚠️ 远程 D1 同步失败:', d1Err);
      } finally {
        if (fs.existsSync(tempSqlPath)) {
          try {
            fs.unlinkSync(tempSqlPath);
          } catch {}
        }
      }
    }
  }

  console.log('================================================================\n');

  // P1: 批次失败退出控制
  if (failedCount > 0) {
    console.error(`⚠️ 批次导入存在 ${failedCount} 项失败:`);
    for (const item of failedItems) {
      console.error(`   - ${item.file}: ${item.error}`);
    }
    if (!allowPartial) {
      console.error('❌ 未指定 --allow-partial，命令以非零状态码退出。\n');
      process.exit(1);
    }
  }
}

runUploadPipeline().catch((err) => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
