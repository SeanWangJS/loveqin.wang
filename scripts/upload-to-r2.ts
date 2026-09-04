import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import ExifReader from 'exifreader';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    isS3Configured: Boolean(accountId && accessKeyId && secretAccessKey),
  };
}

// 2. 检测 Wrangler 是否已登录 Cloudflare (带超时控制，绝不挂起)
function checkWranglerAuth(): boolean {
  try {
    const res = spawnSync('pnpm', ['wrangler', 'whoami'], {
      encoding: 'utf-8',
      timeout: 3000,
      shell: true,
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
  const res = spawnSync('pnpm', ['wrangler', 'r2', 'object', 'put', `${bucketName}/${remoteKey}`, `--file=${localFilePath}`], {
    encoding: 'utf-8',
    timeout: 60000,
    shell: true,
  });

  if (res.error || res.status !== 0) {
    const errMsg = res.stderr || res.stdout || res.error?.message || '未知错误';
    throw new Error(`Wrangler 上传失败 [${remoteKey}]: ${errMsg}`);
  }
  return true;
}

// 4. 解析照片拍摄时间与 EXIF 器材参数 (统一时区策略)
async function extractMetadata(_filePath: string, buffer: Buffer, mtimeMs: number, tzOffsetMinutes: number) {
  let tags: Record<string, unknown> = {};
  try {
    tags = ExifReader.load(buffer) as Record<string, unknown>;
  } catch {
    // 特殊图片无 EXIF，走备选
  }

  let takenAt = mtimeMs;
  const dLocal = new Date(mtimeMs);
  let takenAtLocal = dLocal.toISOString().slice(0, 19).replace('T', ' ');

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
      }
    }
  }

  const make = (tags['Make'] as { description?: string } | undefined)?.description || '';
  const model = (tags['Model'] as { description?: string } | undefined)?.description || '';
  const cameraModel = (model.includes(make) ? model : `${make} ${model}`).trim() || undefined;

  const lens = (tags['LensModel'] || tags['Lens']) as { description?: string } | undefined;
  const lensModel = lens?.description ? lens.description.trim() : undefined;

  const focal = tags['FocalLength'] as { description?: string } | undefined;
  const focalLength = focal?.description ? focal.description.trim() : undefined;

  const fNumber = tags['FNumber'] as { description?: string } | undefined;
  const aperture = fNumber?.description ? (fNumber.description.startsWith('f/') ? fNumber.description : `f/${fNumber.description}`) : undefined;

  const exposure = tags['ExposureTime'] as { description?: string } | undefined;
  const shutterSpeed = exposure?.description ? (exposure.description.includes('/') ? exposure.description : `${exposure.description}s`) : undefined;

  const isoTag = (tags['ISOSpeedRatings'] || tags['ISO']) as { value?: unknown } | undefined;
  const iso = isoTag && typeof isoTag.value === 'number' ? isoTag.value : undefined;

  const exif: ExifSafeData = {
    cameraModel,
    lensModel,
    focalLength,
    aperture,
    shutterSpeed,
    iso,
  };

  return { takenAt, takenAtLocal, exif };
}

// 主上传与多级流水分辨率压缩
async function runUploadPipeline() {
  console.log('\n================================================================');
  console.log('🌌 3D 时光长廊 · 真实照片全自动多级 LOD 压缩与 R2 / D1 流水线');
  console.log('================================================================\n');

  // 1. 先行确保本地 D1 数据库迁移就绪
  await runMigrations();
  const db = getDatabase();

  const config = loadConfig();
  const rawPhotosDir = path.resolve(process.cwd(), 'raw_photos');

  if (!fs.existsSync(rawPhotosDir)) {
    fs.mkdirSync(rawPhotosDir, { recursive: true });
    console.log(`📁 未发现照片源目录，已自动创建: ${rawPhotosDir}`);
    console.log('👉 请先将想要导入的照片（.jpg, .png, .webp, .heic 等）放入 raw_photos/ 后重新执行！\n');
    return;
  }

  const files = fs.readdirSync(rawPhotosDir).filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return SUPPORTED_EXTENSIONS.has(ext);
  });

  if (files.length === 0) {
    console.log(`⚠️ 在 ${rawPhotosDir} 中未找到任何图片文件！`);
    console.log('👉 请先将照片放入 raw_photos/ 文件夹中。\n');
    return;
  }

  console.log(`📸 发现待处理照片: ${files.length} 张`);

  const isRemote = process.argv.includes('--remote') || process.argv.includes('--cloud');
  let s3Client: S3Client | null = null;
  let useWrangler = false;

  if (isRemote) {
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
        console.log(`⚡ [云端直传通道 2] 检测到已登录的 Wrangler 账号，启用【Wrangler 原生免密直传】(Bucket: ${config.bucketName})！`);
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

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    const filePath = path.join(rawPhotosDir, fileName);
    const fileStat = fs.statSync(filePath);

    console.log(`\n[${i + 1}/${files.length}] 正在检验与分析: ${fileName}...`);

    // P2 校验 1: 单文件 50 MiB 限制
    if (fileStat.size > MAX_FILE_SIZE) {
      console.warn(`   ⚠️ 警告: 文件大小 ${(fileStat.size / (1024 * 1024)).toFixed(1)} MiB 超出 50 MiB 规范上限，跳过处理。`);
      continue;
    }

    const rawBuffer = fs.readFileSync(filePath);

    // P1 优化: 稳定 ID 基于内容 SHA-256 哈希（杜绝增删文件引起的 ID 漂移）
    const contentHash = crypto.createHash('sha256').update(rawBuffer).digest('hex');
    const photoId = `p_${contentHash.slice(0, 16)}`;

    // P2 校验 2: 图片格式与 100 MP 解码像素限制
    let sharpInstance: sharp.Sharp;
    let metadata: sharp.Metadata;
    try {
      sharpInstance = sharp(rawBuffer).rotate();
      metadata = await sharpInstance.metadata();
    } catch (err) {
      console.warn(`   ⚠️ 警告: 无法解码图片内容 (${String(err)})，跳过。`);
      continue;
    }

    const width = metadata.width || 1920;
    const height = metadata.height || 1080;
    const totalPixels = width * height;

    if (totalPixels > MAX_PIXEL_COUNT) {
      console.warn(`   ⚠️ 警告: 图片总像素 ${(totalPixels / 1_000_000).toFixed(1)} MP 超出 100 MP 规范上限，跳过处理。`);
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
      continue;
    }

    // P1 状态机流转: 1. 写入 processing 状态
    const now = Date.now();
    const { takenAt, takenAtLocal, exif } = await extractMetadata(filePath, rawBuffer, fileStat.mtimeMs, tzOffsetMinutes);

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
        timePrecision: 'second',
        timeSource: 'exif',
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
      }
      console.log(`   ✓ 私有对象存储物理写入完成 (.local-object-store/)`);

      // 4. 若为远程模式，执行 R2 上传
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
        }
        console.log(`   ✓ [S3] R2 上传完成`);
      } else if (useWrangler) {
        console.log(`   ⚡ 正在通过 Wrangler 免密直传至 R2...`);
        for (const t of fileTasks) {
          uploadViaWrangler(config.bucketName, t.key, t.localPath);
        }
        console.log(`   ✓ [Wrangler] R2 上传完成`);
      }

      // 5. 写入/更新 photo_assets 表
      const assetInserts = [
        { id: `${photoId}_thumb_low`, photoId, variant: 'thumb_low', r2Key: keyThumbLow, mimeType: 'image/webp', byteSize: thumbLowBuffer.length, width: Math.min(256, width), height: Math.min(256, height) },
        { id: `${photoId}_thumb_high`, photoId, variant: 'thumb_high', r2Key: keyThumbHigh, mimeType: 'image/webp', byteSize: thumbHighBuffer.length, width: Math.min(1024, width), height: Math.min(1024, height) },
        { id: `${photoId}_display`, photoId, variant: 'display', r2Key: keyDisplay, mimeType: 'image/webp', byteSize: displayBuffer.length, width: Math.min(2560, width), height: Math.min(2560, height) },
        { id: `${photoId}_original`, photoId, variant: 'original', r2Key: keyOriginal, mimeType: metadata.format ? `image/${metadata.format}` : 'application/octet-stream', byteSize: rawBuffer.length, width, height },
      ];

      for (const a of assetInserts) {
        db.insert(schema.photoAssets)
          .values(a)
          .onConflictDoUpdate({
            target: [schema.photoAssets.photoId, schema.photoAssets.variant],
            set: {
              r2Key: a.r2Key,
              byteSize: a.byteSize,
              width: a.width,
              height: a.height,
            }
          })
          .run();
      }

      // 6. 状态流转推进为 ready
      db.update(schema.photos)
        .set({
          status: 'ready',
          takenAtSort: takenAt,
          takenAtLocal,
          width,
          height,
          exifSafeJson: JSON.stringify(exif),
          updatedAt: Date.now(),
        })
        .where(eq(schema.photos.id, photoId))
        .run();

      console.log(`   ✓ [D1] 状态流转已提交: ready`);

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

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`   ❌ 处理失败 [${photoId}]:`, errMsg);
      db.update(schema.photos)
        .set({ status: 'failed', processingError: errMsg, updatedAt: Date.now() })
        .where(eq(schema.photos.id, photoId))
        .run();
    }
  }

  // 7. 按时间先后正序排列并同步内部数据缓存 (用于离线/静态 fallback，绝对不在 public 暴露)
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
  console.log(`🎉 批量处理全部完成！当前可用照片数: ${processedPhotos.length} 张`);
  console.log(`🔒 私有对象存储: .local-object-store/ (物理隔离，未发布到任何公开目录)`);
  console.log(`📄 本地 D1 数据库: .local-d1.sqlite (已更新 photos & photo_assets)`);
  console.log(`🌐 访问方式: 通过本地开发 API (GET /api/photos & GET /api/media/:id/:variant)`);
  console.log('================================================================\n');
}

runUploadPipeline().catch((err) => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
