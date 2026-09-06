import { describe, it, expect, beforeEach } from 'vitest';
import { useGalleryStore } from '../stores/useGalleryStore';

describe('3D 画廊与 2D 网格视图切换生命周期测试 (Galaxy Lifecycle & View Switching)', () => {
  beforeEach(() => {
    // 重置 store 初始状态
    useGalleryStore.setState({
      photos: [
        {
          id: 'p1',
          householdId: 'hh1',
          title: '测试照片',
          takenAt: '2026-06-01T12:00:00Z',
          takenAtLocal: '2026-06-01',
          width: 1920,
          height: 1080,
          aspectRatio: 1.77,
          status: 'ready',
          locationName: '青岛',
          story: '家庭回忆',
        } as any,
      ],
      viewMode: 'tunnel',
      isInitialLoading: true,
      isCorridorReady: false,
      loadingProgress: 0,
      isWarping: false,
      isWarpRequested: false,
      minZ: 0,
      maxZ: 100,
      targetZ: 12,
    });
  });

  it('1. 首次进入时：初始加载中，长廊未就绪，银河加载控制器处于待命状态', () => {
    const state = useGalleryStore.getState();
    expect(state.isInitialLoading).toBe(true);
    expect(state.isCorridorReady).toBe(false);

    // 银河控制器挂载条件 (isInitialLoading || !isCorridorReady) 应为 true
    const shouldMountWarpDirector = state.isInitialLoading || !state.isCorridorReady;
    expect(shouldMountWarpDirector).toBe(true);
  });

  it('2. 跃迁完成进入 3D 长廊后：isCorridorReady 设为 true，isInitialLoading 设为 false', () => {
    // 模拟曲速动画完成
    useGalleryStore.getState().setIsCorridorReady(true);
    useGalleryStore.getState().setIsInitialLoading(false);

    const state = useGalleryStore.getState();
    expect(state.isCorridorReady).toBe(true);
    expect(state.isInitialLoading).toBe(false);

    // 银河控制器挂载条件 (isInitialLoading || !isCorridorReady) 应为 false
    const shouldMountWarpDirector = state.isInitialLoading || !state.isCorridorReady;
    expect(shouldMountWarpDirector).toBe(false);
  });

  it('3. 从 3D 切换到 2D 平面网格，再切回 3D 布局时：银河挂载条件保持为 false，绝不重新叠加银河旋臂', () => {
    // 1. 已在 3D 长廊中浏览
    useGalleryStore.getState().setIsCorridorReady(true);
    useGalleryStore.getState().setIsInitialLoading(false);
    useGalleryStore.getState().setTargetZ(55.5);

    // 2. 切换到 2D 网格视图
    useGalleryStore.getState().setViewMode('grid');
    expect(useGalleryStore.getState().viewMode).toBe('grid');

    // 3. 从 2D 网格视图切回 3D 长廊视图
    useGalleryStore.getState().setViewMode('tunnel');
    expect(useGalleryStore.getState().viewMode).toBe('tunnel');

    // 4. 断言：时光长廊状态与加载状态保持不变，银河控制器坚决不挂载
    const state = useGalleryStore.getState();
    expect(state.isCorridorReady).toBe(true);
    expect(state.isInitialLoading).toBe(false);

    const shouldMountWarpDirector = state.isInitialLoading || !state.isCorridorReady;
    expect(shouldMountWarpDirector).toBe(false);

    // 5. 目标相机位置保持准确，不重置到初始原点
    expect(state.targetZ).toBe(55.5);
  });

  it('4. 在 2D 网格中点击“在3D中定位”某张照片后切回 3D：准确定位并保持银河隐藏', () => {
    useGalleryStore.getState().setIsCorridorReady(true);
    useGalleryStore.getState().setIsInitialLoading(false);
    useGalleryStore.getState().setViewMode('grid');

    // 模拟在 2D 中点击定位
    useGalleryStore.getState().jumpToPhoto('p1');
    useGalleryStore.getState().setViewMode('tunnel');

    const state = useGalleryStore.getState();
    expect(state.viewMode).toBe('tunnel');
    expect(state.isCorridorReady).toBe(true);
    expect(state.isInitialLoading).toBe(false);

    const shouldMountWarpDirector = state.isInitialLoading || !state.isCorridorReady;
    expect(shouldMountWarpDirector).toBe(false);
  });
});
