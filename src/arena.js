/**
 * 场景（Arena）
 * ---------------------------------------------------------------
 * 生成一座被战争迷雾覆盖的遗迹设施：
 *   · 网格化布局，房间 + 走廊手工设计，避免纯随机导致的可玩性缺失
 *   · 墙体/箱体/管道全部使用 InstancedMesh，数百个物件仅占个位数 draw call
 *   · 提供网格碰撞与射线查询，供移动、射击、AI 使用
 */

import * as THREE from '../vendor/three.module.js';
import { MAP, MAP_W, MAP_D, COLORS } from './config.js';
import { makeFloorTextures, makeWallTextures, makeCeilingTexture } from './textures.js';

const HALF_W = MAP_W / 2;
const HALF_D = MAP_D / 2;

export class Arena {
  constructor(scene, fogTexture) {
    this.scene = scene;
    this.cols = MAP.cols;
    this.rows = MAP.rows;
    this.tile = MAP.tile;

    /** 1 = 实心墙，0 = 可通行 */
    this.solid = new Uint8Array(this.cols * this.rows).fill(1);
    this.openCells = [];
    /** 货箱碰撞体 { x, z, r } */
    this.crateColliders = [];

    this._generateLayout();
    this._buildFloor(scene);
    this._buildCeiling(scene);
    this._buildWalls(scene);
    this._buildProps(scene);
    this._buildLightStrips(scene, fogTexture);

    // 复用的临时对象，避免每帧 GC
    this._tmp = new THREE.Vector3();
  }

  /* ============================ 布局生成 ============================ */

  _carve(i0, j0, i1, j1) {
    for (let j = Math.max(0, j0); j <= Math.min(this.rows - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(this.cols - 1, i1); i++) {
        this.solid[j * this.cols + i] = 0;
      }
    }
  }

  _generateLayout() {
    const C = Math.floor(this.cols / 2);
    const R = Math.floor(this.rows / 2);

    // 中央大厅
    this._carve(C - 11, R - 11, C + 11, R + 11);
    // 十字主廊
    this._carve(C - 2, 4, C + 2, this.rows - 5);
    this._carve(4, R - 2, this.cols - 5, R + 2);
    // 四个角房间
    this._carve(6, 6, 20, 20);
    this._carve(this.cols - 21, 6, this.cols - 7, 20);
    this._carve(6, this.rows - 21, 20, this.rows - 7);
    this._carve(this.cols - 21, this.rows - 21, this.cols - 7, this.rows - 7);
    // 侧翼小室
    this._carve(C - 20, R - 5, C - 12, R + 5);
    this._carve(C + 12, R - 5, C + 20, R + 5);
    this._carve(C - 5, R - 20, C + 5, R - 12);
    this._carve(C - 5, R + 12, C + 5, R + 20);
    // 环形外廊（连通四个角房间）
    this._carve(5, 5, this.cols - 6, 7);
    this._carve(5, this.rows - 8, this.cols - 6, this.rows - 6);
    this._carve(5, 5, 7, this.rows - 6);
    this._carve(this.cols - 8, 5, this.cols - 6, this.rows - 6);

    // 收集可通行格
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        if (!this.solid[j * this.cols + i]) this.openCells.push(i, j);
      }
    }
  }

  /* ============================ 地板 ============================ */

  _buildFloor(scene) {
    const { map, normalMap, roughnessMap } = makeFloorTextures(512);
    map.repeat.set(MAP_W / 4, MAP_D / 4);
    normalMap.repeat.set(MAP_W / 4, MAP_D / 4);
    roughnessMap.repeat.set(MAP_W / 4, MAP_D / 4);

    const geo = new THREE.PlaneGeometry(MAP_W, MAP_D);
    const mat = new THREE.MeshStandardMaterial({
      map, normalMap, roughnessMap,
      metalness: 0.72,
      roughness: 0.62,
      color: 0xffffff,
      normalScale: new THREE.Vector2(0.9, 0.9),
    });
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    this.floor = floor;
  }

  /* ============================ 顶棚 ============================ */

  _buildCeiling(scene) {
    const tex = makeCeilingTexture(256);
    tex.repeat.set(MAP_W / 5, MAP_D / 5);
    const geo = new THREE.PlaneGeometry(MAP_W, MAP_D);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: 0x5a6472, metalness: 0.5, roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const ceil = new THREE.Mesh(geo, mat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = MAP.wallHeight;
    scene.add(ceil);
  }

  /* ============================ 墙体 ============================ */

  _buildWalls(scene) {
    const { map, normalMap } = makeWallTextures(512);
    map.repeat.set(2, 1);
    normalMap.repeat.set(2, 1);

    const t = MAP.tile, h = MAP.wallHeight;
    const geo = new THREE.BoxGeometry(t, h, t);
    const mat = new THREE.MeshStandardMaterial({
      map, normalMap, color: 0x8f9aab,
      metalness: 0.55, roughness: 0.68,
      normalScale: new THREE.Vector2(1.1, 1.1),
    });

    // 只渲染「与通路相邻」的实心格，内部实心格不可见，省掉大量实例
    const cells = [];
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        if (!this.solid[j * this.cols + i]) continue;
        let adj = false;
        for (let dj = -1; dj <= 1 && !adj; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= this.cols || nj >= this.rows) continue;
            if (!this.solid[nj * this.cols + ni]) { adj = true; break; }
          }
        }
        if (adj) cells.push(i, j);
      }
    }

    const count = cells.length / 2;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const m = new THREE.Matrix4();
    for (let k = 0; k < count; k++) {
      const i = cells[k * 2], j = cells[k * 2 + 1];
      const x = (i + 0.5) * t - HALF_W;
      const z = (j + 0.5) * t - HALF_D;
      m.makeTranslation(x, h / 2, z);
      mesh.setMatrixAt(k, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    this.walls = mesh;
    this.wallCount = count;
  }

  /* ============================ 道具 ============================ */

  _buildProps(scene) {
    const rand = this._seededRandom(2024);

    // 货箱：沿墙边摆放，增加遮挡与层次
    const crateGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x3a4454, metalness: 0.6, roughness: 0.55,
    });
    const crates = [];
    for (let k = 0; k < this.openCells.length / 2; k++) {
      const i = this.openCells[k * 2], j = this.openCells[k * 2 + 1];
      if (rand() > 0.045) continue;
      // 只放在贴墙的格子上，避免堵住通路
      let nearWall = false;
      for (let d = 0; d < 4; d++) {
        const di = [1, -1, 0, 0][d], dj = [0, 0, 1, -1][d];
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= this.cols || nj >= this.rows) { nearWall = true; break; }
        if (this.solid[nj * this.cols + ni]) { nearWall = true; break; }
      }
      if (!nearWall) continue;
      const cx = (i + 0.5) * MAP.tile - HALF_W;
      const cz = (j + 0.5) * MAP.tile - HALF_D;
      const sc = 0.8 + rand() * 0.5;
      crates.push([cx, cz, sc]);
      // 碰撞体：箱子会挡住人和敌人，避免穿模
      this.crateColliders.push({ x: cx, z: cz, r: 0.58 * sc });
    }

    const crateMesh = new THREE.InstancedMesh(crateGeo, crateMat, crates.length);
    crateMesh.castShadow = true;
    crateMesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < crates.length; k++) {
      const sc = crates[k][2];
      p.set(crates[k][0], 0.55 * sc, crates[k][1]);
      q.setFromAxisAngle(up, rand() * Math.PI);
      s.set(sc, sc, sc);
      m.compose(p, q, s);
      crateMesh.setMatrixAt(k, m);
    }
    crateMesh.instanceMatrix.needsUpdate = true;
    scene.add(crateMesh);
    this.crates = crateMesh;
  }

  /* ============================ 顶棚灯带 ============================ */

  /**
   * 灯带由迷雾驱动：未探索区域直接 discard，
   * 探索过的地方才会亮起 —— 视觉上「地图只开一小部分」
   */
  _buildLightStrips(scene, fogTexture) {
    const positions = [];
    const C = Math.floor(this.cols / 2), R = Math.floor(this.rows / 2);
    const step = 5;
    for (let i = 6; i < this.cols - 6; i += step) {
      if (!this.solid[R * this.cols + i]) positions.push([i, R]);
    }
    for (let j = 6; j < this.rows - 6; j += step) {
      if (!this.solid[j * this.cols + C]) positions.push([C, j]);
    }

    const geo = new THREE.BoxGeometry(2.6, 0.12, 0.5);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        fogMap: { value: fogTexture },
        uColor: { value: new THREE.Color(0x39e7ff) },
      },
      vertexShader: /* glsl */`
        varying vec2 vFogUv;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vFogUv = vec2((wp.x + ${HALF_W.toFixed(3)}) / ${MAP_W.toFixed(3)},
                        (wp.z + ${HALF_D.toFixed(3)}) / ${MAP_D.toFixed(3)});
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D fogMap;
        uniform vec3 uColor;
        varying vec2 vFogUv;
        void main() {
          float f = texture2D(fogMap, vFogUv).r;
          if (f < 0.10) discard;              // 未探索：完全不绘制
          gl_FragColor = vec4(uColor * (0.45 + f * 1.75), 1.0);
        }
      `,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    const m = new THREE.Matrix4();
    for (let k = 0; k < positions.length; k++) {
      const i = positions[k][0], j = positions[k][1];
      m.makeTranslation(
        (i + 0.5) * MAP.tile - HALF_W,
        MAP.wallHeight - 0.09,
        (j + 0.5) * MAP.tile - HALF_D
      );
      mesh.setMatrixAt(k, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    this.strips = mesh;
  }

  /* ============================ 坐标与碰撞 ============================ */

  cellOf(x, z) {
    const i = Math.floor((x + HALF_W) / MAP.tile);
    const j = Math.floor((z + HALF_D) / MAP.tile);
    return [i, j];
  }

  isSolidCell(i, j) {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return true;
    return this.solid[j * this.cols + i] === 1;
  }

  isSolidAt(x, z) {
    const [i, j] = this.cellOf(x, z);
    return this.isSolidCell(i, j);
  }

  /**
   * 圆形与网格的碰撞消解：检查周围 3×3 格，
   * 与实心格做「圆 vs AABB」最近点推出。逐轴处理，避免卡角。
   */
  resolveCircle(pos, radius) {
    const t = MAP.tile;
    const [ci, cj] = this.cellOf(pos.x, pos.z);

    // 先看货箱（圆 vs 圆），数量少、开销可忽略
    for (const c of this.crateColliders) {
      let dx = pos.x - c.x;
      let dz = pos.z - c.z;
      let d2 = dx * dx + dz * dz;
      const rr = radius + c.r;
      if (d2 >= rr * rr) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
      const push = rr - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if (!this.isSolidCell(i, j)) continue;

        const minX = i * t - HALF_W;
        const minZ = j * t - HALF_D;
        const maxX = minX + t;
        const maxZ = minZ + t;

        // AABB 上的最近点
        const cx = Math.max(minX, Math.min(pos.x, maxX));
        const cz = Math.max(minZ, Math.min(pos.z, maxZ));
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;

        if (d2 > radius * radius) continue;

        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // 圆心已在格内：沿最小穿透轴弹出
          const left = pos.x - minX, right = maxX - pos.x;
          const up = pos.z - minZ, down = maxZ - pos.z;
          const minPen = Math.min(left, right, up, down);
          if (minPen === left) pos.x = minX - radius;
          else if (minPen === right) pos.x = maxX + radius;
          else if (minPen === up) pos.z = minZ - radius;
          else pos.z = maxZ + radius;
        }
      }
    }
  }

  /**
   * 射线与墙体求交（步进法）
   * 返回命中距离；未命中返回 Infinity
   */
  raycastWalls(origin, dir, maxDist, step = 0.3) {
    let d = 0;
    while (d < maxDist) {
      d += step;
      const x = origin.x + dir.x * d;
      const z = origin.z + dir.z * d;
      if (this.isSolidAt(x, z)) return d;
    }
    return Infinity;
  }

  /** 随机取一个可通行点（世界坐标，y=0） */
  randomOpenPoint(rand) {
    const n = this.openCells.length / 2;
    const k = Math.floor(rand() * n);
    const i = this.openCells[k * 2], j = this.openCells[k * 2 + 1];
    return new THREE.Vector3(
      (i + 0.5) * MAP.tile - HALF_W,
      0,
      (j + 0.5) * MAP.tile - HALF_D
    );
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
