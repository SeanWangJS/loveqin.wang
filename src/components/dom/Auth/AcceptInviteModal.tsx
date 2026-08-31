import React, { useState } from 'react';
import { X, KeyRound, User, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';

export const AcceptInviteModal: React.FC = () => {
  const isInviteModalOpen = useAuthStore((s) => s.isInviteModalOpen);
  const pendingInviteToken = useAuthStore((s) => s.pendingInviteToken);
  const setInviteModalOpen = useAuthStore((s) => s.setInviteModalOpen);
  const acceptInvite = useAuthStore((s) => s.acceptInvite);

  const [tokenInput, setTokenInput] = useState(pendingInviteToken || '');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isInviteModalOpen) return null;

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      await acceptInvite(tokenInput, displayName, password);
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setInviteModalOpen(false);
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || '接受邀请失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-md bg-void-surface/90 border border-aurora-cyan/30 rounded-2xl p-7 shadow-2xl shadow-aurora-cyan/10">
        <button
          onClick={() => setInviteModalOpen(false)}
          className="absolute top-5 right-5 text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-aurora-teal/10 border border-aurora-teal/30 rounded-xl text-aurora-teal">
            <KeyRound size={26} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide">加入 Qin & Wang 家庭空间</h2>
            <p className="text-xs text-gray-400 mt-0.5">凭单次专属邀请码激活您的成员身份</p>
          </div>
        </div>

        {isSuccess ? (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <CheckCircle2 size={48} className="text-emerald-400 mb-3 animate-bounce" />
            <h3 className="text-lg font-bold text-white mb-1">欢迎加入家庭空间！</h3>
            <p className="text-xs text-gray-400">正在为您开启专属时光长廊...</p>
          </div>
        ) : (
          <form onSubmit={handleAccept} className="space-y-4">
            {errorMsg && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                {errorMsg}
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-300 mb-1.5 font-medium">邀请码 (Token)</label>
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                required
                className="w-full bg-void-bg/80 border border-white/15 rounded-xl px-4 py-2.5 text-xs font-mono text-aurora-cyan focus:border-aurora-cyan focus:outline-none transition"
                placeholder="请输入 inv_ 开头的专属邀请码"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-300 mb-1.5 font-medium">您的昵称 / 称谓</label>
              <div className="relative">
                <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  className="w-full bg-void-bg/80 border border-white/15 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:border-aurora-cyan focus:outline-none transition"
                  placeholder="例如：舅舅 / 表姐 / 挚友"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-300 mb-1.5 font-medium">设置您的专属访问密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-void-bg/80 border border-white/15 rounded-xl px-4 py-2.5 text-sm text-white focus:border-aurora-cyan focus:outline-none transition"
                placeholder="至少 6 位安全密码"
              />
            </div>

            <button
              type="submit"
              className="w-full mt-2 py-3 bg-gradient-to-r from-aurora-teal to-aurora-cyan hover:opacity-90 text-void-bg font-semibold rounded-xl text-sm transition shadow-lg shadow-aurora-teal/20"
            >
              验证邀请并加入空间
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
