/**
 * 战斗系统
 * ---------------------------------------------------------------
 * 玩家：即时命中（hitscan）+ 曳光弹 + 命中火花，手感干脆、开销极低。
 * 敌人：可视的飞行弹丸，便于闪避，也更有科幻感。
 *
 * 性能：曳光弹、火花、弹丸全部预分配对象池，战斗中不产生任何 GC 压力。
 */

import * as THREE from '../vendor/three.module.js';
import { WEAPON, ENEMY } from './config.js';
import { makeGlowSprite } from './textures.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

export class Combat {
  constructor(scene, arena, enemies) {
    this.scene = scene;
    this.arena = arena;
    this.enemies = enemies;

    this.onPlayerHit = null;   // 回调：命中敌人
    this.onPlayerDamaged = null;

    this._initTracers();
    this._initSparks();
    this._initProjectiles();
    this._initMuzzle(scene);
  }

  /* ============================ 曳光弹 ============================ */

  _initTracers() {
    const geo = new THREE.BoxGeometry(0.035, 0.035, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8ff4ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.tracers = [];
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
  }

  _spawnTracer(from, to) {
    const t = this.tracers.find(x => x.life <= 0);
    if (!t) return;
    const dist = from.distanceTo(to);
    t.mesh.position.copy(from).lerp(to, 0.5);
    t.mesh.scale.set(1, 1, dist);
    t.mesh.lookAt(to);
    t.mesh.visible = true;
    t.life = 0.075;
  }

  /* ============================ 命中火花 ============================ */

  _initSparks() {
    const tex = makeGlowSprite(64, 'rgba(255,255,255,1)', 'rgba(255,170,60,0)');
    const mat = new THREE.SpriteMaterial({
      map: tex, color: 0xffd9a0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.sparks = [];
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(mat.clone());
      s.visible = false;
      s.scale.setScalar(0.4);
      this.scene.add(s);
      this.sparks.push({ sprite: s, life: 0 });
    }
  }

  _spawnSpark(pos, scale = 0.5, color = 0xffd9a0) {
    const s = this.sparks.find(x => x.life <= 0);
    if (!s) return;
    s.sprite.position.copy(pos);
    s.sprite.material.color.setHex(color);
    s.sprite.visible = true;
    s.sprite.scale.setScalar(scale);
    s.life = 0.18;
    s.maxLife = 0.18;
  }

  /* ============================ 敌人弹丸 ============================ */

  _initProjectiles() {
    const geo = new THREE.SphereGeometry(0.12, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a4a });
    this.projectiles = [];
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      this.scene.add(m);
      this.projectiles.push({ mesh: m, life: 0, dir: new THREE.Vector3(), speed: 0 });
    }
  }

  enemyShoot(enemy, player) {
    const p = this.projectiles.find(x => x.life <= 0);
    if (!p) return;

    const ex = enemy.pos.x;
    const ey = enemy.type === 'drone' ? enemy.pos.y + 1.5 : enemy.pos.y + 1.35;
    const ez = enemy.pos.z;
    p.mesh.position.set(ex, ey, ez);
    p.dir.set(player.pos.x - ex, player.pos.y + 1.1 - ey, player.pos.z - ez).normalize();
    // 加入一点预判误差，避免百发百中
    p.dir.x += (Math.random() - 0.5) * 0.06;
    p.dir.z += (Math.random() - 0.5) * 0.06;
    p.dir.normalize();
    p.speed = ENEMY.bulletSpeed;
    p.life = 3.2;
    p.mesh.visible = true;
    this._spawnSpark(p.mesh.position, 0.32, 0xff8a5a);
  }

  /* ============================ 枪口闪光 ============================ */

  _initMuzzle(scene) {
    // 一盏短促点亮的灯，比常驻灯省得多
    this.muzzleLight = new THREE.PointLight(0x9fe8ff, 0, 9, 2);
    scene.add(this.muzzleLight);
    this.muzzleTimer = 0;

    this.muzzleSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowSprite(64, 'rgba(255,255,255,1)', 'rgba(120,230,255,0)'),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.muzzleSprite.scale.setScalar(0.6);
    this.muzzleSprite.visible = false;
    scene.add(this.muzzleSprite);
  }

  /* ============================ 玩家射击 ============================ */

  playerShoot(player, time) {
    const origin = _a;
    player.camera.getWorldPosition(origin);
    const dir = player.aimDir(_dir);

    // 散布（移动与后坐会放大）
    const speedFactor = Math.min(1, player._speed / 6);
    const spread = WEAPON.spread + WEAPON.spreadMoving * speedFactor + player.recoil * 0.02;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    // 墙距 & 敌人命中，取更近者
    const wallDist = this.arena.raycastWalls(origin, dir, WEAPON.range, 0.3);
    const hit = this.enemies.raycast(origin, dir, Math.min(wallDist, WEAPON.range));

    const endDist = hit ? hit.dist : Math.min(wallDist, WEAPON.range);
    const end = _b.copy(origin).addScaledVector(dir, endDist);

    // 曳光弹从枪口出发
    const muzzle = player.muzzleWorld(_muzzle);
    this._spawnTracer(muzzle, end);

    if (hit) {
      const killed = this.enemies.damage(hit.enemy, WEAPON.damage);
      this._spawnSpark(end, killed ? 0.75 : 0.42, killed ? 0xffe08a : 0xffb066);
      if (this.onPlayerHit) this.onPlayerHit(killed);
    } else if (wallDist <= WEAPON.range) {
      this._spawnSpark(end, 0.34, 0xa8c4ff);
    }

    // 枪口效果
    this.muzzleLight.position.copy(muzzle);
    this.muzzleLight.intensity = 7;
    this.muzzleTimer = 0.06;
    this.muzzleSprite.position.copy(muzzle);
    this.muzzleSprite.visible = true;
    this.muzzleSprite.material.opacity = 1;

    player.registerShot();
  }

  /* ============================ 每帧更新 ============================ */

  update(dt, player, time) {
    // 曳光弹淡出
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = Math.min(0.85, t.life / 0.075 * 0.85);
    }

    // 火花淡出
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.sprite.visible = false; continue; }
      const k = s.life / s.maxLife;
      s.sprite.material.opacity = k;
      s.sprite.scale.setScalar(0.4 * (0.5 + k * 0.9));
    }

    // 枪口灯
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      this.muzzleLight.intensity = Math.max(0, this.muzzleTimer / 0.06) * 7;
      if (this.muzzleTimer <= 0) {
        this.muzzleLight.intensity = 0;
        this.muzzleSprite.visible = false;
      }
    }

    // 敌人弹丸
    const px = player.pos.x, py = player.pos.y + 1.0, pz = player.pos.z;
    for (const p of this.projectiles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.mesh.position.addScaledVector(p.dir, p.speed * dt);

      // 命中玩家
      const dx = p.mesh.position.x - px;
      const dy = p.mesh.position.y - py;
      const dz = p.mesh.position.z - pz;
      if (dx * dx + dy * dy + dz * dz < 0.62) {
        player.takeDamage(ENEMY.bulletDamage, time);
        this._spawnSpark(p.mesh.position, 0.5, 0xff6a6a);
        if (this.onPlayerDamaged) this.onPlayerDamaged();
        p.life = 0; p.mesh.visible = false;
        continue;
      }

      // 撞墙 / 超时
      if (p.life <= 0 || this.arena.isSolidAt(p.mesh.position.x, p.mesh.position.z)) {
        if (p.life > 0) this._spawnSpark(p.mesh.position, 0.3, 0xff8a5a);
        p.life = 0; p.mesh.visible = false;
      }
    }
  }
}
