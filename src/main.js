/**
 * 入口：渲染器 / 主循环 / 输入
 * ---------------------------------------------------------------
 * 主循环采用「固定步长逻辑 + 可变步长渲染」：
 *   逻辑锁定 60Hz，物理与 AI 行为不受渲染帧率影响；
 *   渲染每帧一次，并按实时帧率动态调整分辨率 —— 掉帧时自动降采样保流畅。
 */

import * as THREE from '../vendor/three.module.js';
import { MAP, MAP_W, MAP_D, PERF, FIXED_DT, MAX_SUBSTEPS, COLORS, ENEMY } from './config.js';
import { Arena } from './arena.js';
import { FogOfWar } from './fog.js';
import { Warframe } from './warframe.js';
import { EnemyManager } from './enemy.js';
import { Combat } from './combat.js';
import { HUD } from './hud.js';
import { GameAudio } from './audio.js';

/* ============================ 渲染器 ============================ */

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.fog);
// 指数雾：远处快速衰减，天然形成「只看得见一小块」的压抑感
scene.fog = new THREE.FogExp2(0x05070d, 0.052);

const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 260);

/* ============================ 灯光 ============================ */

scene.add(new THREE.AmbientLight(0x1b2637, 0.55));
const hemi = new THREE.HemisphereLight(0x2a3c5a, 0x090c12, 0.35);
scene.add(hemi);

// 玩家手持探照灯（唯一投射阴影的光源）
const torch = new THREE.SpotLight(0xd8ecff, 26, 30, 0.92, 0.45, 1.3);
torch.castShadow = true;
torch.shadow.mapSize.set(PERF.shadowMapSize, PERF.shadowMapSize);
torch.shadow.camera.near = 0.5;
torch.shadow.camera.far = 30;
torch.shadow.bias = -0.0016;
torch.shadow.normalBias = 0.03;
scene.add(torch);
const torchTarget = new THREE.Object3D();
scene.add(torchTarget);
torch.target = torchTarget;

// 机体自带的能量辉光（不投影，纯氛围）
const rim = new THREE.PointLight(0x2fd8ff, 3.2, 7.5, 2);
scene.add(rim);

/* ============================ 世界 ============================ */

const fog = new FogOfWar(scene);
const arena = new Arena(scene, fog.texture);
const player = new Warframe(scene, camera, new THREE.Vector3(0, 0, 0));
const enemies = new EnemyManager(scene, arena, fog);
enemies.populate(ENEMY.totalCount, player.pos);
const combat = new Combat(scene, arena, enemies);
const hud = new HUD(arena, fog);
const audio = new GameAudio();

combat.onPlayerHit = (killed) => {
  hud.hitmarker();
  if (killed) audio.kill(); else audio.hit();
};
combat.onPlayerDamaged = () => {
  hud.damageFlash();
  audio.hurt();
};

/* ============================ 输入 ============================ */

const input = {
  forward: false, back: false, left: false, right: false,
  sprint: false, jump: false, fire: false,
};

const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
};

let running = false;
let paused = false;
let finished = false;

const overlay = document.getElementById('overlay');
const ctaEl = document.getElementById('cta');

addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = true;
  if (e.code === 'KeyR') { player.startReload(); audio.reload(); }
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'Escape') togglePause();
  if (e.code === 'Space' && input.jump && player.onGround) audio.jump();
});

addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.sprint = false;
});

canvas.addEventListener('mousedown', (e) => {
  if (!running) return;
  if (e.button === 0) input.fire = true;
});
addEventListener('mouseup', () => { input.fire = false; });

addEventListener('mousemove', (e) => {
  if (!running || paused) return;
  const locked = document.pointerLockElement === canvas;
  if (!locked && !input.fire) return;   // 未锁定时按住左键拖动也能转向
  const sx = 0.0022;
  player.camYaw -= (e.movementX || 0) * sx;
  player.camPitch -= (e.movementY || 0) * sx * 0.8;
  player.camPitch = Math.max(-0.9, Math.min(0.62, player.camPitch));
});

canvas.addEventListener('click', () => {
  if (running && !paused && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
  }
});

overlay.addEventListener('click', () => {
  if (finished) return;
  if (!running) {
    running = true;
    paused = false;
    overlay.classList.add('hidden');
    audio.resume();
    canvas.requestPointerLock?.();
  } else if (paused) {
    togglePause();
  }
});

function togglePause() {
  if (!running || finished) return;
  paused = !paused;
  overlay.classList.toggle('hidden', !paused);
  if (paused) {
    document.exitPointerLock?.();
    ctaEl.textContent = '已暂停 · 点击继续';
    document.querySelector('#overlay h1').textContent = '暂停';
  } else {
    canvas.requestPointerLock?.();
  }
}

/* ============================ 分辨率自适应 ============================ */

let pixelScale = 1.0;
let scaleTimer = 0;
let frameAccum = 0;
let frameCount = 0;

function applyPixelScale() {
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(PERF.maxPixelRatio, Math.max(PERF.minPixelRatio, dpr * pixelScale)));
}

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  applyPixelScale();
}
addEventListener('resize', resize);
resize();

/* ============================ 主循环 ============================ */

const clock = new THREE.Clock();
let accumulator = 0;
let elapsed = 0;

const _aim = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);

  let dt = clock.getDelta();
  if (dt > 0.25) dt = 0.25;          // 切后台回来时防止大跳跃
  frameAccum += dt; frameCount++;

  if (!running || paused) {
    // 暂停时仍渲染一帧，保持画面存在
    renderer.render(scene, camera);
    return;
  }

  elapsed += dt;
  accumulator += dt;

  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    step(FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_SUBSTEPS) accumulator = 0;   // 防止追帧雪崩

  /* --- 灯光跟随 --- */
  player.aimDir(_aim);
  torch.position.set(
    player.pos.x + _aim.x * 0.35 - _aim.z * 0.28,
    player.y + 1.55,
    player.pos.z + _aim.z * 0.35 + _aim.x * 0.28
  );
  torchTarget.position.set(
    player.pos.x + _aim.x * 12,
    player.y + 1.2 + _aim.y * 4,
    player.pos.z + _aim.z * 12
  );
  rim.position.set(player.pos.x, player.y + 1.25, player.pos.z);

  /* --- 相机与动画 --- */
  player.updateCamera(dt, arena);
  player.animate(dt, elapsed);

  /* --- HUD --- */
  hud.update(dt, player, enemies, null);

  /* --- 动态分辨率：帧率低就降采样 --- */
  scaleTimer -= dt;
  if (scaleTimer <= 0) {
    scaleTimer = PERF.pixelScaleCooldown;
    const fps = frameCount / Math.max(frameAccum, 0.001);
    if (fps < PERF.targetFps && pixelScale > PERF.minPixelRatio) {
      pixelScale = Math.max(PERF.minPixelRatio, pixelScale - PERF.pixelScaleStep);
      applyPixelScale();
    } else if (fps > PERF.targetFps + 8 && pixelScale < 1) {
      pixelScale = Math.min(1, pixelScale + PERF.pixelScaleStep);
      applyPixelScale();
    }
    frameAccum = 0; frameCount = 0;
  }

  renderer.render(scene, camera);
}

function step(dt) {
  player.update(dt, input, arena, elapsed);
  fog.update(dt, player.pos);
  enemies.update(dt, elapsed, player, combat);
  combat.update(dt, player, elapsed);

  // 射击
  if (input.fire && player.canFire()) {
    combat.playerShoot(player, elapsed);
    audio.shot();
    // 后坐力：抬高相机一点点
    player.camPitch += 0.006 + Math.random() * 0.004;
  }

  // 胜负判定
  if (!finished) {
    if (!player.alive) {
      finished = true;
      audio.lose();
      endGame('任务失败', '战甲已损毁');
    } else if (enemies.remaining === 0) {
      finished = true;
      audio.win();
      endGame('区域肃清', '全部目标已清除');
    }
  }
}

function endGame(title, sub) {
  running = false;
  document.exitPointerLock?.();
  overlay.classList.remove('hidden');
  document.querySelector('#overlay h1').textContent = title;
  document.querySelector('#overlay .sub').textContent = sub;
  ctaEl.textContent = '刷新页面重新开始';
}

frame();
