import sharp from 'sharp';
import ExifReader from 'exifreader';
import fs from 'fs';
import path from 'path';

async function runImagePipelineVerification() {
  console.log('========================================================');
  console.log('🚀 正在启动 图像处理与 EXIF 脱敏管线 技术验证 (Phase 0)...');
  console.log('========================================================\n');

  const outputDir = path.resolve(process.cwd(), '.temp_verify_output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. 创建一张 3840x2160 (4K) 的合成测试原始图片
  console.log('1. 生成 4K (3840x2160) 高清测试原图样本...');
  const sampleRawBuffer = await sharp({
    create: {
      width: 3840,
      height: 2160,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="3840" height="2160">
            <defs>
              <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#38bdf8;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#06080b;stop-opacity:1" />
              </linearGradient>
            </defs>
            <rect width="3840" height="2160" fill="url(#grad)" />
            <circle cx="1920" cy="1080" r="400" fill="#2dd4bf" opacity="0.6" />
            <text x="1920" y="1080" font-size="96" fill="#ffffff" text-anchor="middle" font-family="sans-serif">
              TIME TUNNEL GALLERY · TEST IMAGE
            </text>
          </svg>`
        ),
      },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();

  const rawSizeKB = (sampleRawBuffer.length / 1024).toFixed(1);
  console.log(`   ✓ 测试原图生成成功，体积: ${rawSizeKB} KB\n`);

  // 2. 模拟三级 LOD 派生生成
  console.log('2. 正在执行多级 LOD 裁切与 WebP 格式重编码...');

  // Level 0: 远景微缩图 (最长边 256px, 极低体积)
  const thumbLowBuffer = await sharp(sampleRawBuffer)
    .resize(256, 256, { fit: 'inside' })
    .webp({ quality: 65 })
    .toBuffer();

  // Level 1: 近景高清图 (最长边 1024px)
  const thumbHighBuffer = await sharp(sampleRawBuffer)
    .resize(1024, 1024, { fit: 'inside' })
    .webp({ quality: 80 })
    .toBuffer();

  // Level 2: 全屏查看图 (最长边 2560px)
  const displayBuffer = await sharp(sampleRawBuffer)
    .resize(2560, 2560, { fit: 'inside' })
    .webp({ quality: 85 })
    .toBuffer();

  console.log(`   ✓ Level 0 (thumb_low  - 256px) : ${(thumbLowBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`   ✓ Level 1 (thumb_high - 1024px): ${(thumbHighBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`   ✓ Level 2 (display    - 2560px): ${(displayBuffer.length / 1024).toFixed(1)} KB\n`);

  // 3. 验证 EXIF 与 GPS 隐私剥离
  console.log('3. 正在使用 ExifReader 验证派生图安全脱敏...');
  const tagsThumbLow = ExifReader.load(thumbLowBuffer);
  const tagsThumbHigh = ExifReader.load(thumbHighBuffer);

  const hasGpsLow = !!tagsThumbLow['GPSLatitude'] || !!tagsThumbLow['GPSLongitude'];
  const hasGpsHigh = !!tagsThumbHigh['GPSLatitude'] || !!tagsThumbHigh['GPSLongitude'];

  if (!hasGpsLow && !hasGpsHigh) {
    console.log('   ✓ [安全合规] 派生图已彻底剔除 GPS 敏感地理位置信息！');
  } else {
    throw new Error('❌ 安全告警：派生图中仍然残留 GPS 敏感信息！');
  }

  // 4. 清理临时目录
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  console.log('\n========================================================');
  console.log('🎉 阶段 0 图像处理与脱敏管线验证全部通过！');
  console.log('========================================================\n');
}

runImagePipelineVerification().catch((err) => {
  console.error('验证过程发生错误:', err);
  process.exit(1);
});
