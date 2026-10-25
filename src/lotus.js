/**
 * 程序化的一株莲。
 *
 * 造型依据都来自真实结构，不是随手捏的：
 *  · 花瓣按叶序规律分轮排布，轮与轮之间错开黄金角（约 137.5°），所以怎么转都不会看出"复制粘贴"感；
 *  · 外轮花瓣摊得开、尖端外翻，内轮立得直、尖端向内兜住莲蓬——这是真花从开到含的同一个连续变化；
 *  · 花瓣是单层极薄的曲面，靠 transmission 让光真的穿过去，逆光时整朵花从内部亮起来；
 *  · 荷叶是盾形，中心最高、四周下垂，边缘一圈起伏，叶柄从叶心底下接入。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SUN_DIR, WATER_LEVEL, BOTTOM_LEVEL,
         makeNoise2D, makeMudTexture, applyUnderwaterAbsorption } from './env.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/* ============================================================ 花瓣 */

function halfWidthAt(u, W) {
  /* 基部收窄、中段最宽（约在长度的 42%）、再收成柔和的尖。
     指数压到 1 以下，轮廓才饱满；否则会尖成一根针，看着像大丽花而不是莲。 */
  return W * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.80)), 0.85);
}

/**
 * 单片花瓣的参数化曲面。
 * 长度方向 u：0 是基部，1 是尖端；宽度方向 v：-1 到 1。
 */
function makePetalGeometry({ length, len, width, curl, reflex, cup, fold, segU = 20, segV = 10 }) {
  const L = (length !== undefined ? length : len);
  const positions = [], uvs = [], colors = [], indices = [];

  const cBase = new THREE.Color('#fffefc');   // 基部近乎白
  const cMid  = new THREE.Color('#fbdde5');   // 中段浅粉
  const cTip  = new THREE.Color('#e88fa8');   // 尖端略深的粉
  const tmp = new THREE.Color();

  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    const hw = halfWidthAt(u, width);
    const bend = curl * L * Math.pow(u, 1.85);
    const back = (u > 0.68) ? -reflex * L * Math.pow((u - 0.68) / 0.32, 2) : 0;
    const cupAmt = cup * (0.45 + 0.55 * u);

    for (let iv = 0; iv <= segV; iv++) {
      const v = (iv / segV) * 2 - 1;

      /* 左右轻微不对称，避免机械感 */
      const asym = 1 + 0.055 * v;
      const x = v * hw * asym;
      const y = u * L;
      /* 横截面的凹兜 + 中脊的一道折痕 */
      const cross = cupAmt * hw * (v * v) - fold * hw * (1 - Math.abs(v)) * 0.5;
      const z = bend + back + cross;

      positions.push(x, y, z);
      uvs.push((v + 1) * 0.5, u);

      const edge = Math.pow(Math.abs(v), 1.5);
      const tipness = Math.pow(Math.max(0, (u - 0.10) / 0.90), 0.85);
      const t = Math.min(1, tipness * 0.80 + edge * 0.40 * (0.25 + 0.75 * tipness));
      tmp.copy(cBase);
      if (t < 0.5) tmp.lerp(cMid, t / 0.5);
      else tmp.lerp(cTip, (t - 0.5) / 0.5 * 0.92);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
  }

  const cols = segV + 1;
  for (let iu = 0; iu < segU; iu++) {
    for (let iv = 0; iv < segV; iv++) {
      const a = iu * cols + iv;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const petalMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.36,
  metalness: 0.0,
  transmission: 0.86,
  thickness: 0.045,
  ior: 1.35,
  attenuationColor: new THREE.Color('#ffe0e8'),
  attenuationDistance: 1.20,
  clearcoat: 0.14,
  clearcoatRoughness: 0.55,
  sheen: 0.65,
  sheenColor: new THREE.Color('#ffd4de'),
  sheenRoughness: 0.55,
  side: THREE.DoubleSide,
  envMapIntensity: 1.45
});

/* 由外到内五轮：外轮摊开、内轮立起并向内兜。
   width 是花瓣最宽处的半宽——莲瓣的长宽比大约 3:1，别给大了，给大就成了玫瑰。 */
const WHORLS = [
  { count: 9,  len: 0.202, width: 0.048, tilt: 72, r: 0.026, y: -0.012, curl:  0.24, reflex: 0.055, cup: 0.62, fold: 0.22 },
  { count: 11, len: 0.206, width: 0.045, tilt: 58, r: 0.023, y:  0.004, curl:  0.20, reflex: 0.048, cup: 0.58, fold: 0.20 },
  { count: 13, len: 0.192, width: 0.041, tilt: 44, r: 0.019, y:  0.020, curl:  0.12, reflex: 0.036, cup: 0.54, fold: 0.18 },
  { count: 14, len: 0.168, width: 0.036, tilt: 30, r: 0.015, y:  0.034, curl:  0.02, reflex: 0.020, cup: 0.50, fold: 0.16 },
  { count: 12, len: 0.112, width: 0.028, tilt: 25, r: 0.011, y: 0.048, curl: -0.14, reflex: 0.006, cup: 0.44, fold: 0.14 }
];

let petalSeed = 20;
function rnd() { petalSeed = (petalSeed * 1103515245 + 12345) & 0x7fffffff; return petalSeed / 0x7fffffff; }

function buildPetals(pickables, partName = 'petal') {
  const group = new THREE.Group();
  group.name = 'petals';

  let angleSeed = rnd() * 360;
  WHORLS.forEach((w) => {
    const geo = makePetalGeometry(w);
    WHORLS.indexOf(w); // 保持每轮一个共享几何体
    for (let i = 0; i < w.count; i++) {
      const mesh = new THREE.Mesh(geo, petalMaterial);
      const angle = (i * (360 / w.count) + angleSeed + (rnd() - 0.5) * 8) * DEG;
      const scale = 0.94 + rnd() * 0.13;

      const pivot = new THREE.Group();
      pivot.rotation.y = angle;

      const lean = new THREE.Group();
      lean.position.set(0, w.y + (rnd() - 0.5) * 0.006, w.r * (0.9 + rnd() * 0.2));
      lean.rotation.x = (w.tilt + (rnd() - 0.5) * 7) * DEG;
      lean.rotation.z = (rnd() - 0.5) * 9 * DEG;

      mesh.scale.setScalar(scale);
      mesh.castShadow = true;
      mesh.userData.part = partName;

      lean.add(mesh);
      pivot.add(lean);
      group.add(pivot);
      pickables.push(mesh);
    }
    angleSeed += 137.5;
  });

  return group;
}

/* ============================================================ 莲蓬与花蕊 */

function podTopTexture(holes = 18) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');

  const rg = g.createRadialGradient(S / 2, S / 2, 6, S / 2, S / 2, S / 2);
  rg.addColorStop(0, '#cbdc84');
  rg.addColorStop(0.55, '#a9bd5c');
  rg.addColorStop(1, '#7d9135');
  g.fillStyle = rg;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, TAU); g.fill();

  const spots = [[0.5, 0.5, 0.085]];
  const ring = (count, radius, dotR, phase) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + phase;
      spots.push([0.5 + Math.cos(a) * radius, 0.5 + Math.sin(a) * radius, dotR]);
    }
  };
  ring(6, 0.235, 0.075, 0.3);
  ring(11, 0.395, 0.062, 0.9);

  spots.forEach(([sx, sy, sr]) => {
    const x = sx * S, y = sy * S, r = sr * S;
    const hg = g.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r);
    hg.addColorStop(0, '#2f3a12');
    hg.addColorStop(0.62, '#4a5a1c');
    hg.addColorStop(0.88, '#93a745');
    hg.addColorStop(1, '#c9dc86');
    g.fillStyle = hg;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const podSideMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#aec463'), roughness: 0.62, metalness: 0.0
});
const podTopMaterial = new THREE.MeshStandardMaterial({
  map: podTopTexture(), roughness: 0.55, metalness: 0.0
});
const podBottomMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#8ba249'), roughness: 0.7
});

function makePod({ radius = 0.038, height = 0.034, pickables, partName }) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.52, height, 48, 1, false),
    [podSideMaterial, podTopMaterial, podBottomMaterial]
  );
  body.castShadow = true;
  if (partName) {
    body.userData.part = partName;
    pickables.push(body);
  }
  g.add(body);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.995, 0.0022, 8, 48),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#c8dd86'), roughness: 0.5 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height / 2;
  g.add(rim);

  return g;
}

function makeStamens({ count = 150, radiusInner = 0.026, radiusOuter = 0.046,
                       lengthMin = 0.036, lengthMax = 0.070, leanMin = 26, leanMax = 74,
                       color = '#f0c63c', tipColor = '#e59a1e' }) {
  const g = new THREE.Group();

  const filament = new THREE.CylinderGeometry(0.0016, 0.0030, 1, 5, 1, false);
  filament.translate(0, 0.5, 0);

  const anther = new THREE.SphereGeometry(0.0024, 6, 5);

  const filMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.55, metalness: 0.05,
    sheen: 0.5, sheenColor: new THREE.Color('#fff0b0')
  });
  const tipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(tipColor), roughness: 0.45, metalness: 0.05
  });

  const filaments = new THREE.InstancedMesh(filament, filMat, count);
  const anthers = new THREE.InstancedMesh(anther, tipMat, count);
  filaments.castShadow = false;

  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';

  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rnd() * 0.22;
    const rIn = radiusInner + rnd() * (radiusOuter - radiusInner);
    const len = lengthMin + rnd() * (lengthMax - lengthMin) * (0.55 + 0.45 * (rIn - radiusInner) / Math.max(1e-4, radiusOuter - radiusInner));
    const lean = (leanMin + rnd() * (leanMax - leanMin)) * DEG;

    dummy.position.set(Math.cos(a) * rIn, 0, Math.sin(a) * rIn);
    dummy.rotation.set(lean, Math.PI / 2 - a, 0);
    dummy.scale.set(1, len, 1);
    dummy.updateMatrix();

    filaments.setMatrixAt(i, dummy.matrix);

    const tip = new THREE.Vector3(0, 1.35, 0).applyMatrix4(dummy.matrix);
    dummy.position.copy(tip);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    anthers.setMatrixAt(i, dummy.matrix);
  }

  filaments.instanceMatrix.needsUpdate = true;
  anthers.instanceMatrix.needsUpdate = true;

  /* 重建 dummy 的旋转顺序，避免复用后状态残留 */
  dummy.rotation.order = 'XYZ';

  g.add(filaments, anthers);
  return g;
}

/* ============================================================ 荷叶 */

function makePokyTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');

  const rg = g.createRadialGradient(S / 2, S / 2, S * 0.03, S / 2, S / 2, S * 0.52);
  rg.addColorStop(0, '#93bd68');
  rg.addColorStop(0.42, '#5f9648');
  rg.addColorStop(0.82, '#3f7539');
  rg.addColorStop(1, '#315c30');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);

  /* 叶脉：从叶心向外发散的主脉 */
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU + 0.12;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    const steps = 26;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const r = t * S * 0.5;
      const bow = Math.sin(t * Math.PI) * 0.045 * S;
      const x = S / 2 + Math.cos(a) * r - Math.sin(a) * bow;
      const y = S / 2 + Math.sin(a) * r + Math.cos(a) * bow;
      g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(178, 214, 138, 0.42)';
    g.lineWidth = 2.4;
    g.stroke();
    g.strokeStyle = 'rgba(38, 66, 32, 0.22)';
    g.lineWidth = 6;
    g.stroke();
  }

  /* 细横脉 */
  for (let i = 0; i < 26; i++) {
    const a0 = (i / 26) * TAU + 0.12;
    const a1 = ((i + 1) / 26) * TAU + 0.12;
    for (let s = 6; s <= 24; s += 3) {
      const t = s / 26;
      const r = t * S * 0.5;
      g.beginPath();
      g.moveTo(S / 2 + Math.cos(a0) * r, S / 2 + Math.sin(a0) * r);
      g.lineTo(S / 2 + Math.cos(a1) * r, S / 2 + Math.sin(a1) * r);
      g.strokeStyle = 'rgba(160, 200, 120, 0.16)';
      g.lineWidth = 1.2;
      g.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const leafMaterial = new THREE.MeshPhysicalMaterial({
  map: makePokyTexture(),
  color: 0xffffff,
  roughness: 0.55,
  metalness: 0.0,
  clearcoat: 0.45,
  clearcoatRoughness: 0.30,
  sheen: 0.6,
  sheenColor: new THREE.Color('#bfe08a'),
  sheenRoughness: 0.55,
  side: THREE.DoubleSide,
  envMapIntensity: 0.95
});

/**
 * 盾形荷叶：中心最高、四周下垂，边缘一圈起伏，另有一道天然缺口。
 * 采用极坐标网格，UV 也按极坐标铺，正好对上画布上的放射状叶脉。
 */
function makeLeafGeometry({ radius = 0.42, rings = 26, segments = 96,
                            waveAmp = 0.030, waveCount = 5, dome = 0.055, droop = 0.10, notch = 0.16 }) {
  const positions = [], uvs = [], indices = [];

  const notchAt = 0.35 * TAU;
  const notchWidth = 0.30;

  for (let ir = 0; ir <= rings; ir++) {
    const t = ir / rings;
    for (let is = 0; is <= segments; is++) {
      const th = (is / segments) * TAU;
      const dd = Math.atan2(Math.sin(th - notchAt), Math.cos(th - notchAt));
      const notchMask = Math.exp(-Math.pow(dd / notchWidth, 2));
      const r = t * radius * (1 - notch * notchMask * Math.pow(t, 2.2));

      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;

      let y = dome * (1 - t * t) - droop * Math.pow(t, 3.4);
      y += waveAmp * Math.sin(th * waveCount + 0.6) * Math.pow(t, 2.6);
      y += waveAmp * 0.45 * Math.sin(th * (waveCount * 2 + 1) - 1.2) * Math.pow(t, 3.4);
      /* 叶心处微微下凹，是叶柄接入的位置 */
      y -= 0.012 * Math.exp(-Math.pow(t / 0.14, 2));

      positions.push(x, y, z);
      uvs.push(0.5 + Math.cos(th) * t * 0.5, 0.5 + Math.sin(th) * t * 0.5);
    }
  }

  const cols = segments + 1;
  for (let ir = 0; ir < rings; ir++) {
    for (let is = 0; is < segments; is++) {
      const a = ir * cols + is;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/* ============================================================ 花茎 */

const stemMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#7fa04a'), roughness: 0.72, metalness: 0.0
});

function makeStemAssembly(basePos, headOffset, { radius = 0.0075, bend = 0.03, partName, pickables } = {}) {
  const g = new THREE.Group();
  g.position.copy(basePos);

  const top = headOffset.clone();
  const mid = new THREE.Vector3(top.x * 0.30 + bend, top.y * 0.52, top.z * 0.30 - bend * 0.35);
  const curve = new THREE.CatmullRomCurve3(
    [new THREE.Vector3(0, 0, 0), mid, top.clone()], false, 'catmullrom', 0.5
  );

  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, radius, 10, false), stemMaterial);
  tube.castShadow = true;
  if (partName) { tube.userData.part = partName; pickables.push(tube); }
  g.add(tube);

  const head = new THREE.Group();
  head.position.copy(top);
  g.add(head);

  return { group: g, head };
}

/* ============================================================ 藕 */

const makeRng = (seed) => {
  let s = (seed >>> 0) || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
};

/**
 * 藕的颜色贴图。
 * 真实藕节不是均匀的象牙色：底色偏暖、明暗不匀，表面散布成簇的褐色斑和细密皮孔。
 * 斑点若直接用均匀噪声铺，出来是一片椒盐，一眼就是程序生成的；
 * 所以这里先把斑点聚成簇（随机簇心 + 簇内散布），再压两层低频色斑，最后补皮孔。
 */
function makeRhizomeTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = makeRng(17);

  g.fillStyle = '#e9dcbb';
  g.fillRect(0, 0, S, S);

  /* 低频色斑：先把底色弄"脏"，避免出现一整片干净的象牙色 */
  for (let i = 0; i < 34; i++) {
    const x = rng() * S, y = rng() * S, r = 26 + rng() * 84;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, rng() < 0.54 ? 'rgba(168,144,100,0.20)' : 'rgba(252,247,229,0.20)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }

  /* 成簇的深色斑：小、淡、成堆，不能大块大块地压 */
  for (let i = 0; i < 22; i++) {
    const cx = rng() * S, cy = rng() * S;
    const n = 4 + Math.floor(rng() * 9);
    const spread = 5 + rng() * 20;
    for (let j = 0; j < n; j++) {
      const a = rng() * TAU, d = rng() * spread;
      g.fillStyle = rng() < 0.34 ? 'rgba(150,110,62,0.26)' : 'rgba(132,108,74,0.16)';
      g.beginPath();
      g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.6 + rng() * 1.6, 0, TAU);
      g.fill();
    }
  }

  /* 细密皮孔 */
  for (let i = 0; i < 1100; i++) {
    g.fillStyle = 'rgba(118,98,70,0.19)';
    g.beginPath(); g.arc(rng() * S, rng() * S, 0.4 + rng() * 0.9, 0, TAU); g.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * 一段藕的躯体：沿一条微微起伏的轴线扫掠出的管。
 * 半径沿长度变化——两端收圆、两道"节"之间收细一道，截面略扁，表面带细微起伏。
 * 所以出来的不是一根胶囊，而是能读出一节一节的藕。
 * openEnd 为真时右端不收口，留给断口面去封。
 */
function makeRhizomeBody({ length = 0.60, radius = 0.052, nodes = [0.34, 0.68],
                           openEnd = false, segU = 84, segV = 26,
                           seed = 5, wobble = 0.030, arch = 0.016 } = {}) {
  const rng = makeRng(seed);
  const p0 = rng() * TAU, p1 = rng() * TAU, p2 = rng() * TAU;

  const positions = [], uvs = [], indices = [];

  const radiusAt = (u) => {
    const rise = Math.pow(Math.min(1, u / 0.075), 0.60);
    const fall = openEnd ? 1.0 : Math.pow(Math.min(1, (1 - u) / 0.12), 0.60);
    let n = 1.0;
    for (const nu of nodes) n -= 0.26 * Math.exp(-Math.pow((u - nu) / 0.026, 2));
    return radius * rise * fall * n;
  };

  const centerAt = (u) => [
    u * length,
    arch * Math.sin(u * Math.PI) * Math.sin(u * 3.1 + p0),
    arch * 0.85 * Math.sin(u * Math.PI) * Math.sin(u * 2.3 + p1)
  ];

  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    const R = radiusAt(u);
    const [cx, cy, cz] = centerAt(u);
    /* 起伏在两端收敛到零，端面才跟断口圆片严丝合缝 */
    const w = wobble * Math.sin(u * Math.PI);
    for (let iv = 0; iv <= segV; iv++) {
      const th = (iv / segV) * TAU;
      const bump = 1.0 + w * (0.62 * Math.sin(u * 41.0 + th * 3.0 + p2)
                            + 0.38 * Math.sin(u * 15.0 - th * 5.0 + p0));
      const rr = R * bump;
      positions.push(cx, cy + rr * Math.sin(th) * 0.94, cz + rr * Math.cos(th));
      uvs.push(u * 3.6, (iv / segV) * 2.0);
    }
  }

  const cols = segV + 1;
  for (let iu = 0; iu < segU; iu++) {
    for (let iv = 0; iv < segV; iv++) {
      const a = iu * cols + iv, b = a + 1, cc = a + cols, d = cc + 1;
      indices.push(a, cc, b, b, cc, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 断口：藕切开后那一圈孔是它的通气道，也是"藕"最好认的特征。
 * 用带孔的平面做出真正的孔洞，每个孔后面接一小段无底圆筒当孔壁，
 * 最里面压一张深色圆片——斜着看进去也是一个个有深度的暗孔，而不是画上去的圆点。
 */
function makeCutFace(radius, pickables) {
  const g = new THREE.Group();

  const holes = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.36;
    holes.push([Math.cos(a) * radius * 0.60, Math.sin(a) * radius * 0.60, radius * 0.145]);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.95;
    holes.push([Math.cos(a) * radius * 0.31, Math.sin(a) * radius * 0.31, radius * 0.105]);
  }
  holes.push([0, 0, radius * 0.085]);

  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, TAU, false);
  holes.forEach(([x, y, r]) => {
    const p = new THREE.Path();
    p.absarc(x, y, r, 0, TAU, true);
    shape.holes.push(p);
  });

  const plateGeo = new THREE.ShapeGeometry(shape, 26);
  plateGeo.rotateY(Math.PI / 2);          /* 面法线从 +Z 转到 +X */
  const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f0e6c9'), roughness: 0.5, metalness: 0.0
  }));
  plate.userData.part = 'rhizome';
  plate.userData.underMud = true;
  pickables.push(plate);
  g.add(plate);

  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#6a5637'), roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide
  });
  const wallGeo = new THREE.CylinderGeometry(1, 0.82, 1, 10, 1, true);
  wallGeo.rotateZ(-Math.PI / 2);          /* 轴从 +Y 转到 +X */
  const H = radius * 0.85;

  holes.forEach(([x, y, r]) => {
    const w = new THREE.Mesh(wallGeo, wallMat);
    w.position.set(-H * 0.5, y, -x);      /* 面在 XY 上，转到 YZ 后 y↔y、z↔-x */
    w.scale.set(H, r, r);
    g.add(w);
  });

  const backGeo = new THREE.CircleGeometry(radius * 0.99, 30);
  backGeo.rotateY(Math.PI / 2);
  const back = new THREE.Mesh(backGeo, new THREE.MeshBasicMaterial({
    color: new THREE.Color('#241a11'), fog: false
  }));
  back.position.x = -H * 1.04;
  g.add(back);

  return g;
}

/**
 * 根须：从藕节上垂下去的一丛丛细根。
 * 每根都是上粗下细、带弧度的管，末端一路扎到泥面以下——挖开泥之后能看到它们
 * 插进土里，而不是浮在藕边。所有根合并成一个几何体，只占一次绘制。
 */
function makeRootGeometry(specs, segU = 7, segV = 6) {
  const position = [], index = [];
  let offset = 0;
  const v = new THREE.Vector3();
  const pt = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);

  for (const s of specs) {
    const dir = s.dir.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, Z);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const fwd = new THREE.Vector3().crossVectors(side, dir).normalize();
    const bendDir = side.clone().multiplyScalar(Math.cos(s.seed * 6.283))
                        .addScaledVector(fwd, Math.sin(s.seed * 6.283));

    const p0 = s.from.clone();
    const p1 = s.from.clone().addScaledVector(dir, s.length * 0.42)
                 .addScaledVector(bendDir, s.bend);
    const p2 = s.from.clone().addScaledVector(dir, s.length * 0.78)
                 .addScaledVector(bendDir, s.bend * 1.7);
    const p3 = s.from.clone().addScaledVector(dir, s.length)
                 .addScaledVector(bendDir, s.bend * 1.5);
    const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3], false, 'catmullrom', 0.5);
    const frames = curve.computeFrenetFrames(segU, false);

    for (let iu = 0; iu <= segU; iu++) {
      const t = iu / segU;
      curve.getPoint(t, pt);
      const r = s.r0 * Math.pow(1 - t, 0.55) + s.r1 * t;      /* 上粗下细 */
      const N = frames.normals[iu], B = frames.binormals[iu];
      for (let iv = 0; iv < segV; iv++) {
        const th = (iv / segV) * TAU;
        v.copy(N).multiplyScalar(Math.cos(th) * r).addScaledVector(B, Math.sin(th) * r).add(pt);
        position.push(v.x, v.y, v.z);
      }
    }
    for (let iu = 0; iu < segU; iu++) {
      for (let iv = 0; iv < segV; iv++) {
        const iv2 = (iv + 1) % segV;
        const a = offset + iu * segV + iv;
        const b = offset + iu * segV + iv2;
        const c = offset + (iu + 1) * segV + iv;
        const d = offset + (iu + 1) * segV + iv2;
        index.push(a, c, b, b, c, d);
      }
    }
    offset += (segU + 1) * segV;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 从一节藕上生根。每根根须的起点落在节的表面，方向朝下并向外散开，
 * 长度、粗细、弯曲方向都随机，避免一整圈看起来是同一根复制出来的。
 */
function rootsAt(nodesU, length, radius, count, seed) {
  const r = makeRng(seed);
  const out = [];
  nodesU.forEach((u, ni) => {
    for (let i = 0; i < count; i++) {
      const th = (i / count) * TAU + ni * 1.1 + r() * 0.5;
      const s = Math.sin(th), c = Math.cos(th);
      out.push({
        from: new THREE.Vector3(u * length + (r() - 0.5) * 0.02,
                                s * radius * 0.72, c * radius * 0.72),
        dir: new THREE.Vector3(0.34 * (r() - 0.5), s * 0.42 - 1.0,
                               c * 0.52 + 0.36 * (r() - 0.5)).normalize(),
        length: 0.085 + r() * 0.11,
        r0: 0.0027 + r() * 0.0011,
        r1: 0.0005,
        bend: 0.016 + r() * 0.03,
        seed: r()
      });
    }
  });
  return out;
}

function makeRhizome(pickables) {
  const group = new THREE.Group();
  group.name = 'rhizome';

  const map = makeRhizomeTexture();
  const bodyMat = new THREE.MeshStandardMaterial({
    map, color: new THREE.Color('#c2b189'), roughness: 0.60, metalness: 0.0,
    bumpMap: map, bumpScale: 0.0035
  });
  applyUnderwaterAbsorption(bodyMat, { color: '#1d5560', density: 0.30 });

  const rootMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8a7752'), roughness: 0.94, metalness: 0.0
  });
  applyUnderwaterAbsorption(rootMat, { color: '#1d5560', density: 0.30 });

  const tag = (mesh) => {
    mesh.userData.part = 'rhizome';
    mesh.userData.underMud = true;
    pickables.push(mesh);
    return mesh;
  };

  /* ---- 主藕：两节连成一条，右端是断口，左端是生长尖 ----
     只让最下面一点陷在泥里：断口才露得出来，不然整个断面都埋进泥底下看不见。 */
  const main = new THREE.Group();
  main.position.set(0.02, -1.125, 0.03);
  main.rotation.set(0, -0.38, 0.03);

  const mainBody = tag(new THREE.Mesh(
    makeRhizomeBody({ length: 0.60, radius: 0.052, nodes: [0.34, 0.68], openEnd: true, seed: 5 }),
    bodyMat
  ));
  main.add(mainBody);

  const cut = makeCutFace(0.052, pickables);
  cut.position.x = 0.60;
  main.add(cut);

  main.add(tag(new THREE.Mesh(
    makeRootGeometry(rootsAt([0.34, 0.68], 0.60, 0.052, 9, 77)), rootMat
  )));

  group.add(main);

  /* ---- 后面还压着一段没有断口的 ---- */
  const second = new THREE.Group();
  second.position.set(-0.20, -1.128, -0.16);
  second.rotation.set(0, 0.62, -0.02);

  second.add(tag(new THREE.Mesh(
    makeRhizomeBody({ length: 0.44, radius: 0.047, nodes: [0.44], seed: 21 }),
    bodyMat
  )));

  second.add(tag(new THREE.Mesh(
    makeRootGeometry(rootsAt([0.44], 0.44, 0.047, 7, 118)), rootMat
  )));

  group.add(second);

  group.userData.anchor = mainBody;   /* 取景时以主藕为准，别把根须也算进包围盒 */
  return group;
}

/* ------------------------------------------------------------ 盖住藕的那层泥 */

/* 藕埋在这层泥下面。点一下会被"扒开"：着色器按到中心的距离把泥往下压，
   一直压到泥底那一层，藕就露出来了；扒开的泥还在坑沿堆起一圈。 */
const MUD_DIG = {
  uDig: { value: 0 },
  uDigRadius: { value: 0.70 }
};

function makeMudPatch() {
  const size = 2.8, segments = 150;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const mound = new Float32Array(pos.count);
  const noise = makeNoise2D(31);
  const Rmax = 1.20, H = 0.15;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const t = Math.min(1, r / Rmax);
    /* 中间平、边上陡：像一坨堆起来的泥，而不是一个圆盖 */
    const fade = 1 - 0.5 * t * t;
    let h = H * Math.pow(1 - Math.pow(t, 2.2), 0.75);
    /* 大块的泥团和小疙瘩，靠边弱化——边缘不收敛死，跟泥底的交线才是自然的不规则形 */
    h += (noise(x * 0.9, z * 0.9) * 0.018
        + noise(x * 2.6, z * 2.6) * 0.010
        + noise(x * 6.0, z * 6.0) * 0.004) * fade;
    /* 再往外整块泥扎到泥底以下，跟大泥底自然交叠，不留缝 */
    h -= Math.min(1, Math.max(0, (r - Rmax * 1.02) / (Rmax * 0.20))) * 0.34;
    mound[i] = h;
    pos.setY(i, h);
  }
  geo.setAttribute('aMound', new THREE.BufferAttribute(mound, 1));
  geo.computeVertexNormals();

  const map = makeMudTexture();
  map.repeat.set(2.4, 2.4);

  const mat = new THREE.MeshStandardMaterial({
    map, color: new THREE.Color('#8a7f5c'), roughness: 0.96, metalness: 0.0
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDig = MUD_DIG.uDig;
    shader.uniforms.uDigRadius = MUD_DIG.uDigRadius;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aMound;
        uniform float uDig;
        uniform float uDigRadius;
        varying float vDug;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float digDist = length(position.xz);
        float digMask = 1.0 - smoothstep(uDigRadius * 0.82, uDigRadius, digDist);
        float dug = clamp(uDig, 0.0, 1.0) * digMask;
        transformed.y -= aMound * dug;
        transformed.y += clamp(uDig, 0.0, 1.0) * 0.026
                       * exp(-pow((digDist - uDigRadius * 1.04) / (uDigRadius * 0.30), 2.0));
        vDug = dug;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vDug;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.rgb *= mix(1.0, 0.70, clamp(vDug, 0.0, 1.0));
        float absDist = length(vViewPosition);
        float absK = 1.0 - exp(-absDist * 0.30);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.114, 0.333, 0.376), clamp(absK, 0.0, 0.92));`);
  };
  mat.customProgramCacheKey = () => 'mud_patch_dig';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mudPatch';
  mesh.position.set(0.06, BOTTOM_LEVEL, 0.02);
  mesh.receiveShadow = true;
  mesh.userData.part = 'mud';
  return mesh;
}

/* ============================================================ 组装 */

export const HEAD = {
  flower:  new THREE.Vector3(-0.05, 0.92, 0.02),
  bud:     new THREE.Vector3(0.38, 1.06, -0.08),
  seedPod: new THREE.Vector3(0.30, 0.90, 0.26)
};

export const LEAVES = [
  { head: new THREE.Vector3(-0.52, 0.34, 0.30), radius: 0.50, tilt: -0.16, spin: 0.5, bend: 0.05 },
  { head: new THREE.Vector3( 0.12, 0.42, 0.40), radius: 0.44, tilt: -0.10, spin: 2.1, bend: -0.04 },
  { head: new THREE.Vector3( 0.58, 0.30, 0.02), radius: 0.46, tilt: -0.20, spin: 1.1, bend: 0.06 },
  { head: new THREE.Vector3(-0.34, 0.30, -0.36), radius: 0.42, tilt: -0.12, spin: 3.4, bend: -0.05 },
  { head: new THREE.Vector3( 0.30, 0.44, -0.44), radius: 0.38, tilt: -0.06, spin: 5.0, bend: 0.03 }
];

/* 花茎、叶柄都从这层泥里长出来，起点压在泥面以下，看起来才像插在土里 */
const STEM_BASE_Y = -1.12;

/* 藕埋在这层泥面之下，点击泥土会把它扒开 */
let mudOpen = false;
let mudOpenT = 0;      /* 扒开的进度，0 是盖着、1 是扒到见底 */
let lastT = 0;

/* ------------------------------------------------------------ 旁边的莲 */

/* 一株莲有近百个网格——光花瓣就五十九片。照原样复制五株就是五百个 drawcall，
   而远处的莲既不需要单独可点、也不需要分部件摆动，那么多绘制纯属浪费。
   所以按材质把它们烘成几份几何体：一株只剩十几个 drawcall，
   几何体与材质仍然和主株共用，显存不重复占。 */
function bakeByMaterial(source) {
  source.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(source.matrixWorld).invert();
  const buckets = new Map();
  const loose = [];
  const local = new THREE.Matrix4();

  source.traverse((o) => {
    if (!o.isMesh) return;
    local.multiplyMatrices(rootInv, o.matrixWorld);
    /* 多材质的莲蓬、以及实例化的花蕊，合并起来不划算，原样留着 */
    if (o.isInstancedMesh || Array.isArray(o.material)) {
      loose.push({ mesh: o, matrix: local.clone() });
      return;
    }
    const geo = o.geometry.clone().applyMatrix4(local);
    const list = buckets.get(o.material);
    if (list) list.push(geo); else buckets.set(o.material, [geo]);
  });

  const out = new THREE.Group();
  buckets.forEach((geos, material) => {
    const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (geos.length > 1) geos.forEach((g) => g.dispose());
    if (merged) out.add(new THREE.Mesh(merged, material));
  });
  loose.forEach(({ mesh, matrix }) => {
    const m = mesh.isInstancedMesh
      ? new THREE.InstancedMesh(mesh.geometry, mesh.material, mesh.count)
      : new THREE.Mesh(mesh.geometry, mesh.material);
    if (mesh.isInstancedMesh) m.instanceMatrix = mesh.instanceMatrix;
    m.matrixAutoUpdate = false;
    m.matrix.copy(matrix);
    out.add(m);
  });

  out.traverse((o) => {
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.userData = {}; }
  });
  return out;
}

/* 主株之外再摆几株。角度是绕着原点的方位角，刻意错开主株正后方，
   免得互相遮挡；摆在近处的先被看见，远的等把镜头拉远或转过去才出现。 */
const COMPANIONS = [
  { angle: 118, dist: 2.9, scale: 0.94, rot: 0.6 },
  { angle: 168, dist: 4.2, scale: 1.06, rot: 2.0 },
  { angle: 300, dist: 3.6, scale: 0.90, rot: 3.3 },
  { angle: 336, dist: 6.2, scale: 0.98, rot: 4.6 },
  { angle:  26, dist: 8.6, scale: 0.86, rot: 5.4 }
];

/* 整株往下沉一点：茎的起点就落到泥面以下，不会在水里露出一截断头 */
const COMPANION_DROP = -0.18;

function makeCompanions(parts, root, swayList) {
  const stage = new THREE.Group();
  ['flower', 'bud', 'seedPod', 'leaf'].forEach((k) => {
    if (parts[k]) stage.add(parts[k].clone(true));
  });
  const baked = bakeByMaterial(stage);

  COMPANIONS.forEach((spec) => {
    const g = new THREE.Group();
    g.add(baked.clone(true));          /* 克隆只复制节点，几何体与材质是共用的 */
    const a = spec.angle * DEG;
    g.position.set(Math.cos(a) * spec.dist, COMPANION_DROP, Math.sin(a) * spec.dist);
    g.rotation.y = spec.rot;
    g.scale.setScalar(spec.scale);
    root.add(g);
    swayList.push(g);
  });
}

export function buildLotus() {
  const root = new THREE.Group();
  root.name = 'lotus';
  const pickables = [];
  const parts = {};

  /* ---- 盛开的花 ---- */
  const flower = makeStemAssembly(
    new THREE.Vector3(HEAD.flower.x - 0.04, STEM_BASE_Y, HEAD.flower.z - 0.05),
    new THREE.Vector3(0.04, HEAD.flower.y - STEM_BASE_Y, 0.07),
    { radius: 0.0090, bend: 0.05, partName: 'petal', pickables }
  );
  const petals = buildPetals(pickables);
  const receptacle = new THREE.Mesh(
    new THREE.LatheGeometry([
      new THREE.Vector2(0.000, -0.062),
      new THREE.Vector2(0.022, -0.056),
      new THREE.Vector2(0.038, -0.038),
      new THREE.Vector2(0.042, -0.016),
      new THREE.Vector2(0.040,  0.010),
      new THREE.Vector2(0.036,  0.034)
    ], 40),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#9fbb56'), roughness: 0.68 })
  );
  /* 花蕊是莲花的标志，要够长、够密、够金，从内瓣上方探出来 */
  const stamens = makeStamens({
    count: 190, radiusInner: 0.030, radiusOuter: 0.054,
    lengthMin: 0.048, lengthMax: 0.092, leanMin: 18, leanMax: 66
  });
  stamens.position.y = 0.030;
  const pod = makePod({ radius: 0.038, height: 0.036, pickables, partName: 'pod' });
  pod.position.y = 0.048;

  flower.head.add(petals, receptacle, stamens, pod);
  root.add(flower.group);
  parts.flower = flower.group;
  parts.flowerHead = flower.head;
  parts.podMesh = pod.children[0];   /* 供"聚焦莲蓬"用的取景目标 */

  /* ---- 花苞 ---- */
  const bud = makeStemAssembly(
    new THREE.Vector3(HEAD.bud.x - 0.06, STEM_BASE_Y + 0.02, HEAD.bud.z - 0.03),
    new THREE.Vector3(0.06, HEAD.bud.y - STEM_BASE_Y, -0.03),
    { radius: 0.0072, bend: 0.02, partName: 'bud', pickables }
  );
  const budPetals = new THREE.Group();
  [
    { count: 5, len: 0.135, width: 0.031, tilt: 12, r: 0.014, y: 0.000, curl: -0.30, reflex: 0.0, cup: 0.70, fold: 0.22 },
    { count: 6, len: 0.150, width: 0.028, tilt: 8,  r: 0.010, y: 0.016, curl: -0.42, reflex: 0.0, cup: 0.66, fold: 0.20 },
    { count: 4, len: 0.128, width: 0.024, tilt: 5,  r: 0.006, y: 0.030, curl: -0.52, reflex: 0.0, cup: 0.62, fold: 0.18 }
  ].forEach((w) => {
    const geo = makePetalGeometry(w);
    for (let i = 0; i < w.count; i++) {
      const mesh = new THREE.Mesh(geo, petalMaterial);
      mesh.castShadow = true;
      mesh.userData.part = 'bud';
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / w.count) * TAU + rnd() * 0.4;
      const lean = new THREE.Group();
      lean.position.set(0, w.y, w.r);
      lean.rotation.x = w.tilt * DEG;
      lean.add(mesh);
      pivot.add(lean);
      budPetals.add(pivot);
      pickables.push(mesh);
    }
  });
  bud.head.add(budPetals);
  root.add(bud.group);
  parts.bud = bud.group;
  parts.budHead = bud.head;

  /* ---- 结籽后的莲蓬，枯蕊还挂着 ---- */
  const dried = makeStemAssembly(
    new THREE.Vector3(HEAD.seedPod.x + 0.02, STEM_BASE_Y, HEAD.seedPod.z - 0.04),
    new THREE.Vector3(-0.02, HEAD.seedPod.y - STEM_BASE_Y, 0.04),
    { radius: 0.0078, bend: -0.03, partName: 'pod', pickables }
  );
  const driedPod = makePod({ radius: 0.046, height: 0.040, pickables, partName: 'pod' });
  driedPod.rotation.x = -0.42;
  const driedStamens = makeStamens({
    count: 90, radiusInner: 0.030, radiusOuter: 0.052,
    lengthMin: 0.030, lengthMax: 0.055, leanMin: 96, leanMax: 140,
    color: '#b98a44', tipColor: '#8a6230'
  });
  driedStamens.position.y = -0.004;
  dried.head.add(driedPod, driedStamens);
  root.add(dried.group);
  parts.seedPod = dried.group;
  parts.seedPodHead = dried.head;

  /* ---- 荷叶 ---- */
  const leafGroup = new THREE.Group();
  leafGroup.name = 'leaves';
  const leafGeoCache = new Map();
  let bigRadius = -1;
  LEAVES.forEach((spec) => {
    const key = spec.radius.toFixed(2);
    if (!leafGeoCache.has(key)) leafGeoCache.set(key, makeLeafGeometry({ radius: spec.radius }));
    const geo = leafGeoCache.get(key);

    const assembly = makeStemAssembly(
      new THREE.Vector3(spec.head.x * 0.25, STEM_BASE_Y + 0.04, spec.head.z * 0.25),
      new THREE.Vector3(spec.head.x * 0.75, spec.head.y - STEM_BASE_Y - 0.04, spec.head.z * 0.75),
      { radius: 0.0068, bend: spec.bend, partName: 'leaf', pickables }
    );

    const blade = new THREE.Mesh(geo, leafMaterial);
    blade.position.y = -0.012;
    blade.rotation.y = spec.spin;
    blade.rotation.x = spec.tilt;
    blade.castShadow = true;
    blade.receiveShadow = true;
    blade.userData.part = 'leaf';
    pickables.push(blade);
    if (spec.radius > bigRadius) { bigRadius = spec.radius; parts.bigLeaf = blade; }
    assembly.head.add(blade);
    leafGroup.add(assembly.group);
  });
  root.add(leafGroup);
  parts.leaf = leafGroup;

  /* ---- 泥里的藕，以及盖住它的那层泥 ---- */
  const rhizome = makeRhizome(pickables);
  root.add(rhizome);
  parts.rhizome = rhizome;
  parts.rhizomeAnchor = rhizome.userData.anchor;

  const mud = makeMudPatch();
  mud.userData.part = 'mud';
  pickables.push(mud);
  root.add(mud);
  parts.mud = mud;

  /* ---- 旁边那几株：只是把水面撑起来，不参与拾取 ---- */
  const companions = [];
  makeCompanions(parts, root, companions);

  /* 先把世界矩阵算出来：交互层要按世界坐标包围盒取景，
     否则拿到的还是各部件在自己局部坐标里的位置，取景会整体跑偏。 */
  root.updateMatrixWorld(true);

  return {
    root,
    parts,
    pickables,
    /** 被泥盖住时，藕本身不参与拾取，射线直接穿过去打到泥土上 */
    pickableNow() {
      return pickables.filter((m) => !m.userData.underMud || mudOpen);
    },
    setMudOpen(v, snap) {
      mudOpen = !!v;
      if (snap) {
        mudOpenT = mudOpen ? 1 : 0;
        MUD_DIG.uDig.value = mudOpenT;
      }
      return mudOpen;
    },
    get mudOpen() { return mudOpen; },
    /** 让每一件都在极慢的周期里轻微摆动，整株看上去是活的 */
    update(t) {
      /* 扒泥的进度：点下去不是硬切，而是慢慢把泥压下去 */
      const dt = Math.min(0.05, Math.max(0, t - lastT));
      lastT = t;
      const mudTarget = mudOpen ? 1 : 0;
      if (Math.abs(mudOpenT - mudTarget) > 0.0015) {
        mudOpenT += (mudTarget - mudOpenT) * Math.min(1, dt * 3.4);
      } else {
        mudOpenT = mudTarget;
      }
      MUD_DIG.uDig.value = mudOpenT * mudOpenT * (3 - 2 * mudOpenT);

      const s = Math.sin(t * 0.42);
      const c = Math.cos(t * 0.31);
      parts.flower.rotation.z = s * 0.010;
      parts.flower.rotation.x = c * 0.007;
      parts.bud.rotation.z = Math.sin(t * 0.37 + 1.1) * 0.013;
      parts.bud.rotation.x = Math.cos(t * 0.29 + 0.6) * 0.008;
      parts.seedPod.rotation.z = Math.sin(t * 0.45 + 2.2) * 0.012;
      parts.seedPod.rotation.x = Math.cos(t * 0.33 + 1.8) * 0.007;
      parts.leaf.children.forEach((assembly, i) => {
        assembly.rotation.z = Math.sin(t * 0.30 + i * 1.7) * 0.020;
        assembly.rotation.x = Math.cos(t * 0.24 + i * 1.1) * 0.013;
      });
      /* 旁边的莲整株轻轻摇：它们没有分部件，摇的是整丛 */
      companions.forEach((c, i) => {
        c.rotation.z = Math.sin(t * 0.28 + i * 2.1) * 0.009;
        c.rotation.x = Math.cos(t * 0.22 + i * 1.6) * 0.006;
      });
    }
  };
}
