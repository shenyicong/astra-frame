/**
 * 全局配置
 * ---------------------------------------------------------------
 * 所有可调参数集中在此，方便调优与二次开发。
 * 性能相关参数（阴影、分辨率缩放、敌人上限）集中在 PERF 段。
 */

export const MAP = {
  cols: 80,          // 地图横向格数
  rows: 80,          // 地图纵向格数
  tile: 1.6,         // 每格边长（米）
  wallHeight: 4.2,   // 墙体高度（米）
};

/** 地图世界尺寸（米） */
export const MAP_W = MAP.cols * MAP.tile;
export const MAP_D = MAP.rows * MAP.tile;

export const FOG = {
  revealRadius: 7,     // 视野半径（格），约 11 米 —— 所以只能看见地图一小块
  softKeep: 0.62,      // 离开视野后保留的可见度（记忆效果）
  updateInterval: 0.08,// 迷雾刷新最小间隔（秒），避免每帧重绘贴图
};

export const PLAYER = {
  radius: 0.42,
  height: 1.85,
  walkSpeed: 5.4,
  sprintSpeed: 9.2,
  accel: 26,           // 加速度（米/秒²）
  friction: 12,        // 阻尼
  jumpSpeed: 7.4,
  gravity: 22,
  maxHealth: 100,
  maxShield: 100,
  shieldRegen: 14,     // 每秒
  shieldDelay: 3.2,    // 受击后多久开始回盾（秒）
  eyeHeight: 1.62,
};

/**
 * 第三人称相机 & 鼠标手感
 * ---------------------------------------------------------------
 * sensitivity 单位：弧度 / 像素。默认 0.00095 属于偏慢的精确档，
 * 游戏中用 [ 和 ] 可在 0.0004 ~ 0.0026 之间实时微调（存 localStorage）。
 */
export const CAMERA = {
  sensitivity: 0.00095,  // 鼠标灵敏度（水平）
  pitchScale: 0.82,      // 垂直灵敏度相对水平的倍率
  minSensitivity: 0.0004,
  maxSensitivity: 0.0026,
  distance: 5.4,         // 第三人称机位距离（米）
  height: 0.62,          // 机位相对头部再抬高（米）
  shoulder: 0.95,        // 右肩偏移，形成过肩视角
  minDistance: 1.15,     // 贴墙时最短距离，避免穿模
  pitchMin: -0.35,       // 俯角下限（向下看）
  pitchMax: 0.62,        // 仰角上限（向上看）
  followLambda: 0.0015,  // 机位跟随平滑系数（越小越跟手）
  aimDistance: 12,       // 视线落点距离
};

export const WEAPON = {
  name: 'BRATON',
  fireRate: 9.5,       // 每秒发数
  damage: 26,
  spread: 0.012,       // 基础散布（弧度）
  spreadMoving: 0.032, // 移动时散布
  magSize: 30,
  reloadTime: 1.65,
  range: 90,
  projectileSpeed: 118,
  recoil: 0.9,
};

export const ENEMY = {
  maxAlive: 12,        // 同屏上限（控制 draw call 与 AI 开销）
  totalCount: 22,      // 关卡总数
  radius: 0.45,
  height: 1.9,
  health: 100,
  speed: 2.6,
  chaseSpeed: 4.1,
  sightRange: 17,
  attackRange: 15,
  fireInterval: 1.35,
  bulletSpeed: 34,
  bulletDamage: 9,
  respawnTime: 0,      // 不重生，清完即胜
};

/**
 * 性能预算
 * ---------------------------------------------------------------
 * 目标：1080p 核显 / 集成显卡稳定 60 FPS。
 * 手段：单方向光投影 + 动态分辨率 + 实例化 + 对象池。
 */
export const PERF = {
  maxPixelRatio: 1.5,     // 像素比上限（4K 屏不无限放大）
  minPixelRatio: 0.72,    // 动态缩放下限
  targetFps: 58,          // 低于此值开始降分辨率
  shadowMapSize: 1024,    // 阴影贴图分辨率
  shadowRadius: 34,       // 阴影相机覆盖半径（米），越小越清晰
  pixelScaleStep: 0.06,   // 每次调整步长
  pixelScaleCooldown: 1.4,// 调整冷却（秒），避免抖动
};

/** 逻辑帧率：固定步长，保证物理与 AI 行为稳定（与渲染帧率解耦） */
export const FIXED_DT = 1 / 60;
export const MAX_SUBSTEPS = 3;

/** 调色板 */
export const COLORS = {
  metalDark: 0x1b2230,
  metalMid: 0x2b3444,
  metalLight: 0x49576e,
  emissiveCyan: 0x00f0ff,
  emissiveAmber: 0xff9a3c,
  emissiveRed: 0xff3b5c,
  fog: 0x05080f,
};
