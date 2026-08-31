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

export interface ActiveMemberItem {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'member';
  joinedAt: number;
}

interface AuthState {
  isAuthenticated: boolean;
  isInitialized: boolean;
  user: UserProfile | null;
  household: HouseholdInfo | null;
  role: 'owner' | 'member' | null;
  sessionToken: string | null;
  members: ActiveMemberItem[];

  // Modal 控制
  isLoginModalOpen: boolean;
  isInitModalOpen: boolean;
  isStudioOpen: boolean;
  isInviteModalOpen: boolean;
  pendingInviteToken: string | null;

  // Actions
  setLoginModalOpen: (open: boolean) => void;
  setInitModalOpen: (open: boolean) => void;
  setStudioOpen: (open: boolean) => void;
  setInviteModalOpen: (open: boolean, token?: string) => void;
  
  login: (email: string, password: string) => Promise<boolean>;
  initOwner: (params: { householdName: string; email: string; displayName: string; password: string }) => Promise<boolean>;
  logout: () => void;
  createInviteToken: (targetEmail: string) => Promise<{ token: string; expiresAt: number }>;
  acceptInvite: (token: string, displayName: string, password: string) => Promise<boolean>;
  removeMember: (userId: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // 默认模拟初始化状态（Owner 已登录，方便本地体验管理端，随时可在右上角登出或切换）
  isAuthenticated: true,
  isInitialized: true,
  user: {
    id: 'usr_owner_01',
    email: 'owner@loveqin.wang',
    displayName: 'Qin & Wang',
  },
  household: {
    id: 'hh_01',
    name: 'Qin & Wang 的家庭空间',
  },
  role: 'owner',
  sessionToken: 'mock_session_token_123',
  members: [
    {
      id: 'mem_01',
      userId: 'usr_owner_01',
      email: 'owner@loveqin.wang',
      displayName: 'Qin & Wang',
      role: 'owner',
      joinedAt: Date.now() - 365 * 86400000,
    },
    {
      id: 'mem_02',
      userId: 'usr_member_02',
      email: 'family@loveqin.wang',
      displayName: '阿姨与家人',
      role: 'member',
      joinedAt: Date.now() - 30 * 86400000,
    },
  ],

  isLoginModalOpen: false,
  isInitModalOpen: false,
  isStudioOpen: false,
  isInviteModalOpen: false,
  pendingInviteToken: null,

  setLoginModalOpen: (open) => set({ isLoginModalOpen: open }),
  setInitModalOpen: (open) => set({ isInitModalOpen: open }),
  setStudioOpen: (open) => set({ isStudioOpen: open }),
  setInviteModalOpen: (open, token) => set({ isInviteModalOpen: open, pendingInviteToken: token || null }),

  login: async (email, password) => {
    // 模拟登录逻辑校验
    if (password.length < 6) {
      throw new Error('密码长度不能少于 6 位');
    }
    const isOwner = email.toLowerCase().includes('owner');
    set({
      isAuthenticated: true,
      user: {
        id: isOwner ? 'usr_owner_01' : 'usr_member_02',
        email,
        displayName: isOwner ? 'Qin (Owner)' : '家庭成员',
      },
      role: isOwner ? 'owner' : 'member',
      isLoginModalOpen: false,
    });
    return true;
  },

  initOwner: async (params) => {
    set({
      isAuthenticated: true,
      isInitialized: true,
      user: {
        id: 'usr_owner_01',
        email: params.email,
        displayName: params.displayName,
      },
      household: {
        id: 'hh_01',
        name: params.householdName,
      },
      role: 'owner',
      isInitModalOpen: false,
    });
    return true;
  },

  logout: () => {
    set({
      isAuthenticated: false,
      user: null,
      role: null,
      sessionToken: null,
      isStudioOpen: false,
    });
  },

  createInviteToken: async (_targetEmail: string) => {
    const rawToken = 'inv_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const expiresAt = Date.now() + 7 * 86400000;
    return { token: rawToken, expiresAt };
  },

  acceptInvite: async (_token, displayName, _password) => {
    const newMember: ActiveMemberItem = {
      id: 'mem_' + Date.now(),
      userId: 'usr_' + Date.now(),
      email: 'new_member@loveqin.wang',
      displayName,
      role: 'member',
      joinedAt: Date.now(),
    };
    set((state) => ({
      members: [...state.members, newMember],
      isAuthenticated: true,
      user: {
        id: newMember.userId,
        email: newMember.email,
        displayName,
      },
      role: 'member',
      isInviteModalOpen: false,
    }));
    return true;
  },

  removeMember: (userId) => {
    set((state) => ({
      members: state.members.filter((m) => m.userId !== userId),
    }));
  },
}));
