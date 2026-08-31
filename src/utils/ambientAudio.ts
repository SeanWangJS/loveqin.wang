/**
 * 基于 Web Audio API 的纯原生空灵生成式氛围音乐引擎
 * 0 外部文件依赖 · 0 额外网络带宽 · 沉浸式温暖和弦与空灵风铃
 */

class AmbientAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isRunning = false;
  private timerId: any = null;

  private pentatonicScale = [220.0, 261.63, 329.63, 392.0, 440.0, 523.25, 659.25]; // A 小调五声和弦

  private initContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // 1. 创建基础温暖背景和声 (Drone)
      this.createWarmDrone();
    }
  }

  private createWarmDrone() {
    if (!this.ctx || !this.masterGain) return;

    // 低通滤波器营造温暖空气感
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, this.ctx.currentTime);
    filter.connect(this.masterGain);

    // 双音和声振荡器 (A2 + E3)
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(110, this.ctx.currentTime);

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(164.81, this.ctx.currentTime);

    const droneGain = this.ctx.createGain();
    droneGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

    osc1.connect(droneGain);
    osc2.connect(droneGain);
    droneGain.connect(filter);

    osc1.start();
    osc2.start();
  }

  /**
   * 随机触发一枚空灵的微光音阶音符
   */
  private triggerChime() {
    if (!this.ctx || !this.masterGain || !this.isRunning) return;

    const freq = this.pentatonicScale[Math.floor(Math.random() * this.pentatonicScale.length)];
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    // 泛音
    const oscHarmonic = this.ctx.createOscillator();
    oscHarmonic.type = 'sine';
    oscHarmonic.frequency.setValueAtTime(freq * 2.0, now);

    const noteGain = this.ctx.createGain();
    // 柔和起音与长尾混响衰减
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(0.06, now + 0.3);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);

    osc.connect(noteGain);
    oscHarmonic.connect(noteGain);
    noteGain.connect(this.masterGain);

    osc.start(now);
    oscHarmonic.start(now);

    osc.stop(now + 4.6);
    oscHarmonic.stop(now + 4.6);

    // 随机 3.5 ~ 7 秒后触发下一个音符
    const nextInterval = 3500 + Math.random() * 3500;
    this.timerId = setTimeout(() => this.triggerChime(), nextInterval);
  }

  public play() {
    this.initContext();
    if (!this.ctx || !this.masterGain) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.isRunning = true;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(0.35, now + 1.8);

    if (!this.timerId) {
      this.triggerChime();
    }
  }

  public pause() {
    if (!this.ctx || !this.masterGain) return;
    this.isRunning = false;
    clearTimeout(this.timerId);
    this.timerId = null;

    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(0, now + 1.0);
  }

  public setVolume(volume: number) {
    if (!this.ctx || !this.masterGain) return;
    const clamped = Math.max(0, Math.min(1, volume));
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.linearRampToValueAtTime(clamped * 0.4, now + 0.2);
  }
}

export const ambientAudio = new AmbientAudioEngine();
