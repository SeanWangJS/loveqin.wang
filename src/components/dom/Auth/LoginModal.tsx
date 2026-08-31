import React, { useState } from 'react';
import { X, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';

export const LoginModal: React.FC = () => {
  const isLoginModalOpen = useAuthStore((s) => s.isLoginModalOpen);
  const setLoginModalOpen = useAuthStore((s) => s.setLoginModalOpen);
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState('owner@loveqin.wang');
  const [password, setPassword] = useState('Password123!');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isLoginModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setErrorMsg(err.message || '登录失败，请检查账号密码');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md bg-void-surface/90 border border-aurora-cyan/30 rounded-2xl p-7 shadow-2xl shadow-aurora-cyan/10">
        {/* 关闭按钮 */}
        <button
          onClick={() => setLoginModalOpen(false)}
          className="absolute top-5 right-5 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
        >
          <X size={20} />
        </button>

        {/* 头部 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-aurora-cyan/10 border border-aurora-cyan/30 rounded-xl text-aurora-cyan">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
              家庭空间私密鉴权
              <Sparkles size={16} className="text-aurora-cyan" />
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Qin & Wang 的私密时光长廊</p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-300 mb-1.5 font-medium">账号邮箱</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-void-bg/80 border border-white/15 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:border-aurora-cyan focus:outline-none transition"
                placeholder="请输入邮箱"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-300 mb-1.5 font-medium">访问密码</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-void-bg/80 border border-white/15 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:border-aurora-cyan focus:outline-none transition"
                placeholder="请输入密码"
              />
            </div>
          </div>

          {/* 快捷身份选择提示 */}
          <div className="pt-1 flex items-center justify-between text-xs text-gray-400">
            <span>快捷测试账号：</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEmail('owner@loveqin.wang');
                  setPassword('Password123!');
                }}
                className="text-aurora-cyan hover:underline"
              >
                Owner 身份
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => {
                  setEmail('member@loveqin.wang');
                  setPassword('Password123!');
                }}
                className="text-aurora-blue hover:underline"
              >
                Member 身份
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-3 bg-gradient-to-r from-aurora-cyan to-aurora-blue hover:from-aurora-cyan/90 hover:to-aurora-blue/90 text-void-bg font-semibold rounded-xl text-sm transition shadow-lg shadow-aurora-cyan/20 disabled:opacity-50"
          >
            {isLoading ? '正在安全校验...' : '进入家庭空间'}
          </button>
        </form>
      </div>
    </div>
  );
};
