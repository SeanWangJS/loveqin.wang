import { PhotoItem } from '../types/gallery';

const CURATED_SAMPLE_IMAGES = [
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80', // Yosemite valley
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80', // Mountain peaks
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80', // Starry mountain
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1200&q=80', // Misty forest
  'https://images.unsplash.com/photo-1426604966848-d7adac402bff?auto=format&fit=crop&w=1200&q=80', // Mountain ridge
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=1200&q=80', // Sunrise valley
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1200&q=80', // Lake pier
  'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=1200&q=80', // Autumn path
  'https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?auto=format&fit=crop&w=1200&q=80', // Calm lake
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80', // Tropical coast
  'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=1200&q=80', // Pine forest
  'https://images.unsplash.com/photo-1434725039720-aaad6dd32dfe?auto=format&fit=crop&w=1200&q=80', // Green hills
  'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1200&q=80', // Aurora night
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80', // Nature girl
  'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=1200&q=80', // Mountain hiker
];

const LOCATIONS = [
  '川西 · 折多山雪霁',
  '云南 · 洱海晨雾与水杉',
  '西藏 · 纳木错璀璨星空',
  '新疆 · 赛里木湖之蓝',
  '瑞士 · 采尔马特马特洪峰',
  '挪威 · 罗弗敦群岛极光',
  '青海 · 祁连山大草原',
  '富士山 · 河口湖初雪',
  '冰岛 · 瓦特纳黑沙滩',
  '京都 · 岚山竹林听风',
  '内蒙古 · 呼伦贝尔金秋',
  '稻城 · 亚丁央迈勇雪峰',
];

const CAMERAS = [
  { model: 'Sony Alpha 7R V', lens: 'FE 24-70mm F2.8 GM II' },
  { model: 'Fujifilm X-T5', lens: 'XF 33mm F1.4 R LM WR' },
  { model: 'Leica Q3', lens: 'Summilux 28mm f/1.7 ASPH' },
  { model: 'iPhone 15 Pro Max', lens: 'Main 24mm f/1.78' },
  { model: 'Canon EOS R5', lens: 'RF 50mm F1.2 L USM' },
  { model: 'Hasselblad X2D 100C', lens: 'XCD 38mm F2.5 V' },
];

const STORIES = [
  '清晨六点半的山顶，零下五度的空气清冽透明，阳光刺破云层的瞬间，天地都被染成了淡金。',
  '栈桥尽头的湖水静止如镜，仿佛时间在这一刻悄然驻足，记录下我们并肩看海的背影。',
  '极光如流动的绿色丝绸在头顶苍穹漫舞，四周除了风声别无他物，这是宇宙最浪漫的馈赠。',
  '穿越漫长森林后豁然开朗的山谷，流水潺潺，秋意渐浓，随手一拍都是一封寄往岁月的明信片。',
  '雨后的街道倒映着霓虹与晚霞，微风拂过水面泛起涟漪，城市的喧嚣在镜头里归于平静。',
  '暮色四合时的雪山倒影，冷暖光线在水天之间交织，定格下那一瞬不可多得的心动。',
];

/**
 * 生成 500 张覆盖 2021 ~ 2026 年跨度的高保真测试照片数据集
 */
export function generateMockPhotos(count: number = 500): PhotoItem[] {
  const photos: PhotoItem[] = [];
  
  // 起始时间：2021-01-15 08:30:00
  const startTime = Date.parse('2021-01-15T08:30:00Z');
  // 结束时间：2026-08-20 18:00:00
  const endTime = Date.parse('2026-08-20T18:00:00Z');
  const totalDuration = endTime - startTime;
  
  let currentTimestamp = startTime;

  for (let i = 0; i < count; i++) {
    // 模拟真实拍摄节奏：
    // 30% 几率为连拍（间隔 1~5 秒）
    // 40% 几率为同日事件（间隔 10 分钟 ~ 3 小时）
    // 30% 几率为跨日/跨月跨度（间隔 2 天 ~ 15 天）
    const r = (i * 17 + 7) % 100 / 100;
    let stepMs: number;
    if (r < 0.25) {
      stepMs = 1500 + (i % 5) * 800; // 连拍
    } else if (r < 0.65) {
      stepMs = 1000 * 60 * (15 + (i % 12) * 20); // 同日
    } else {
      stepMs = 1000 * 60 * 60 * 24 * (1 + (i % 18)); // 跨日
    }

    currentTimestamp += stepMs;
    // 保证在范围内渐进推进
    if (currentTimestamp > endTime) {
      currentTimestamp = startTime + (i / count) * totalDuration;
    }

    const date = new Date(currentTimestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const imgIndex = i % CURATED_SAMPLE_IMAGES.length;
    const baseImgUrl = CURATED_SAMPLE_IMAGES[imgIndex];
    const location = LOCATIONS[i % LOCATIONS.length];
    const camera = CAMERAS[i % CAMERAS.length];
    const story = STORIES[i % STORIES.length];

    photos.push({
      id: `photo-${i + 1}`,
      albumId: 'default-household',
      title: `${location.split(' · ')[0]} · 珍藏回忆 #${i + 1}`,
      story: story,
      takenAt: currentTimestamp,
      takenAtSort: currentTimestamp,
      takenAtLocal: `${dateStr} ${date.toTimeString().slice(0, 8)}`,
      locationName: location,
      width: 1920,
      height: 1280,
      urlThumbLow: `${baseImgUrl}&w=300&q=60`,
      urlThumbHigh: `${baseImgUrl}&w=800&q=75`,
      urlDisplay: `${baseImgUrl}&w=1920&q=85`,
      exif: {
        cameraModel: camera.model,
        lensModel: camera.lens,
        focalLength: `${24 + (i % 6) * 15}mm`,
        aperture: `f/${(1.4 + (i % 5) * 0.7).toFixed(1)}`,
        shutterSpeed: `1/${125 * Math.pow(2, i % 5)}s`,
        iso: 100 * Math.pow(2, i % 6),
        colorSpace: 'Display P3',
      },
      likesCount: (i * 3 + 1) % 19,
      isLiked: i % 4 === 0,
    });
  }

  // 严格按时间升序排序
  photos.sort((a, b) => a.takenAtSort - b.takenAtSort);

  return photos;
}
