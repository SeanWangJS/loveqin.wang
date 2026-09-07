import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { spawnSync } from 'child_process';

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.heic', '.heif']);
const PROJECT_ROOT = process.cwd();
const RAW_PHOTOS_DIR = path.resolve(PROJECT_ROOT, 'raw_photos');
const LOCAL_OBJECT_STORE_DIR = path.resolve(PROJECT_ROOT, '.local-object-store');
const LOCAL_DB_PATH = path.resolve(PROJECT_ROOT, '.local-d1.sqlite');

interface EnvConfig {
  bucketName: string;
  databaseName: string;
  householdId: string;
  cloudflareEnv: string;
}

interface AssetRow {
  photo_id: string;
  r2_key: string;
}

function loadDotEnv(): void {
  const envPath = path.resolve(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (!process.env[key]) process.env[key] = value;
  }
}

function getConfig(): EnvConfig {
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || '';
  const databaseName = process.env.CLOUDFLARE_D1_DATABASE_NAME || '';
  const householdId = process.env.PHOTO_IMPORT_HOUSEHOLD_ID || '';
  const cloudflareEnv = process.env.CLOUDFLARE_ENV || 'production';

  const missing = [
    ['CLOUDFLARE_R2_BUCKET_NAME', bucketName],
    ['CLOUDFLARE_D1_DATABASE_NAME', databaseName],
    ['PHOTO_IMPORT_HOUSEHOLD_ID', householdId],
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`清理配置缺失: ${missing.join(', ')}`);
  }

  return { bucketName, databaseName, householdId, cloudflareEnv };
}

function getWranglerBin(): string {
  return path.resolve(PROJECT_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
}

function runWrangler(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(process.execPath, [getWranglerBin(), ...args], {
    encoding: 'utf8',
    timeout: 120000,
    shell: false,
  });

  if (result.error) {
    throw new Error(`Wrangler 执行失败: ${result.error.message}`);
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 1,
  };
}

function getEnvironmentArgs(cloudflareEnv: string): string[] {
  return cloudflareEnv && cloudflareEnv !== 'production' ? [`--env=${cloudflareEnv}`] : [];
}

function parseJsonRows(output: string): AssetRow[] {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start < 0 || end < start) {
    throw new Error(`无法解析 Wrangler JSON 输出: ${output.slice(-1000)}`);
  }

  const parsed: unknown = JSON.parse(output.slice(start, end + 1));
  const rows: AssetRow[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    if (typeof record.photo_id === 'string' && typeof record.r2_key === 'string') {
      rows.push({ photo_id: record.photo_id, r2_key: record.r2_key });
    }
    Object.values(record).forEach(visit);
  };

  visit(parsed);
  return rows;
}

function queryRemoteAssets(config: EnvConfig): AssetRow[] {
  const sql = `SELECT p.id AS photo_id, pa.r2_key FROM photos p JOIN photo_assets pa ON pa.photo_id = p.id WHERE p.household_id = '${config.householdId.replace(/'/g, "''")}';`;
  const result = runWrangler([
    'd1',
    'execute',
    config.databaseName,
    ...getEnvironmentArgs(config.cloudflareEnv),
    '--remote',
    '--json',
    '--command',
    sql,
  ]);

  if (result.status !== 0) {
    throw new Error(`远程 D1 清单查询失败:\n${result.stderr || result.stdout}`);
  }

  return parseJsonRows(result.stdout);
}

function collectLocalImages(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  const files: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectLocalImages(entryPath));
    } else if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }

  return files;
}

function getLocalAssetDirectories(householdId: string): string[] {
  return ['display', 'originals', 'thumbs_high', 'thumbs_low']
    .map((variant) => path.join(LOCAL_OBJECT_STORE_DIR, variant, householdId));
}

function countFiles(directory: string): number {
  if (!fs.existsSync(directory)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    count += entry.isDirectory() ? countFiles(entryPath) : 1;
  }
  return count;
}

function deleteLocalD1Rows(householdId: string): number {
  if (!fs.existsSync(LOCAL_DB_PATH)) return 0;
  const db = new Database(LOCAL_DB_PATH);
  db.pragma('foreign_keys = ON');
  try {
    const result = db.prepare('DELETE FROM photos WHERE household_id = ?').run(householdId);
    return Number(result.changes);
  } finally {
    db.close();
  }
}

function deleteRemoteD1Rows(config: EnvConfig): void {
  const household = config.householdId.replace(/'/g, "''");
  const result = runWrangler([
    'd1',
    'execute',
    config.databaseName,
    ...getEnvironmentArgs(config.cloudflareEnv),
    '--remote',
    '--command',
    `DELETE FROM photos WHERE household_id = '${household}';`,
    '-y',
  ]);

  if (result.status !== 0) {
    throw new Error(`远程 D1 删除失败:\n${result.stderr || result.stdout}`);
  }
}

function deleteRemoteR2Objects(config: EnvConfig, keys: string[]): void {
  for (const key of keys) {
    const result = runWrangler([
      'r2',
      'object',
      'delete',
      `${config.bucketName}/${key}`,
      '--remote',
      '-y',
    ]);
    if (result.status !== 0) {
      throw new Error(`R2 对象删除失败 [${key}]:\n${result.stderr || result.stdout}`);
    }
  }
}

function removeLocalFiles(pathsToRemove: string[]): void {
  for (const filePath of pathsToRemove) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  }
}

function printPlan(config: EnvConfig, assets: AssetRow[], localImages: string[], localAssetDirectories: string[], execute: boolean): void {
  const keys = [...new Set(assets.map((asset) => asset.r2_key))];
  const localDerivedCount = localAssetDirectories.reduce((sum, directory) => sum + countFiles(directory), 0);

  console.log('================================================================');
  console.log(execute ? '🧹 画廊全量清理执行计划' : '🔍 画廊全量清理预览（不会删除任何文件）');
  console.log('================================================================');
  console.log(`生产 D1: ${config.databaseName}`);
  console.log(`生产 R2: ${config.bucketName}`);
  console.log(`家庭空间: ${config.householdId}`);
  console.log(`远程照片资产: ${assets.length} 条记录，${keys.length} 个唯一 R2 对象`);
  console.log(`本地原始图片: ${localImages.length} 个`);
  console.log(`本地派生对象: ${localDerivedCount} 个`);
  console.log('');
  console.log('注意：没有 R2 S3 凭据时，脚本只能删除 D1 已登记的 R2 对象，不能枚举历史孤儿对象。');
}

async function main(): Promise<void> {
  loadDotEnv();
  const execute = process.argv.includes('--execute');
  const help = process.argv.includes('--help') || process.argv.includes('-h');

  if (help) {
    console.log(`
用法:
  pnpm gallery:clear                 只生成清理清单（默认）
  pnpm gallery:clear --execute       删除指定家庭空间的生产 R2/D1 和本地图片

范围:
  - 生产 D1 中 PHOTO_IMPORT_HOUSEHOLD_ID 对应的 photos 及级联 photo_assets
  - 生产 R2 中 D1 已登记的 r2_key
  - raw_photos/ 下的图片文件
  - .local-object-store/ 下该家庭空间的派生对象
  - 本地 .local-d1.sqlite 中该家庭空间的 photos 记录
`);
    return;
  }

  const config = getConfig();
  const assets = queryRemoteAssets(config);
  const localImages = collectLocalImages(RAW_PHOTOS_DIR);
  const localAssetDirectories = getLocalAssetDirectories(config.householdId);
  printPlan(config, assets, localImages, localAssetDirectories, execute);

  if (!execute) {
    console.log('\n这是预览模式。确认清单无误后，再追加 --execute。');
    return;
  }

  const keys = [...new Set(assets.map((asset) => asset.r2_key))];
  console.log('\n☁️ 正在删除生产 R2 对象...');
  deleteRemoteR2Objects(config, keys);
  console.log(`✓ 已删除 ${keys.length} 个生产 R2 对象`);

  console.log('☁️ 正在删除生产 D1 照片记录...');
  deleteRemoteD1Rows(config);
  console.log('✓ 已删除生产 D1 照片记录及级联资产');

  console.log('💾 正在删除本地原始图片和派生对象...');
  removeLocalFiles(localImages);
  for (const directory of localAssetDirectories) {
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  }
  const localPhotoCount = deleteLocalD1Rows(config.householdId);
  console.log(`✓ 已删除本地图片、派生对象和 ${localPhotoCount} 条本地照片记录`);
  console.log('\n🎉 画廊清理完成。');
}

main().catch((error: unknown) => {
  console.error(`\n❌ 清理已停止: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
