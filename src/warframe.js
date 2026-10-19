/**
 * 战甲机体（Warframe）
 * ---------------------------------------------------------------
 * 完全由基础几何体程序化拼装的第三人称机体：
 *   · 躯干 / 肩甲 / 头盔 / 背包 / 步枪，带自发光能量线路
 *   · 行走、跳跃、开火的程序化动画（无骨骼资源，零外部模型文件）
 *   · 第三人称跟随相机：带墙体避让，避免穿墙
 */

import * as THREE from '../vendor/three.module.js';
import { PLAYER, WEAPON, CAMERA, MAP } from './config.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir3 = new THREE.Vector3();
const _look = new THREE.Vector3();

export class Warframe {
  constructor(scene, camera, spawn) {
    this.scene = scene;
    this.camera = camera;

    /* ---- 状态 ---- */
    this.pos = spawn.clone();
    this.vel = new THREE.Vector3();
    this.y = 0;
    this.vy = 0;
    this.onGround = true;

    this.camYaw = 0;
    this.camPitch = -0.12;
    this.bodyYaw = 0;

    this.health = PLAYER.maxHealth;
    this.shield = PLAYER.maxShield;
    this.lastHitTime = -99;
    this.alive = true;

    this.ammo = WEAPON.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireTimer = 0;
    this.recoil = 0;

    this._walkPhase = 0;
    this._speed = 0;
    this._recoilKick = 0;

    this.group = new THREE.Group();
    this._build();
    scene.add(this.group);
  }

  /* ============================ 建模 ============================ */

  _build() {
    const armor = new THREE.MeshStandardMaterial({
      color: 0x2b3444, metalness: 0.88, roughness: 0.34,
    });
    const armorDark = new THREE.MeshStandardMaterial({
      color: 0x171d27, metalness: 0.7, roughness: 0.5,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x8d6b3f, metalness: 0.95, roughness: 0.28,
    });
    const energy = new THREE.MeshBasicMaterial({ color: 0x36e8ff });
    const energyWarm = new THREE.MeshBasicMaterial({ color: 0xffb257 });
    this._mats = { armor, armorDark, accent, energy, energyWarm };

    const add = (geo, mat, x, y, z, parent = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // 髋部
    add(new THREE.BoxGeometry(0.46, 0.22, 0.3), armorDark, 0, 0.92, 0);

    // 躯干（略带梯形感：用两个盒子叠出胸甲）
    add(new THREE.BoxGeometry(0.62, 0.5, 0.34), armor, 0, 1.22, 0);
    add(new THREE.BoxGeometry(0.5, 0.26, 0.3), armorDark, 0, 1.02, -0.02);
    // 胸口能量核心
    const core = add(new THREE.SphereGeometry(0.075, 14, 10), energy, 0, 1.26, -0.19);
    this.core = core;

    // 肩甲
    add(new THREE.SphereGeometry(0.17, 14, 12), armor, -0.38, 1.42, 0);
    add(new THREE.SphereGeometry(0.17, 14, 12), armor, 0.38, 1.42, 0);
    // 肩部能量条
    add(new THREE.BoxGeometry(0.16, 0.03, 0.04), energy, -0.38, 1.5, -0.12);
    add(new THREE.BoxGeometry(0.16, 0.03, 0.04), energy, 0.38, 1.5, -0.12);

    // 背包
    add(new THREE.BoxGeometry(0.42, 0.38, 0.16), armorDark, 0, 1.24, 0.24);
    add(new THREE.BoxGeometry(0.3, 0.035, 0.02), energyWarm, 0, 1.34, 0.33);
    add(new THREE.BoxGeometry(0.3, 0.035, 0.02), energyWarm, 0, 1.14, 0.33);

    // 头 + 面罩
    add(new THREE.SphereGeometry(0.155, 16, 14), armor, 0, 1.63, 0);
    add(new THREE.BoxGeometry(0.19, 0.07, 0.03), energy, 0, 1.65, -0.13);
    // 头冠
    add(new THREE.BoxGeometry(0.06, 0.12, 0.06), accent, 0, 1.75, 0.05);

    /* ---- 手臂（右手持枪） ---- */
    this.armL = new THREE.Group();
    this.armL.position.set(-0.4, 1.4, 0);
    this.group.add(this.armL);
    const upperL = add(new THREE.CapsuleGeometry(0.075, 0.26, 4, 8), armor, 0, -0.15, 0, this.armL);
    this.forearmL = add(new THREE.CapsuleGeometry(0.068, 0.24, 4, 8), armorDark, 0, -0.42, -0.02, this.armL);

    this.armR = new THREE.Group();
    this.armR.position.set(0.4, 1.4, 0);
    this.group.add(this.armR);
    add(new THREE.CapsuleGeometry(0.075, 0.26, 4, 8), armor, 0, -0.15, 0, this.armR);
    this.forearmR = add(new THREE.CapsuleGeometry(0.068, 0.24, 4, 8), armorDark, 0, -0.42, -0.02, this.armR);

    /* ---- 步枪 ---- */
    this.weapon = new THREE.Group();
    this.weapon.position.set(0, -0.6, -0.1);
    this.armR.add(this.weapon);
    add(new THREE.BoxGeometry(0.09, 0.11, 0.52), armorDark, 0, 0, -0.22, this.weapon);
    add(new THREE.BoxGeometry(0.06, 0.06, 0.3), armor, 0, 0.02, -0.52, this.weapon);
    add(new THREE.BoxGeometry(0.05, 0.14, 0.1), armorDark, 0, -0.11, -0.05, this.weapon);
    // 枪身能量线
    add(new THREE.BoxGeometry(0.012, 0.02, 0.36), energy, 0.048, 0.03, -0.24, this.weapon);
    add(new THREE.BoxGeometry(0.012, 0.02, 0.36), energy, -0.048, 0.03, -0.24, this.weapon);
    // 枪口发光点
    this.muzzleRef = new THREE.Object3D();
    this.muzzleRef.position.set(0, 0.02, -0.68);
    this.weapon.add(this.muzzleRef);

    /* ---- 双腿 ---- */
    this.legL = new THREE.Group(); this.legL.position.set(-0.17, 0.9, 0);
    this.legR = new THREE.Group(); this.legR.position.set(0.17, 0.9, 0);
    this.group.add(this.legL, this.legR);
    add(new THREE.CapsuleGeometry(0.095, 0.32, 4, 8), armor, 0, -0.2, 0, this.legL);
    add(new THREE.CapsuleGeometry(0.095, 0.32, 4, 8), armor, 0, -0.2, 0, this.legR);
    add(new THREE.CapsuleGeometry(0.08, 0.3, 4, 8), armorDark, 0, -0.56, 0, this.legL);
    add(new THREE.CapsuleGeometry(0.08, 0.3, 4, 8), armorDark, 0, -0.56, 0, this.legR);
    add(new THREE.BoxGeometry(0.15, 0.08, 0.26), accent, 0, -0.78, -0.04, this.legL);
    add(new THREE.BoxGeometry(0.15, 0.08, 0.26), accent, 0, -0.78, -0.04, this.legR);

    this.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }

  /* ============================ 关卡重置 ============================ */

  /**
   * 进入新关卡：回到出生点、补满状态，保留当前灵敏度与视角设置。
   * @param {THREE.Vector3} spawn 出生点
   */
  respawn(spawn) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.y = 0;
    this.vy = 0;
    this.onGround = true;
    this.camYaw = 0;
    this.camPitch = -0.12;
    this.bodyYaw = 0;

    this.health = PLAYER.maxHealth;
    this.shield = PLAYER.maxShield;
    this.alive = true;
    this.lastHitTime = -99;

    this.ammo = WEAPON.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireTimer = 0;
    this.recoil = 0;

    this.group.position.set(spawn.x, 0, spawn.z);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
  }

  /* ============================ 移动 ============================ */

  update(dt, input, arena, time) {
    if (!this.alive) return;

    /* --- 输入方向（相对相机） --- */
    let ix = 0, iz = 0;
    if (input.forward) iz -= 1;
    if (input.back) iz += 1;
    if (input.left) ix -= 1;
    if (input.right) ix += 1;

    const len = Math.hypot(ix, iz);
    let wishX = 0, wishZ = 0;
    if (len > 0) {
      ix /= len; iz /= len;
      const c = Math.cos(this.camYaw), s = Math.sin(this.camYaw);
      // 相机坐标系 → 世界坐标系
      wishX = ix * c + iz * s;
      wishZ = -ix * s + iz * c;
    }

    const sprinting = input.sprint && iz < 0;
    const maxSpeed = sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    /* --- 水平加速 / 阻尼 --- */
    const targetX = wishX * maxSpeed;
    const targetZ = wishZ * maxSpeed;
    const accel = PLAYER.accel * dt;
    this.vel.x += (targetX - this.vel.x) * Math.min(1, accel / Math.max(1, maxSpeed));
    this.vel.z += (targetZ - this.vel.z) * Math.min(1, accel / Math.max(1, maxSpeed));
    if (len === 0) {
      const damp = Math.max(0, 1 - PLAYER.friction * dt);
      this.vel.x *= damp;
      this.vel.z *= damp;
    }

    /* --- 跳跃与重力 --- */
    if (input.jump && this.onGround) {
      this.vy = PLAYER.jumpSpeed;
      this.onGround = false;
    }
    const prevY = this.y;
    this.vy -= PLAYER.gravity * dt;
    this.y += this.vy * dt;

    /* --- 水平位移 + 碰撞（脚底高于箱顶时箱子不挡路，可直接越过） --- */
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    arena.resolveCircle(this.pos, PLAYER.radius, this.y);

    /* --- 地面 / 箱顶支撑 --- */
    let groundY = 0;
    const standY = arena.crateTopAt(this.pos.x, this.pos.z, PLAYER.radius);
    // 只有「下落中且上一帧还在箱顶之上」才站上箱子，避免从侧面穿上去
    if (standY > 0 && this.vy <= 0 && prevY >= standY - 0.12) groundY = standY;

    if (this.y <= groundY) {
      this.y = groundY;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    /* --- 朝向：机体平滑转向相机朝向 --- */
    this.bodyYaw = this._lerpAngle(this.bodyYaw, this.camYaw, 1 - Math.pow(0.0008, dt));

    /* --- 护盾回复 --- */
    if (time - this.lastHitTime > PLAYER.shieldDelay && this.shield < PLAYER.maxShield) {
      this.shield = Math.min(PLAYER.maxShield, this.shield + PLAYER.shieldRegen * dt);
    }

    /* --- 换弹与射击计时 --- */
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.ammo = WEAPON.magSize;
      }
    }
    this.fireTimer -= dt;
    this.recoil *= Math.max(0, 1 - 8 * dt);

    this._speed = Math.hypot(this.vel.x, this.vel.z);
    this._walkPhase += this._speed * dt * 2.4;
  }

  /* ============================ 射击 ============================ */

  canFire() { return this.alive && !this.reloading && this.ammo > 0 && this.fireTimer <= 0; }

  registerShot() {
    this.ammo--;
    this.fireTimer = 1 / WEAPON.fireRate;
    this.recoil = Math.min(1, this.recoil + 0.4);
    this._recoilKick = 0.06;
    if (this.ammo <= 0) this.startReload();
  }

  startReload() {
    if (this.reloading || this.ammo === WEAPON.magSize) return;
    this.reloading = true;
    this.reloadTimer = WEAPON.reloadTime;
  }

  takeDamage(amount, time) {
    this.lastHitTime = time;
    let rest = amount;
    if (this.shield > 0) {
      const absorb = Math.min(this.shield, rest);
      this.shield -= absorb;
      rest -= absorb;
    }
    if (rest > 0) {
      this.health -= rest;
      if (this.health <= 0) { this.health = 0; this.alive = false; }
    }
  }

  /** 枪口世界坐标 */
  muzzleWorld(out) {
    this.muzzleRef.getWorldPosition(out);
    return out;
  }

  /* ============================ 动画 ============================ */

  animate(dt, time) {
    const sp = this._speed;
    const moving = sp > 0.6;
    const swing = moving ? Math.sin(this._walkPhase) * Math.min(0.62, sp * 0.11) : 0;
    const bob = moving ? Math.abs(Math.sin(this._walkPhase)) * 0.035 : Math.sin(time * 1.6) * 0.012;

    // 腿部摆动
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    // 手臂反向摆动（持枪时幅度更小）
    this.armL.rotation.x = -swing * 0.55;
    this.armR.rotation.x = 1.15 - swing * 0.18 + this.recoil * 0.25;

    // 躯干起伏与后坐
    this.group.position.set(this.pos.x, this.y + bob, this.pos.z);
    this.group.rotation.y = this.bodyYaw;
    this.group.rotation.x = this.recoil * 0.05;

    // 能量核心呼吸
    const pulse = 0.75 + Math.sin(time * 3.2) * 0.25;
    this.core.material.color.setRGB(0.21 * pulse, 0.91 * pulse, 1.0 * pulse);

    // 空中姿态
    if (!this.onGround) {
      this.legL.rotation.x = 0.35;
      this.legR.rotation.x = -0.25;
    }
  }

  /* ============================ 相机 ============================ */

  updateCamera(dt, arena) {
    // 聚焦锚点：头部略上方，作为过肩视角的旋转中心
    _v.set(this.pos.x, this.y + 1.42, this.pos.z);

    const pitch = this.camPitch;
    const yaw = this.camYaw;
    const dist = CAMERA.distance;

    // 水平朝向：相机看向的方向（yaw=0 时朝 -Z）
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    // 右方向（水平面内，与朝向垂直）
    const rx = -fz, rz = fx;

    const horiz = Math.cos(pitch) * dist;

    // 目标机位：身后 dist + 抬高 + 右肩偏移
    _v2.set(
      _v.x - fx * horiz + rx * CAMERA.shoulder,
      _v.y - Math.sin(pitch) * dist + CAMERA.height,
      _v.z - fz * horiz + rz * CAMERA.shoulder
    );

    // 墙体避让：从锚点朝机位打一条射线，撞墙就缩短
    _dir3.copy(_v2).sub(_v);
    const full = _dir3.length();
    _dir3.normalize();
    const hit = arena.raycastWalls(
      { x: _v.x, z: _v.z }, { x: _dir3.x, z: _dir3.z }, full, 0.3
    );
    const safe = Math.max(CAMERA.minDistance, Math.min(full, hit - 0.3));
    _v2.copy(_v).addScaledVector(_dir3, safe);

    // 高度夹取：不要钻进地板，也不要穿出天花板
    _v2.y = Math.max(0.7, Math.min(_v2.y, MAP.wallHeight - 0.4));

    // 平滑跟随：距离越远越跟手，避免拖影
    this.camera.position.lerp(_v2, 1 - Math.pow(CAMERA.followLambda, dt));

    // 视线落点：沿「锚点 → 机位」的反方向延伸，准星中心即射线方向
    _look.copy(_v).addScaledVector(_dir3, -CAMERA.aimDistance);
    this.camera.lookAt(_look);
  }

  /** 相机前向（射击方向） */
  aimDir(out) {
    this.camera.getWorldDirection(out);
    return out;
  }

  _lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
}
