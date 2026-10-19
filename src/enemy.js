/**
 * 敌方单位
 * ---------------------------------------------------------------
 * 两种敌人：地面巡逻兵 / 悬浮无人机。
 * 行为：巡逻 → 发现玩家 → 追击并保持距离 → 开火。
 *
 * 性能相关：
 *   · 全部实例一次性创建，靠视锥剔除自动跳过不可见单位；
 *   · 处于未探索迷雾中的敌人直接 visible=false，不参与渲染；
 *   · 命中判定用「射线 vs 球」，比逐三角面快几个数量级。
 */

import * as THREE from '../vendor/three.module.js';
import { ENEMY, MAP } from './config.js';

const _t = new THREE.Vector3();

export class EnemyManager {
  constructor(scene, arena, fog) {
    this.scene = scene;
    this.arena = arena;
    this.fog = fog;
    this.list = [];
    this.kills = 0;
    this.hpMul = 1;      // 关卡血量倍率
    this.speedMul = 1;   // 关卡移速倍率

    // 共享材质，减少 GPU 状态切换
    this.mats = {
      body: new THREE.MeshStandardMaterial({ color: 0x3d2b2b, metalness: 0.7, roughness: 0.55 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x231a1a, metalness: 0.55, roughness: 0.65 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x6b5236, metalness: 0.9, roughness: 0.3 }),
      eye: new THREE.MeshBasicMaterial({ color: 0xff3b3b }),
      eyeDim: new THREE.MeshBasicMaterial({ color: 0x5a1414 }),
    };

    this.rand = this._seededRandom(777);
  }

  /** 初始化敌人：分散在远离玩家出生点的位置 */
  populate(total, playerPos) {
    let guard = 0;
    while (this.list.length < total && guard++ < total * 40) {
      const p = this.arena.randomOpenPoint(this.rand);
      if (p.distanceTo(playerPos) < 18) continue;
      if (this.arena.isSolidAt(p.x, p.z)) continue;
      const type = this.rand() < 0.62 ? 'walker' : 'drone';
      const e = this._create(type, p);
      this.list.push(e);
    }
  }

  _create(type, pos) {
    const g = new THREE.Group();
    g.position.copy(pos);
    const eyeMat = this.mats.eye;

    if (type === 'walker') {
      const add = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        g.add(m);
        return m;
      };
      add(new THREE.BoxGeometry(0.5, 0.52, 0.3), this.mats.body, 0, 1.18, 0);
      add(new THREE.BoxGeometry(0.4, 0.2, 0.26), this.mats.dark, 0, 0.92, 0);
      add(new THREE.SphereGeometry(0.14, 12, 10), this.mats.dark, 0, 1.56, 0);
      const visor = add(new THREE.BoxGeometry(0.16, 0.05, 0.03), eyeMat, 0, 1.58, 0.12);
      this._attachEye(visor);
      // 肩
      add(new THREE.SphereGeometry(0.13, 10, 8), this.mats.body, -0.32, 1.36, 0);
      add(new THREE.SphereGeometry(0.13, 10, 8), this.mats.body, 0.32, 1.36, 0);
      // 手臂 + 武器
      const armR = new THREE.Group(); armR.position.set(0.32, 1.34, 0);
      g.add(armR);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.24, 4, 8), this.mats.dark);
      fore.position.set(0, -0.22, 0.06); fore.castShadow = true; armR.add(fore);
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.42), this.mats.trim);
      gun.position.set(0, -0.3, 0.3); gun.castShadow = true; armR.add(gun);
      // 腿
      const legL = new THREE.Group(); legL.position.set(-0.15, 0.88, 0); g.add(legL);
      const legR = new THREE.Group(); legR.position.set(0.15, 0.88, 0); g.add(legR);
      [legL, legR].forEach(l => {
        const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.3, 4, 8), this.mats.dark);
        th.position.y = -0.2; th.castShadow = true; l.add(th);
        const sh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.28, 4, 8), this.mats.body);
        sh.position.y = -0.54; sh.castShadow = true; l.add(sh);
      });
      this.scene.add(g);
      return {
        type, group: g, pos: g.position, hp: ENEMY.health * this.hpMul, alive: true,
        state: 'patrol', fireTimer: this.rand() * 1.5, legs: [legL, legR], arm: armR,
        phase: this.rand() * 6.28, target: null, dying: 0, hitFlash: 0,
      };
    }

    // 无人机
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 14), this.mats.body);
    body.position.y = 1.5; body.castShadow = true; g.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.045, 8, 24), this.mats.trim);
    ring.position.y = 1.5; ring.rotation.x = Math.PI / 2; g.add(ring);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), eyeMat);
    eye.position.set(0, 1.5, 0.3); g.add(eye);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.04), this.mats.trim);
    core.position.set(0, 1.28, 0.22); g.add(core);

    this.scene.add(g);
    return {
      type, group: g, pos: g.position, hp: ENEMY.health * 0.8 * this.hpMul, alive: true,
      state: 'patrol', fireTimer: this.rand() * 1.5, ring, eye,
      phase: this.rand() * 6.28, target: null, dying: 0, hitFlash: 0,
    };
  }

  _attachEye(mesh) { mesh.material = this.mats.eye; }

  /* ============================ 更新 ============================ */

  update(dt, time, player, combat) {
    let aliveCount = 0;
    const pp = player.pos;

    for (const e of this.list) {
      if (!e.alive) continue;
      aliveCount++;

      // 死亡动画：倾倒 + 下沉，2 秒后移除
      if (e.dying > 0) {
        e.dying += dt;
        e.group.rotation.z = Math.min(Math.PI / 2, e.dying * 3.2);
        e.group.position.y = Math.max(-1.2, -e.dying * 0.9);
        if (e.dying > 2.0) {
          e.alive = false;
          e.group.visible = false;
        }
        continue;
      }

      const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z;
      const dist = Math.hypot(dx, dz);

      // ---- 感知 ----
      const canSee = dist < ENEMY.sightRange &&
        this.arena.raycastWalls(
          { x: e.pos.x, z: e.pos.z },
          { x: dx / (dist || 1), z: dz / (dist || 1) },
          dist, 0.5
        ) >= dist - 0.5;

      if (canSee) e.state = dist > 6.5 ? 'chase' : 'attack';
      else if (e.state !== 'patrol') e.state = 'patrol';

      // ---- 行为 ----
      let wishX = 0, wishZ = 0, speed = 0;
      if (e.state === 'patrol') {
        if (!e.target || Math.hypot(e.target.x - e.pos.x, e.target.z - e.pos.z) < 1.2) {
          e.target = this._pickWaypoint(e);
        }
        if (e.target) {
          const tx = e.target.x - e.pos.x, tz = e.target.z - e.pos.z;
          const tl = Math.hypot(tx, tz) || 1;
          wishX = tx / tl; wishZ = tz / tl; speed = ENEMY.speed * this.speedMul;
        }
      } else if (e.state === 'chase') {
        wishX = dx / (dist || 1); wishZ = dz / (dist || 1);
        speed = ENEMY.chaseSpeed * this.speedMul;
      } else { // attack：保持中距离并侧移
        const sign = e.phase > 3.14 ? 1 : -1;
        wishX = (dx / (dist || 1)) * 0.35 + (-dz / (dist || 1)) * sign * 0.8;
        wishZ = (dz / (dist || 1)) * 0.35 + (dx / (dist || 1)) * sign * 0.8;
        const l = Math.hypot(wishX, wishZ) || 1;
        wishX /= l; wishZ /= l;
        speed = dist < 5 ? -ENEMY.speed : ENEMY.speed * 0.7;

        // 开火
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && dist < ENEMY.attackRange && player.alive) {
          e.fireTimer = ENEMY.fireInterval + this.rand() * 0.6;
          combat.enemyShoot(e, player);
        }
      }

      // ---- 位移 ----
      const vx = wishX * speed, vz = wishZ * speed;
      e.pos.x += vx * dt;
      e.pos.z += vz * dt;
      this.arena.resolveCircle(e.pos, ENEMY.radius);

      // ---- 朝向玩家 ----
      if (e.state !== 'patrol' && dist > 0.1) {
        const want = Math.atan2(dx, dz);
        e.group.rotation.y = want;
      } else if (speed > 0.1) {
        e.group.rotation.y = Math.atan2(wishX, wishZ);
      }

      // ---- 动画 ----
      e.phase += dt * (speed * 1.6 + 0.6);
      if (e.type === 'walker' && e.legs) {
        const sw = Math.sin(e.phase) * (speed > 0.2 ? 0.5 : 0.08);
        e.legs[0].rotation.x = sw;
        e.legs[1].rotation.x = -sw;
        if (e.arm) e.arm.rotation.x = -1.1;
      }
      if (e.type === 'drone') {
        const hover = 0.06;
        e.group.position.y = Math.sin(time * 1.8 + e.phase) * hover;
        if (e.ring) e.ring.rotation.z += dt * 2.2;
        // 攻击时眼睛闪烁
        if (e.eye) {
          const glow = e.state === 'attack' ? (Math.sin(time * 12) * 0.5 + 0.5) : 0.35;
          e.eye.scale.setScalar(0.8 + glow * 0.5);
        }
      }

      // 受击闪白
      if (e.hitFlash > 0) {
        e.hitFlash -= dt * 4;
        const s = 1 + Math.max(0, e.hitFlash) * 0.12;
        e.group.scale.setScalar(s);
      }

      // ---- 迷雾遮挡：未探索区域里的敌人不显示 ----
      e.group.visible = this.fog.visibilityAt(e.pos.x, e.pos.z) > 0.12;
    }

    this.aliveCount = aliveCount;
  }

  _pickWaypoint(e) {
    for (let k = 0; k < 8; k++) {
      const p = this.arena.randomOpenPoint(this.rand);
      const d = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
      if (d > 4 && d < 26 && !this.arena.isSolidAt(p.x, p.z)) return p;
    }
    return null;
  }

  /* ============================ 命中 ============================ */

  /**
   * 射线 vs 敌人球体，返回最近命中
   * @returns {{enemy, dist}|null}
   */
  raycast(origin, dir, maxDist) {
    let best = null, bestD = maxDist;
    for (const e of this.list) {
      if (!e.alive || e.dying > 0) continue;
      if (!e.group.visible) continue; // 迷雾中的敌人不可被击中

      const cy = e.type === 'drone' ? e.pos.y + 1.5 : e.pos.y + 1.15;
      _t.set(e.pos.x - origin.x, cy - origin.y, e.pos.z - origin.z);
      const proj = _t.dot(dir);
      if (proj < 0 || proj > bestD) continue;
      const d2 = _t.lengthSq() - proj * proj;
      const r = 0.62;
      if (d2 > r * r) continue;
      const t = proj - Math.sqrt(r * r - d2);
      if (t > 0 && t < bestD) { bestD = t; best = e; }
    }
    return best ? { enemy: best, dist: bestD } : null;
  }

  damage(e, amount) {
    if (e.dying > 0) return false;
    e.hp -= amount;
    e.hitFlash = 1;
    if (e.hp <= 0) {
      e.dying = 0.001;
      // 死亡时朝向随机倾倒
      e.group.rotation.z = 0;
      this.kills++;
      return true;
    }
    return false;
  }

  /** 清空当前关卡的全部敌人（换关时调用），并释放几何体 */
  clearAll() {
    for (const e of this.list) {
      this.scene.remove(e.group);
      e.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    }
    this.list.length = 0;
  }

  get remaining() {
    let n = 0;
    for (const e of this.list) if (e.alive && e.dying === 0) n++;
    return n;
  }

  _seededRandom(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17; s >>>= 0;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
}
