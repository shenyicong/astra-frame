/**
 * 程序化贴图生成
 * ---------------------------------------------------------------
 * 项目不含任何外部图片资源：金属地板、墙面、顶棚、发光精灵全部在运行时
 * 用 Canvas 2D 现场绘制，再由高度图推导法线贴图，获得真实的光照起伏。
 *
 * 好处：
 *   1. 仓库体积为零资源依赖，clone 下来即可运行；
 *   2. 不受素材版权限制，可自由修改；
 *   3. 贴图分辨率可调，低端设备可降配。
 */

import * as THREE from '../vendor/three.module.js';

/* ============================ 基础工具 ============================ */

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** 固定种子伪随机，保证每次运行纹理一致 */
function makeRandom(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17; s >>>= 0;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

/** 分形噪声：反复「缩小再放大」叠加，得到自然的斑驳质感（比逐像素噪声快很多） */
function fractalNoise(ctx, size, layers = 5, seed = 7) {
  const rand = makeRandom(seed);
  const base = makeCanvas(size);
  const bctx = base.getContext('2d');
  const img = bctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 120 + (rand() - 0.5) * 160;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);

  let cur = base;
  for (let l = 1; l < layers; l++) {
    const s = Math.max(2, size >> l);
    const small = makeCanvas(size);
    small.getContext('2d').drawImage(cur, 0, 0, s, s);
    const back = makeCanvas(size);
    const b2 = back.getContext('2d');
    b2.imageSmoothingEnabled = true;
    b2.drawImage(small, 0, 0, size, size);
    ctx.globalAlpha = 0.45 / l;
    ctx.drawImage(back, 0, 0);
    ctx.globalAlpha = 1;
    cur = back;
  }
  return cur;
}

/** 灰度高度图 → 法线贴图（Sobel 算子，边界环绕保证可无缝平铺） */
function heightToNormal(src, strength = 2.0) {
  const size = src.width;
  const data = src.getContext('2d').getImageData(0, 0, size, size).data;
  const out = makeCanvas(size);
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => data[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      let nx = -((tr + 2 * r + br) - (tl + 2 * l + bl)) * strength;
      let ny = -((bl + 2 * b + br) - (tl + 2 * t + tr)) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function toTexture(cv, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ============================ 地板 ============================ */

/** 工业金属地板：面板 + 接缝 + 铆钉 + 划痕 + 油污 */
export function makeFloorTextures(size = 512) {
  const cv = makeCanvas(size);
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#252c39';
  ctx.fillRect(0, 0, size, size);

  // 斑驳底噪
  const noise = makeCanvas(size);
  const nctx = noise.getContext('2d');
  nctx.fillStyle = '#20262f';
  nctx.fillRect(0, 0, size, size);
  fractalNoise(nctx, size, 5, 31);
  ctx.globalAlpha = 0.55;
  ctx.drawImage(noise, 0, 0);
  ctx.globalAlpha = 1;

  // 主分割线
  const cell = size / 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.62)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size);
    ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell);
    ctx.stroke();
  }

  // 细格线
  ctx.strokeStyle = 'rgba(0,0,0,0.26)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const p = (i * size) / 8;
    ctx.beginPath();
    ctx.moveTo(p, 0); ctx.lineTo(p, size);
    ctx.moveTo(0, p); ctx.lineTo(size, p);
    ctx.stroke();
  }

  // 铆钉
  ctx.fillStyle = 'rgba(158,178,200,0.30)';
  for (let gx = 0; gx < 2; gx++) {
    for (let gy = 0; gy < 2; gy++) {
      const ox = gx * cell + 10, oy = gy * cell + 10;
      for (let i = 0; i < 4; i++) {
        const x = ox + (i % 2) * (cell - 20);
        const y = oy + Math.floor(i / 2) * (cell - 20);
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // 划痕
  const rand = makeRandom(99);
  ctx.strokeStyle = 'rgba(195,210,230,0.05)';
  for (let i = 0; i < 90; i++) {
    const x = rand() * size, y = rand() * size;
    const len = 8 + rand() * 54, ang = rand() * Math.PI * 2;
    ctx.lineWidth = rand() * 1.2 + 0.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  // 油污
  for (let i = 0; i < 14; i++) {
    const x = rand() * size, y = rand() * size, r = 12 + rand() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(6,9,14,0.32)');
    g.addColorStop(1, 'rgba(6,9,14,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // 高度图（用于推导法线）：把绘制结果转灰度
  const h = makeCanvas(size);
  const hctx = h.getContext('2d');
  hctx.drawImage(cv, 0, 0);
  const hd = hctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const v = hd.data[i * 4] * 0.5 + hd.data[i * 4 + 1] * 0.4 + hd.data[i * 4 + 2] * 0.1;
    hd.data[i * 4] = hd.data[i * 4 + 1] = hd.data[i * 4 + 2] = v;
  }
  hctx.putImageData(hd, 0, 0);

  return {
    map: toTexture(cv, 1),
    normalMap: toTexture(heightToNormal(h, 1.6), 1, false),
    roughnessMap: toTexture(h, 1, false),
  };
}

/* ============================ 墙面 ============================ */

/** 竖向装甲板墙面：带凹槽与螺栓 */
export function makeWallTextures(size = 512) {
  const cv = makeCanvas(size);
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#1d2430';
  ctx.fillRect(0, 0, size, size);

  const noise = makeCanvas(size);
  const nctx = noise.getContext('2d');
  nctx.fillStyle = '#1c222c';
  nctx.fillRect(0, 0, size, size);
  fractalNoise(nctx, size, 4, 17);
  ctx.globalAlpha = 0.5;
  ctx.drawImage(noise, 0, 0);
  ctx.globalAlpha = 1;

  // 竖向装甲板
  const cols = 8;
  const w = size / cols;
  for (let i = 0; i < cols; i++) {
    const x = i * w;
    ctx.fillStyle = i % 2 ? '#222a37' : '#1e2530';
    ctx.fillRect(x + 2, 0, w - 4, size);
    // 高光边
    ctx.fillStyle = 'rgba(150,175,205,0.07)';
    ctx.fillRect(x + 2, 0, 1.5, size);
    // 阴影边
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + w - 4, 0, 2, size);
  }

  // 横向分段
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const y = (i * size) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }

  // 螺栓
  ctx.fillStyle = 'rgba(140,162,190,0.22)';
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < 4; cy++) {
      const x = cx * w + w / 2;
      const y = cy * (size / 4) + size / 16;
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  const h = makeCanvas(size);
  const hctx = h.getContext('2d');
  hctx.drawImage(cv, 0, 0);
  const hd = hctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const v = hd.data[i * 4] * 0.5 + hd.data[i * 4 + 1] * 0.4 + hd.data[i * 4 + 2] * 0.1;
    hd.data[i * 4] = hd.data[i * 4 + 1] = hd.data[i * 4 + 2] = v;
  }
  hctx.putImageData(hd, 0, 0);

  return {
    map: toTexture(cv, 1),
    normalMap: toTexture(heightToNormal(h, 2.2), 1, false),
  };
}

/* ============================ 顶棚 ============================ */

export function makeCeilingTexture(size = 256) {
  const cv = makeCanvas(size);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#141a24';
  ctx.fillRect(0, 0, size, size);

  const n = makeCanvas(size);
  fractalNoise(n.getContext('2d'), size, 3, 5);
  ctx.globalAlpha = 0.35;
  ctx.drawImage(n, 0, 0);
  ctx.globalAlpha = 1;

  // 结构梁
  ctx.fillStyle = '#0e131b';
  for (let i = 0; i < 4; i++) ctx.fillRect(0, (i * size) / 4, size, 6);

  return toTexture(cv, 1);
}

/* ============================ 发光精灵 ============================ */

/** 径向渐变光斑：用于枪口火焰、能量核心、命中火花（加法混合） */
export function makeGlowSprite(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(0,240,255,0)') {
  const cv = makeCanvas(size);
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
