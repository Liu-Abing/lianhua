/**
 * 环境层：天空、太阳、水面、水下水体、泥底、远景。
 *
 * 这里的每一件东西都是程序生成的，不依赖任何贴图文件。
 * 天空同时充当 IBL 环境光源：先把它单独渲染进一张 PMREM 贴图，
 * 材料的反射与漫反射环境光就都来自这个真实的天空，而不是打几个补光了事。
 */

import * as THREE from 'three';

/* 太阳方向：参考图里阳光来自右上方偏后 */
export const SUN_DIR = new THREE.Vector3(0.52, 0.44, -0.62).normalize();

export const WATER_LEVEL = 0;
export const BOTTOM_LEVEL = -1.15;

/* ---------------------------------------------------------------- 通用噪声 */

export function makeNoise2D(seed = 1) {
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  const grad = (h, x, y) => {
    const u = (h & 1) ? x : -x;
    const v = (h & 2) ? y : -y;
    return u + v;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  return function noise(x, y) {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
}

/* ---------------------------------------------------------------- 天空 */

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  varying vec3 vDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.55;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.07; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, -1.0, 1.0);

    float t = pow(clamp(up, 0.0, 1.0), 0.58);
    vec3 col = mix(uHorizon, uZenith, t);
    col = mix(col, uGround, smoothstep(0.01, -0.34, up));

    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, 900.0) * 7.0;
    col += uSunColor * pow(sd, 26.0) * 0.30;
    col += uSunColor * pow(sd, 4.0) * 0.055;

    if (up > 0.015) {
      vec2 uv = d.xz / max(up, 0.015) * 0.052;
      float n = fbm(uv * 1.5);
      float cover = smoothstep(0.55, 0.88, n);
      float fade = smoothstep(0.015, 0.42, up);
      vec3 cloudCol = mix(vec3(0.60, 0.66, 0.74), vec3(1.35, 1.32, 1.26),
                          smoothstep(0.52, 0.95, n));
      col = mix(col, cloudCol, cover * fade * 0.9);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky() {
  const uniforms = {
    uZenith:   { value: new THREE.Color('#2f6fc4') },
    uHorizon:  { value: new THREE.Color('#cfe3ef') },
    uGround:   { value: new THREE.Color('#93b4b8') },
    uSunColor: { value: new THREE.Color('#fff3dc') },
    uSunDir:   { value: SUN_DIR.clone() }
  };

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(420, 64, 40),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    })
  );
  mesh.name = 'sky';
  mesh.renderOrder = -1000;
  return { mesh, uniforms };
}

/** 把天空烘成环境贴图，供所有材料做反射与环境光 */
export function bakeEnvironment(renderer, skyMesh) {
  const stage = new THREE.Scene();
  /* 用替身而不是本体，免得把天空球从主场景里摘走 */
  const proxy = skyMesh.clone();
  proxy.position.set(0, 0, 0);
  stage.add(proxy);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(stage, 0.04, 1, 900);
  pmrem.dispose();
  return target.texture;
}

/* ---------------------------------------------------------------- 水面 */

/* 水面 = 一层"折射幕布"。
   官方那个 webgpu_backdrop_water 用的 WebGPURenderer 的 backdropNode（把水面背后的场景纹理
   连深度一起交给水面着色器），那是 WebGPU 渲染器独有的能力，WebGL 上搬不过来。
   这里用同等思路在 WebGL 里复刻：先把不含水面的场景渲进一张带深度纹理的渲染目标，
   水面着色器再对这张图做两件事——按波面法线偏移 UV 取样（折射），
   以及用深度差算出视线穿过水柱的长度做吸收。水越厚，透出来的东西越偏向水色，红光衰减最快。 */

const WATER_VERT = /* glsl */`
  uniform float uTime;
  uniform float uAmp;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vViewDist;

  float waterHeight(vec3 p) {
    float h = 0.0;
    h += sin(p.x * 1.7 + uTime * 0.85) * 0.50;
    h += sin(p.z * 2.3 - uTime * 0.62) * 0.42;
    h += sin((p.x + p.z) * 0.85 + uTime * 1.15) * 0.34;
    h += sin((p.x - p.z) * 3.1 + uTime * 1.55) * 0.18;
    /* 再叠一层短波：只为了把高光打碎成粼粼的光点 */
    h += sin(p.x * 7.3 - uTime * 2.10) * 0.075;
    h += sin(p.z * 8.7 + uTime * 2.45) * 0.065;
    return h;
  }
  vec3 waterNormal(vec3 p) {
    float dx = 0.0, dz = 0.0;
    dx += cos(p.x * 1.7 + uTime * 0.85) * 1.7 * 0.50;
    dz += cos(p.z * 2.3 - uTime * 0.62) * 2.3 * 0.42;
    float d34 = cos((p.x + p.z) * 0.85 + uTime * 1.15) * 0.85 * 0.34;
    dx += d34; dz += d34;
    float d18 = cos((p.x - p.z) * 3.1 + uTime * 1.55) * 3.1 * 0.18;
    dx += d18; dz -= d18;
    dx += cos(p.x * 7.3 - uTime * 2.10) * 7.3 * 0.075;
    dz += cos(p.z * 8.7 + uTime * 2.45) * 8.7 * 0.065;
    float s = uAmp * 7.0;
    return normalize(vec3(-dx * s, 1.0, -dz * s));
  }

  void main() {
    vec3 pos = position;
    pos.y += waterHeight(position) * uAmp;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorldPos = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vViewDist = -mv.z;
    vNormalW = normalize(mat3(modelMatrix) * waterNormal(position));
    gl_Position = projectionMatrix * mv;
  }
`;

const WATER_FRAG = /* glsl */`
  uniform sampler2D tScene;
  uniform sampler2D tSceneDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uRefract;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyZenith;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vViewDist;

  /* 深度纹理是非线性的，反解成到相机的实际距离 */
  float sceneDistance(vec2 uv) {
    float d = texture2D(tSceneDepth, uv).x;
    float viewZ = (uNear * uFar) / ((uFar - uNear) * d - uFar);
    return max(-viewZ, 0.0);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorldPos);

    float thickness = max(sceneDistance(uv) - vViewDist, 0.0);
    vec2 offset = N.xz * uRefract * clamp(thickness / 0.35, 0.0, 1.0);
    vec2 testUV = uv + offset;

    /* 若偏移后采到的东西比水面还近，说明那是水面上方的物体，不该被折射 */
    bool inside = testUV.x > 0.002 && testUV.x < 0.998 && testUV.y > 0.002 && testUV.y < 0.998;
    vec2 finalUV = (inside && sceneDistance(testUV) >= vViewDist) ? testUV : uv;

    float t = max(sceneDistance(finalUV) - vViewDist, 0.0);
    vec3 behind = texture2D(tScene, finalUV).rgb;

    /* 吸收：红光衰减最快，所以水一厚就整体偏青。
       系数要克制——参考图里的水是清的，给太狠水下就什么都看不见了。 */
    vec3 absorb = exp(-vec3(1.35, 0.58, 0.42) * t * 0.80);
    vec3 body = mix(uDeep, uShallow, exp(-t * 1.5));
    vec3 aquatic = behind * absorb + body * (1.0 - absorb);
    vec3 refracted = mix(behind, aquatic, step(0.0015, t));

    /* 掠射角反射天空。真实水面掠过时几乎全反，但全反会把水下挡干净，
       所以这里把强度压到六成，留出看进水里的余地。 */
    vec3 R = reflect(-V, N);
    float fres = clamp(0.02 + pow(1.0 - max(dot(N, V), 0.0), 5.0) * 0.62, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyZenith, clamp(R.y * 1.2, 0.0, 1.0));

    /* 太阳在水面上拉出一条光路。只用一个窄高光会变成一块干净的光斑，
       所以分成三层：宽的一层铺出水路，窄的一层给波峰，最尖的一层再用法线
       扰动打碎成一点点跳动的碎光。 */
    vec3 sunDir = normalize(uSunDir);
    vec3 H = normalize(V + sunDir);
    float ndh = max(dot(N, H), 0.0);
    float broad = pow(ndh, 24.0) * 0.10;
    float crest = pow(ndh, 260.0) * 2.6;
    float sparkle = pow(ndh, 1100.0) * 9.0
                  * (0.35 + 0.65 * abs(sin(vWorldPos.x * 41.0 + vWorldPos.z * 57.0)));
    vec3 sunPath = uSunColor * (broad + crest + sparkle);

    gl_FragColor = vec4(mix(refracted, sky, fres) + sunPath, 1.0);
  }
`;

export function createWater({ size = 64, segments = 180, scale = 0.5 } = {}) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const depthTexture = new THREE.DepthTexture(2, 2);
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;

  const target = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    depthTexture,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });
  target.texture.colorSpace = THREE.NoColorSpace;

  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.0095 },
    tScene: { value: target.texture },
    tSceneDepth: { value: depthTexture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.02 },
    uFar: { value: 900 },
    uRefract: { value: 0.085 },
    uSunDir: { value: SUN_DIR.clone() },
    uSunColor: { value: new THREE.Color('#fff0cc') },
    uShallow: { value: new THREE.Color('#4fa6a0') },
    uDeep: { value: new THREE.Color('#1b4a52') },
    uSkyHorizon: { value: new THREE.Color('#cfe3ef') },
    uSkyZenith: { value: new THREE.Color('#5f97d8') }
  };

  const surface = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true
  }));
  surface.name = 'waterSurface';

  return {
    surface,
    target,
    /** 尺寸变化时同步渲染目标与着色器里的分辨率 */
    resize(w, h, camera) {
      target.setSize(Math.max(2, Math.floor(w * scale)), Math.max(2, Math.floor(h * scale)));
      uniforms.uResolution.value.set(w, h);
      uniforms.uNear.value = camera.near;
      uniforms.uFar.value = camera.far;
    },
    /** 渲染折射用的背景：把水面藏起来先渲一遍 */
    prepare(renderer, scene, camera) {
      surface.visible = false;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
      surface.visible = true;
    },
    update(t) {
      uniforms.uTime.value = t;
    }
  };
}

/* ---------------------------------------------------------------- 水下吸收 */

/**
 * 给水下物体叠一层"水是介质"的处理：离相机越远越被水色吞掉。
 * 相机贴在水面时水面几乎是零像素，折射幕布起不到作用，
 * 这一层才是水下浑浊感的来源。
 */
export function applyUnderwaterAbsorption(material, { color = '#1f5a5c', density = 0.62, curve = 1.0 } = {}) {
  const uColor = { value: new THREE.Color(color) };
  const uDensity = { value: density };
  const uCurve = { value: curve };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAbsColor = uColor;
    shader.uniforms.uAbsDensity = uDensity;
    shader.uniforms.uAbsCurve = uCurve;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uAbsColor;
        uniform float uAbsDensity;
        uniform float uAbsCurve;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float absDist = length(vViewPosition);
        float absK = 1.0 - exp(-pow(absDist * uAbsDensity, uAbsCurve));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uAbsColor, clamp(absK, 0.0, 0.92));`);
  };
  material.customProgramCacheKey = () => `absorb_${color}_${density}_${curve}`;
  return material;
}

/* ---------------------------------------------------------------- 泥底 */

/** 淤泥表面：低频的深浅起伏，没有明显颗粒，所以看起来是软的 */
export function makeMudTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#948c66';
  g.fillRect(0, 0, s, s);

  const img = g.getImageData(0, 0, s, s);
  const n1 = makeNoise2D(23), n2 = makeNoise2D(91);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const v = (n1(x * 0.06, y * 0.06) * 0.5 + 0.5) * 0.62
              + (n2(x * 0.28, y * 0.28) * 0.5 + 0.5) * 0.38;
      const i = (y * s + x) * 4;
      img.data[i]     = 126 + v * 66;
      img.data[i + 1] = 120 + v * 60;
      img.data[i + 2] = 82 + v * 46;
    }
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createBottom() {
  const geo = new THREE.PlaneGeometry(34, 34, 110, 110);
  const pos = geo.attributes.position;
  const noise = makeNoise2D(7);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const n = noise(x * 0.11, y * 0.11) * 0.10
            + noise(x * 0.34, y * 0.34) * 0.045
            + noise(x * 0.9, y * 0.9) * 0.018;
    /* 植株根部那一小片压平：藕就躺在这一层里，泥面若还在起伏，
       不等挖开就会从盖住它的那层泥里顶出来。 */
    const flat = Math.min(1, Math.hypot(x, y) / 0.62);
    pos.setZ(i, n * flat * flat);
  }
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();

  const mudTexture = makeMudTexture();
  mudTexture.repeat.set(5, 5);

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: mudTexture,
      color: new THREE.Color('#b3ac86'),
      roughness: 0.96,
      metalness: 0.0
    })
  );
  mesh.position.y = BOTTOM_LEVEL;
  mesh.name = 'bottom';

  /* --- 水下光斑：贴在泥底上方的一层加色光网，缓慢游走 --- */
  const causticTexture = (() => {
    const s = 512;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const img = g.createImageData(s, s);
    const n = makeNoise2D(43);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        let v = 0.0, a = 0.5, f = 0.055;
        for (let o = 0; o < 4; o++) { v += n(x * f, y * f) * a; f *= 2.1; a *= 0.5; }
        const ridge = Math.pow(1.0 - Math.abs(v * 2.6), 6.0);
        const k = Math.max(0, ridge) * 255;
        const i = (y * s + x) * 4;
        img.data[i] = k * 0.72; img.data[i + 1] = k * 0.95; img.data[i + 2] = k;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    return tex;
  })();

  const caustics = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 34),
    new THREE.MeshBasicMaterial({
      map: causticTexture,
      transparent: true,
      opacity: 0.30,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    })
  );
  caustics.rotation.x = -Math.PI / 2;
  caustics.position.y = BOTTOM_LEVEL + 0.09;
  caustics.renderOrder = 6;

  return {
    mesh,
    caustics,
    update(t) {
      causticTexture.offset.set(t * 0.013, t * 0.009);
    }
  };
}

/* ---------------------------------------------------------------- 远景 */

/** 远处的树线与更远的水面浮叶：用已经很淡的颜色画进天空里，靠明度差拉开层次 */
export function createDistant() {
  const group = new THREE.Group();
  group.name = 'distant';

  const hazy = new THREE.Color('#8fb0a6');
  const hazyFar = new THREE.Color('#a8c3c6');

  const ridge = new THREE.Group();
  const rnd = (() => { let s = 5; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  for (let i = 0; i < 26; i++) {
    const r = 3.2 + rnd() * 5.5;
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({
        color: hazy.clone().lerp(hazyFar, rnd() * 0.55),
        fog: false
      })
    );
    const angle = -0.75 + rnd() * 2.4;
    const dist = 42 + rnd() * 16;
    blob.position.set(Math.sin(angle) * dist, 0.05 + rnd() * 0.55, -Math.cos(angle) * dist);
    blob.scale.set(r * 1.7, r * 0.42, r * 1.7);
    ridge.add(blob);
  }
  group.add(ridge);

  /* --- 远处水面上的浮叶 --- */
  const leafGeo = new THREE.CircleGeometry(1, 18);
  leafGeo.rotateX(-Math.PI / 2);
  const leafMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#79a887'), fog: false });
  const farLeaves = new THREE.InstancedMesh(leafGeo, leafMat, 90);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 90; i++) {
    const angle = rnd() * Math.PI * 2;
    const dist = 4.5 + rnd() * 26;
    dummy.position.set(Math.sin(angle) * dist, 0.012, -Math.cos(angle) * dist);
    const sc = 0.22 + rnd() * 0.36;
    dummy.scale.set(sc, 1, sc * (0.8 + rnd() * 0.4));
    dummy.rotation.y = rnd() * Math.PI;
    dummy.updateMatrix();
    farLeaves.setMatrixAt(i, dummy.matrix);
  }
  farLeaves.instanceMatrix.needsUpdate = true;
  group.add(farLeaves);

  return group;
}
