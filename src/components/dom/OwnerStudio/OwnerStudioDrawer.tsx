import React, { useState } from 'react';
import {
  X,
  UploadCloud,
  Image as ImageIcon,
  Users,
  Trash2,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Shield,
} from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useGalleryStore } from '../../../stores/useGalleryStore';
import { BatchUploadPanel } from './BatchUploadPanel';

export const OwnerStudioDrawer: React.FC = () => {
  const isStudioOpen = useAuthStore((s) => s.isStudioOpen);
  const setStudioOpen = useAuthStore((s) => s.setStudioOpen);
  const members = useAuthStore((s) => s.members);
  const createInviteToken = useAuthStore((s) => s.createInviteToken);
  const removeMember = useAuthStore((s) => s.removeMember);

  const photos = useGalleryStore((s) => s.photos);

  const [activeTab, setActiveTab] = useState<'upload' | 'albums' | 'photos' | 'members' | 'trash'>('upload');
  const [inviteEmail, setInviteEmail] = useState('');
  const [generatedInviteUrl, setGeneratedInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // 回收站模拟状态
  const [trashedPhotos, setTrashedPhotos] = useState<any[]>([]);

  if (!isStudioOpen) return null;

  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    const { token } = await createInviteToken(inviteEmail);
    const url = `${window.location.origin}/?invite=${token}`;
    setGeneratedInviteUrl(url);
  };

  const handleTrashPhoto = (photoId: string) => {
    const target = photos.find((p) => p.id === photoId);
    if (!target) return;
    setTrashedPhotos((prev) => [...prev, target]);
    useGalleryStore.setState({
      photos: photos.filter((p) => p.id !== photoId),
    });
  };

  const handleRestorePhoto = (photoId: string) => {
    const target = trashedPhotos.find((p) => p.id === photoId);
    if (!target) return;
    setTrashedPhotos((prev) => prev.filter((p) => p.id !== photoId));
    useGalleryStore.setState({
      photos: [target, ...useGalleryStore.getState().photos],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl h-full bg-void-surface/95 border-l border-white/15 p-6 flex flex-col shadow-2xl overflow-hidden">
        {/* 顶部标题与关闭 */}
        <div className="flex items-center justify-between pb-5 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-aurora-cyan/10 border border-aurora-cyan/30 rounded-xl text-aurora-cyan">
              <Shield size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                创作者控制台 (Owner Studio)
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-aurora-cyan/20 text-aurora-cyan border border-aurora-cyan/40">
                  空间管理员
                </span>
              </h2>
              <p className="text-xs text-gray-400">管理家庭回忆空间、媒体资产、成员权限与回收站</p>
            </div>
          </div>
          <button
            onClick={() => setStudioOpen(false)}
            className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/10 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* 导航 Tabs */}
        <div className="flex gap-2 py-4 border-b border-white/10 shrink-0 overflow-x-auto">
          {[
            { id: 'upload', label: '批量上传', icon: UploadCloud },
            { id: 'photos', label: `照片管理 (${photos.length})`, icon: ImageIcon },
            { id: 'members', label: `家庭成员 (${members.length})`, icon: Users },
            { id: 'trash', label: `回收站 (${trashedPhotos.length})`, icon: Trash2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition shrink-0 ${
                  isActive
                    ? 'bg-aurora-cyan/20 text-aurora-cyan border border-aurora-cyan/40 shadow-lg shadow-aurora-cyan/10'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 内容展示区 */}
        <div className="flex-1 overflow-y-auto py-5 pr-1 space-y-6">
          {/* Tab 1: 批量上传 */}
          {activeTab === 'upload' && <BatchUploadPanel />}

          {/* Tab 2: 照片管理 */}
          {activeTab === 'photos' && (
            <div className="space-y-4">
              <div className="text-xs text-gray-400">
                当前空间共有 {photos.length} 张就绪照片，可快捷移入回收站或修改元数据。
              </div>
              <div className="grid grid-cols-2 gap-3 max-h-[600px] overflow-y-auto pr-1">
                {photos.slice(0, 30).map((p) => (
                  <div
                    key={p.id}
                    className="p-3 bg-void-bg/80 border border-white/10 rounded-xl flex gap-3 group relative"
                  >
                    <img
                      src={p.urlThumbLow}
                      alt={p.title}
                      className="w-16 h-16 rounded-lg object-cover border border-white/10 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-semibold text-white truncate">{p.title || '无题'}</h4>
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">{p.locationName}</p>
                      <p className="text-[10px] text-gray-500 mt-1">
                        {new Date(p.takenAt).toLocaleDateString('zh-CN')}
                      </p>
                    </div>

                    <button
                      onClick={() => handleTrashPhoto(p.id)}
                      title="移入回收站"
                      className="absolute top-2 right-2 text-gray-500 hover:text-rose-400 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-rose-500/10 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: 家庭成员与邀请 */}
          {activeTab === 'members' && (
            <div className="space-y-6">
              {/* 发起邀请 */}
              <div className="p-4 bg-void-bg/80 border border-white/10 rounded-2xl space-y-3">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles size={14} className="text-aurora-cyan" />
                  邀请新成员加入空间
                </h3>
                <form onSubmit={handleGenerateInvite} className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    placeholder="请输入被邀请人邮箱（如 auntie@family.com）"
                    className="flex-1 bg-void-surface border border-white/15 rounded-xl px-3.5 py-2 text-xs text-white focus:border-aurora-cyan focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-aurora-cyan text-void-bg font-semibold rounded-xl text-xs hover:bg-aurora-cyan/90 transition shadow-lg shadow-aurora-cyan/20 shrink-0"
                  >
                    生成单次邀请链接
                  </button>
                </form>

                {generatedInviteUrl && (
                  <div className="p-3 bg-aurora-cyan/10 border border-aurora-cyan/30 rounded-xl space-y-1.5">
                    <p className="text-[11px] text-aurora-cyan font-medium">
                      ✓ 单次邀请码生成成功（7 天内有效，被使用后自动作废）：
                    </p>
                    <div className="flex items-center gap-2 bg-void-bg/90 p-2 rounded-lg text-xs font-mono text-gray-300">
                      <span className="truncate flex-1">{generatedInviteUrl}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(generatedInviteUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="text-aurora-cyan hover:text-white p-1 rounded transition"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 现有成员列表 */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  已加入成员列表
                </h3>
                <div className="space-y-2">
                  {members.map((m) => (
                    <div
                      key={m.userId}
                      className="flex items-center justify-between p-3.5 bg-void-bg/80 border border-white/10 rounded-xl"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-aurora-cyan/20 to-aurora-blue/20 border border-aurora-cyan/30 flex items-center justify-center text-xs font-bold text-aurora-cyan">
                          {m.displayName.slice(0, 1)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-white">{m.displayName}</span>
                            <span
                              className={`text-[10px] px-2 py-0.2 rounded-full border ${
                                m.role === 'owner'
                                  ? 'bg-aurora-cyan/10 text-aurora-cyan border-aurora-cyan/30'
                                  : 'bg-white/10 text-gray-300 border-white/20'
                              }`}
                            >
                              {m.role === 'owner' ? '空间 Owner' : '浏览 Member'}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-400 mt-0.5">{m.email}</p>
                        </div>
                      </div>

                      {m.role !== 'owner' && (
                        <button
                          onClick={() => removeMember(m.userId)}
                          className="text-xs text-rose-400 hover:text-rose-300 px-3 py-1 rounded-lg hover:bg-rose-500/10 transition border border-rose-500/20"
                        >
                          移除权限
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: 回收站与 30 天防误删恢复 */}
          {activeTab === 'trash' && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200">
                回收站中的照片将在 30 天后被系统永久清理。在到期前，您可以随时一键恢复回长廊。
              </div>

              {trashedPhotos.length === 0 ? (
                <div className="py-16 text-center text-gray-500 text-xs">
                  回收站空空如也，暂无已删除照片
                </div>
              ) : (
                <div className="space-y-2">
                  {trashedPhotos.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-void-bg/80 border border-white/10 rounded-xl"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={item.urlThumbLow}
                          alt={item.title}
                          className="w-12 h-12 rounded-lg object-cover opacity-60"
                        />
                        <div>
                          <p className="text-xs font-semibold text-white">{item.title || '无题'}</p>
                          <p className="text-[10px] text-amber-400/80 mt-0.5">剩余 30 天后自动清理</p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRestorePhoto(item.id)}
                        className="flex items-center gap-1.5 text-xs text-aurora-cyan hover:text-white px-3 py-1.5 bg-aurora-cyan/10 hover:bg-aurora-cyan/20 border border-aurora-cyan/30 rounded-lg transition"
                      >
                        <RotateCcw size={13} />
                        一键恢复
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
