/**
 * 战争迷雾（Fog of War）
 * ---------------------------------------------------------------
 * 地图仅玩家视野范围内可见，走过的地方会留下「记忆」但不再主动发光，
 * 未探索区域被一层近黑色的覆盖层遮住 —— 这就是「地图只开一小部分」。
 *
 * 实现要点：
 *   · 迷雾状态存在一张 cols×rows 的标量场里；
 *   · 用 CanvasTexture 上传给 GPU，LinearFilter 天然产生柔和边缘；
 *   · 只在玩家跨格 + 冷却结束时才重绘贴图，避免每帧上传；
 *   · 顶棚灯带也读同一张图，未探索区域直接 discard。
 */

import * as THREE from '../vendor/three.module.js';
import { MAP, MAP_W, MAP_D, FOG } from './config.js';

export class FogOfWar {
  constructor(scene) {
    this.cols = MAP.cols;
    this.rows = MAP.rows;
    this.data = new Float32Array(this.cols * this.rows);

    // 迷雾贴图（1 像素 = 1 格）
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(this.cols, this.rows);
    for (let i = 0; i < this.data.length; i++) this.image.data[i * 4 + 3] = 255;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;

    this._timer = 0;
    this._lastCell = -1;
    this.exploredRatio = 0;

    this._buildOverlay(scene);
  }

  /** 地面覆盖层：未探索 → 近黑不透明；已探索 → 完全透明 */
  _buildOverlay(scene) {
    const geo = new THREE.PlaneGeometry(MAP_W, MAP_D);
    const mat = new THREE.ShaderMaterial({
      uniforms: { fogMap: { value: this.texture } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D fogMap;
        varying vec2 vUv;
        void main() {
          float f = texture2D(fogMap, vUv).r;
          float a = 1.0 - smoothstep(0.02, 0.5, f);
          gl_FragColor = vec4(0.010, 0.018, 0.032, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.03;
    mesh.renderOrder = 5;
    scene.add(mesh);
    this.overlay = mesh;
  }

  /** 每帧调用：按冷却节流刷新 */
  update(dt, playerPos) {
    this._timer -= dt;
    if (this._timer > 0) return;
    this._timer = FOG.updateInterval;

    const i = Math.floor((playerPos.x + MAP_W / 2) / MAP.tile);
    const j = Math.floor((playerPos.z + MAP_D / 2) / MAP.tile);
    this.playerCell = [i, j];
    this._reveal(i, j, FOG.revealRadius);
    this._upload();
  }

  /** 以 (ci,cj) 为中心点亮圆形区域，边缘做柔和衰减 */
  _reveal(ci, cj, radius) {
    const r2 = radius * radius;
    const soft = 0.45; // 边缘柔化系数
    let explored = 0;

    for (let j = Math.max(0, cj - radius - 1); j <= Math.min(this.rows - 1, cj + radius + 1); j++) {
      for (let i = Math.max(0, ci - radius - 1); i <= Math.min(this.cols - 1, ci + radius + 1); i++) {
        const dx = i - ci, dy = j - cj;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = j * this.cols + i;

        if (dist <= radius) {
          // 中心全亮，边缘渐变
          const v = 1 - (dist / radius) * soft;
          if (v > this.data[idx]) this.data[idx] = v;
        } else if (this.data[idx] > FOG.softKeep) {
          // 离开视野后逐渐暗到「记忆亮度」
          this.data[idx] = Math.max(FOG.softKeep, this.data[idx] - 0.02);
        }
        if (this.data[idx] > 0.1) explored++;
      }
    }
    this.exploredRatio = explored / this.data.length;
  }

  _upload() {
    const d = this.image.data;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] * 255) | 0;
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.texture.needsUpdate = true;
  }

  /** 查询某世界坐标的可见度（0~1），用于判断敌人是否应该显形 */
  visibilityAt(x, z) {
    const i = Math.floor((x + MAP_W / 2) / MAP.tile);
    const j = Math.floor((z + MAP_D / 2) / MAP.tile);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return 0;
    return this.data[j * this.cols + i];
  }
}
