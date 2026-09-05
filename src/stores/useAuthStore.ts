import { create } from 'zustand';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
}

export interface HouseholdInfo {
  id: string;
  name: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isInitialized: boolean;
  user: UserProfile | null;
  household: HouseholdInfo | null;
  role: 'viewer' | null;

  // 状态检查与注销 Actions
  checkAuth: () => Promise<boolean>;
  logout: () => void;

  // 向后兼容保留的只读存根 (不开放管理与自建弹窗)
  isStudioOpen: boolean;
  setStudioOpen: (open: boolean) => void;
  isLoginModalOpen: boolean;
  setLoginModalOpen: (open: boolean) => void;
  isInviteModalOpen: boolean;
  setInviteModalOpen: (open: boolean, token?: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // 默认初始状态：未认证，等待 Cloudflare Access 验证
  isAuthenticated: false,
  isInitialized: false,
  user: null,
  household: null,
  role: null,

  isStudioOpen: false,
  setStudioOpen: () => set({ isStudioOpen: false }), // 当前只读版本关闭 Studio
  isLoginModalOpen: false,
  setLoginModalOpen: () => set({ isLoginModalOpen: false }),
  isInviteModalOpen: false,
  setInviteModalOpen: () => set({ isInviteModalOpen: false }),

  checkAuth: async () => {
    try {
      const res = await fetch('/api/auth/session', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        set({ isAuthenticated: false, isInitialized: true, user: null, role: null });
        return false;
      }
      const data = await res.json();
      if (data.authenticated && data.user) {
        set({
          isAuthenticated: true,
          isInitialized: true,
          user: data.user,
          household: {
            id: data.householdId || 'household_default',
            name: 'Family Memories',
          },
          role: 'viewer', // 统一收敛为只读访客角色
        });
        return true;
      }
      set({ isAuthenticated: false, isInitialized: true, user: null, role: null });
      return false;
    } catch {
      set({ isAuthenticated: false, isInitialized: true, user: null, role: null });
      return false;
    }
  },

  logout: () => {
    set({
      isAuthenticated: false,
      user: null,
      role: null,
      isStudioOpen: false,
    });
    // 重定向至 Cloudflare Access 官方注销端点
    if (typeof window !== 'undefined') {
      window.location.href = '/cdn-cgi/access/logout';
    }
  },
}));
