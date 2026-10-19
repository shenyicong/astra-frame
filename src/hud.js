/**
 * HUD
 * ---------------------------------------------------------------
 * 生命 / 护盾 / 弹药 / 击杀 / 小地图 / 帧率。
 * 小地图直接由迷雾数据生成：未探索区域一片漆黑，走过的区域点亮。
 *
 * 性能：小地图用 80×80 的 ImageData 一次性写入，再放大绘制，
 *       每 100ms 刷新一次，几乎不占主线程。
 */

import { MAP, PLAYER, WEAPON } from './config.js';

export class HUD {
  constructor(arena, fog) {
    this.arena = arena;
    this.fog = fog;

    this.el = {
      shieldFill: document.getElementById('shieldFill'),
      healthFill: document.getElementById('healthFill'),
      shieldTxt: document.getElementById('shieldTxt'),
      healthTxt: document.getElementById('healthTxt'),
      ammo: document.getElementById('ammo'),
      kills: document.getElementById('kills'),
      alive: document.getElementById('alive'),
      explored: document.getElementById('exploredVal'),
      fps: document.getElementById('fps'),
      frameMs: document.getElementById('frameMs'),
      crosshair: document.getElementById('crosshair'),
      flash: document.getElementById('damageFlash'),
      minimap: document.getElementById('minimap'),
    };

    this.mmCtx = this.el.minimap.getContext('2d');
    this.mmCtx.imageSmoothingEnabled = false;

    // 离屏小图（1 像素 = 1 格）
    this.tile = document.createElement('canvas');
    this.tile.width = MAP.cols;
    this.tile.height = MAP.rows;
    this.tileCtx = this.tile.getContext('2d');
    this.tileImg = this.tileCtx.createImageData(MAP.cols, MAP.rows);
    for (let i = 0; i < MAP.cols * MAP.rows; i++) this.tileImg.data[i * 4 + 3] = 255;

    this._mmTimer = 0;
    this._hitTimer = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._lastAmmo = -1;
    this._lastShield = -1;
    this._lastHealth = -1;
  }

  /* ============================ 主更新 ============================ */

  update(dt, player, enemies, fpsInfo) {
    // 数值条（只在变化时写 DOM，减少重排）
    const sh = Math.round(player.shield);
    const hp = Math.round(player.health);
    if (sh !== this._lastShield) {
      this._lastShield = sh;
      this.el.shieldFill.style.width = (sh / PLAYER.maxShield * 100).toFixed(1) + '%';
      this.el.shieldTxt.textContent = sh;
    }
    if (hp !== this._lastHealth) {
      this._lastHealth = hp;
      this.el.healthFill.style.width = (hp / PLAYER.maxHealth * 100).toFixed(1) + '%';
      this.el.healthTxt.textContent = hp;
    }
    if (player.ammo !== this._lastAmmo) {
      this._lastAmmo = player.ammo;
      this.el.ammo.innerHTML = player.reloading
        ? '<span>换弹…</span>'
        : player.ammo + '<span> / ' + WEAPON.magSize + '</span>';
      this.el.ammo.classList.toggle('low', player.ammo <= 6 && !player.reloading);
    }

    this.el.kills.textContent = enemies.kills;
    this.el.alive.textContent = enemies.remaining;

    // 帧率显示
    this._fpsAcc += dt; this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      const fps = this._fpsFrames / this._fpsAcc;
      this.el.fps.textContent = Math.round(fps);
      this.el.frameMs.textContent = (1000 / fps).toFixed(1);
      this._fpsAcc = 0; this._fpsFrames = 0;
    }

    // 命中标记
    if (this._hitTimer > 0) {
      this._hitTimer -= dt;
      if (this._hitTimer <= 0) this.el.crosshair.classList.remove('hit');
    }

    // 小地图节流刷新
    this._mmTimer -= dt;
    if (this._mmTimer <= 0) {
      this._mmTimer = 0.1;
      this._drawMinimap(player, enemies);
      this.el.explored.textContent = (this.fog.exploredRatio * 100).toFixed(1) + '%';
    }
  }

  /* ============================ 小地图 ============================ */

  _drawMinimap(player, enemies) {
    const d = this.tileImg.data;
    const cols = MAP.cols, rows = MAP.rows;
    const solid = this.arena.solid;
    const fogData = this.fog.data;

    for (let i = 0; i < cols * rows; i++) {
      const f = fogData[i];
      const isWall = solid[i] === 1;
      let r, g, b;
      if (isWall) {
        // 墙体：探索过的偏蓝灰，未探索为近黑
        const k = 0.10 + f * 0.42;
        r = 26 * k * 2.2; g = 38 * k * 2.2; b = 56 * k * 2.2;
      } else {
        // 地面：随探索度变亮
        const k = 0.06 + f * 0.78;
        r = 18 * k * 3.2; g = 150 * k * 1.1; b = 190 * k * 1.05;
      }
      d[i * 4] = Math.min(255, r);
      d[i * 4 + 1] = Math.min(255, g);
      d[i * 4 + 2] = Math.min(255, b);
    }
    this.tileCtx.putImageData(this.tileImg, 0, 0);

    const ctx = this.mmCtx;
    const W = this.el.minimap.width;
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(this.tile, 0, 0, W, W);

    // 世界坐标 → 小地图像素
    const toPx = (x, z) => {
      const i = (x + MAP.cols * MAP.tile / 2) / MAP.tile;
      const j = (z + MAP.rows * MAP.tile / 2) / MAP.tile;
      return [(i / cols) * W, (j / rows) * W];
    };

    // 敌人红点（仅在已探索区域显示）
    ctx.fillStyle = '#ff4d5e';
    for (const e of enemies.list) {
      if (!e.alive || e.dying > 0) continue;
      if (this.fog.visibilityAt(e.pos.x, e.pos.z) < 0.12) continue;
      const [px, py] = toPx(e.pos.x, e.pos.z);
      ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.fill();
    }

    // 玩家箭头
    const [px, py] = toPx(player.pos.x, player.pos.z);
    ctx.save();
    ctx.translate(px, py);
    // 箭头默认朝画布上方（0,-1）；世界前方 (-sin yaw, -cos yaw) 映射到画布
    // 后为 (-sin yaw, -cos yaw)，绕原点旋转 θ 得 (sinθ, -cosθ)，故 θ = -yaw
    ctx.rotate(-player.camYaw);
    ctx.fillStyle = '#39f6ff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ============================ 反馈 ============================ */

  hitmarker() {
    this.el.crosshair.classList.add('hit');
    this._hitTimer = 0.13;
  }

  damageFlash() {
    this.el.flash.style.opacity = '0.85';
    setTimeout(() => { this.el.flash.style.opacity = '0'; }, 90);
  }
}
