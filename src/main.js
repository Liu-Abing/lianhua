/**
 * 装配与主循环。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { createSky, bakeEnvironment, createWater, createBottom, createDistant,
         applyUnderwaterAbsorption, SUN_DIR } from './env.js';
import { buildLotus } from './lotus.js';
import { createUI } from './ui.js';

const view = document.getElementById('view');

/* ---------------------------------------------------------------- 渲染器 */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/* 透射材质要额外渲染一张半分辨率的目标，减半能省很多 */
if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = 0.5;
view.appendChild(renderer.domElement);

/* ---------------------------------------------------------------- 场景 */

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.02, 900);

const sky = createSky();
scene.add(sky.mesh);
scene.environment = bakeEnvironment(renderer, sky.mesh);
if ('environmentIntensity' in scene) scene.environmentIntensity = 1.0;

/* 太阳 + 一点点天光补面，主光自然是天空烘出来的环境光 */
const sun = new THREE.DirectionalLight(0xfff2e0, 3.6);
sun.position.copy(SUN_DIR).multiplyScalar(7);
sun.target.position.set(0, 0.45, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1.0;
sun.shadow.camera.far = 16;
sun.shadow.camera.left = -2.0;
sun.shadow.camera.right = 2.0;
sun.shadow.camera.top = 2.4;
sun.shadow.camera.bottom = -1.6;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.022;
scene.add(sun, sun.target);

scene.add(new THREE.HemisphereLight(0xdcecff, 0x4a5a3a, 0.55));

/* ---------------------------------------------------------------- 环境与植株 */

const water = createWater({ size: 64, segments: 180 });
scene.add(water.surface);

const bottom = createBottom();
applyUnderwaterAbsorption(bottom.mesh.material, { color: '#1d5560', density: 0.34 });
scene.add(bottom.mesh, bottom.caustics);

scene.add(createDistant());

const lotus = buildLotus();
scene.add(lotus.root);

/* ---------------------------------------------------------------- 轨道控制 */

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
/* 必须能平移：轨道中心如果只钉在花上，水下泥里的藕根本够不到 */
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.panSpeed = 0.8;
controls.rotateSpeed = 0.72;
controls.zoomSpeed = 0.7;
controls.minDistance = 0.26;
controls.maxDistance = 14;
controls.minPolarAngle = 0.05;
controls.maxPolarAngle = Math.PI * 0.94;

/* 平移时把轨道中心关在一个盒子里：够得到水底的泥，但不至于把视线带到植株以外。
   只在 update 之后收一下，不改相机本身，所以不会跟阻尼打架。 */
const clampNum = (v, a, b) => (v < a ? a : (v > b ? b : v));
const TARGET_BOX = { x: 2.4, z: 2.4, yMin: -1.45, yMax: 0.95 };
function clampTarget() {
  const t = controls.target;
  t.x = clampNum(t.x, -TARGET_BOX.x, TARGET_BOX.x);
  t.z = clampNum(t.z, -TARGET_BOX.z, TARGET_BOX.z);
  t.y = clampNum(t.y, TARGET_BOX.yMin, TARGET_BOX.yMax);
}

/* ---------------------------------------------------------------- 后期 */

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.30, 0.72, 0.88
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------------------------------------------------------------- 交互 */

const ui = createUI({
  renderer, camera, controls, lotus,
  onDig() { return lotus.setMudOpen(!lotus.mudOpen); }
});

/* ---------------------------------------------------------------- 主循环 */

const clock = new THREE.Clock();
let time = 0;

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  time += dt;

  lotus.update(time);
  water.update(time);
  bottom.update(time);

  /* 天空球跟着相机走，这样地平线永远在无穷远 */
  sky.mesh.position.copy(camera.position);

  ui.update(dt);
  controls.update();
  clampTarget();

  /* 先渲一遍"没有水面"的场景，水面着色器要拿它做折射 */
  water.prepare(renderer, scene, camera);
  composer.render();

  requestAnimationFrame(frame);
}
frame();

/* ---------------------------------------------------------------- 尺寸 */

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
  water.resize(buf.x, buf.y, camera);
}
window.addEventListener('resize', resize);
resize();

/* ---------------------------------------------------------------- 开场影片 */

/* 遮罩和影片是一条接力：加载遮罩（那个"莲"字）一直挡在场景前面，等影片能出画了，
   影片先淡进来接棒，遮罩这才退场。
   反过来做就会先闪一下 3D 场景、影片再压上来——那正是"先看到后边的内容"的来由。 */
let revealScene = null;              /* 由下面的加载逻辑填上：把遮罩退掉、露出场景 */

const intro = (function () {
  const wrap = document.getElementById('intro');
  const video = document.getElementById('introVideo');
  const skip = document.getElementById('skip');
  let done = false, ready = false, started = false;

  /* 播完（或者被跳过、或者这个文件根本不在）就整块淡出，等淡完再从布局里摘掉 */
  const end = () => {
    if (done) return;
    done = true;
    video.pause();
    wrap.style.transitionDuration = '1.1s';   /* 退场要慢一点，才叫淡出 */
    wrap.classList.add('hidden');
    setTimeout(() => { wrap.style.display = 'none'; }, 1250);
    if (revealScene) revealScene();      /* 影片指望不上了，也得把场景放出来 */
  };

  const start = () => {
    if (done || started || !ready) return;
    started = true;
    /* 影片先在遮罩底下淡实（0.35 秒），这期间谁也看不到场景 */
    wrap.classList.remove('hidden');
    /* 等它实了，才一边撤遮罩一边开播：这样用户看到的是片头，不是闪一下场景再压上来的影片 */
    setTimeout(() => {
      video.play().catch(end);
      if (revealScene) revealScene();
    }, 420);
  };

  skip.addEventListener('click', end);
  video.addEventListener('ended', end);
  video.addEventListener('error', end);
  video.addEventListener('loadeddata', () => { ready = true; start(); });
  video.src = 'assets/intro.mp4';
  /* 兜底：文件迟迟读不出来就走开，别让遮罩一直挡着 */
  setTimeout(() => { if (!done && video.readyState < 2) end(); }, 3500);

  return { play: start };
})();

/* ---------------------------------------------------------------- 加载与直达 */

const hideLoader = () => {
  const el = document.getElementById('loader');
  if (el.dataset.done) return;
  el.dataset.done = '1';
  el.classList.add('hidden');
  setTimeout(() => { el.style.display = 'none'; }, 900);
};
/* 遮罩不再自己倒数退场，改由影片决定什么时候撤 */
revealScene = hideLoader;

window.__lotusReady = true;

/* 用 URL 片段直达某个视角：#petal / #pod / #leaf / #rhizome
   多个关键词用逗号连起来，例如 #rhizome,dig 表示先取藕的景、再把泥扒开 */
function applyHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  if (!raw) return;
  const tokens = raw.split(/[,+]/).filter(Boolean);
  if (tokens.indexOf('dig') >= 0) lotus.setMudOpen(true, true);
  tokens.forEach((k) => { if (k !== 'dig') ui.focus(k); });
}
applyHash();
window.addEventListener('hashchange', applyHash);
