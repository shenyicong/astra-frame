/**
 * 程序化音效
 * ---------------------------------------------------------------
 * 全部用 WebAudio 现场合成，不加载任何音频文件。
 * 开枪 = 噪声脉冲 + 低频冲击；命中 = 短促方波；受伤 = 下滑正弦。
 */

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._noise = null;
  }

  _ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // 预生成 1 秒白噪声，循环复用
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return true;
  }

  resume() {
    if (this._ensure() && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  /** 噪声脉冲：用于枪声、爆炸、脚步 */
  _burst(duration, freq, gain, type = 'lowpass') {
    if (!this._ensure() || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + duration + 0.02);
  }

  /** 单音：用于命中提示、UI */
  _tone(freq, duration, gain, type = 'square', slideTo = null) {
    if (!this._ensure() || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  shot() {
    this._burst(0.09, 2600, 0.32);
    this._tone(180, 0.07, 0.14, 'sawtooth', 60);
  }

  enemyShot() {
    this._burst(0.06, 1400, 0.12);
  }

  hit() { this._tone(1180, 0.05, 0.16, 'square'); }
  kill() {
    this._tone(520, 0.09, 0.18, 'square', 880);
    setTimeout(() => this._tone(880, 0.12, 0.14, 'square', 1200), 70);
  }
  hurt() { this._tone(320, 0.22, 0.22, 'sawtooth', 90); }
  reload() {
    this._tone(240, 0.05, 0.12, 'square');
    setTimeout(() => this._tone(420, 0.06, 0.12, 'square'), 120);
  }
  jump() { this._tone(420, 0.08, 0.08, 'sine', 620); }
  win() {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this._tone(f, 0.28, 0.16, 'triangle'), i * 130));
  }
  lose() {
    [392, 330, 262, 196].forEach((f, i) =>
      setTimeout(() => this._tone(f, 0.35, 0.16, 'triangle'), i * 170));
  }
}
