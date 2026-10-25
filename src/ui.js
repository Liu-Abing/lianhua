/**
 * 交互层。
 *
 * 点击不再推动镜头，只做两件事：让被点到的那一件摇一下、同时把说明面板推上来。
 * 观看角度完全交给你自己拖动（OrbitControls），想去哪看就去哪看。
 */

import * as THREE from 'three';

const COPY = {
  petal: {
    side: 'left',
    title: 'Lotus flowers',
    body: 'Lotus flowers are very beautiful. They have many colors. '
        + 'Lotus plants grow in lakes around the world. It is also a great plant to eat.'

  },
  pod: {
    side: 'left',
    title: 'Lotus seeds',
    body: 'Lotus seeds are small and round. We can cook and eat them in different ways.',
    image: 'assets/seed_dish.png'

  },
  leaf: {
    side: 'right',
    title: 'Lotus leaves',
    body: 'Lotus leaves are big, round and green. We can eat the young leaves. '
        + 'We can also cook rice in the leaves.',
    image: 'assets/leaf_dish.png'

  },
  rhizome: {
    side: 'right',
    title: 'Lotus roots',
    body: 'We eat lotus roots. The big brown and yellow roots are delicious. '
        + 'There are many ways to cook them.',
    image: 'assets/root_dish.png',
  }
};

/* 仅用于 URL 直达某个视角，点击不再触发镜头移动 */
const FRAMING = {
  petal:   { fit: 3.1, offset: -0.34, dir: new THREE.Vector3(0.52, 0.30, 1.0) },
  pod:     { fit: 7.0, offset: -0.34, dir: new THREE.Vector3(0.36, 0.40, 1.0) },
  leaf:    { fit: 2.9, offset:  0.34, dir: new THREE.Vector3(0.46, 0.52, 1.0) },
  rhizome: { fit: 3.9, offset:  0.34, dir: new THREE.Vector3(0.28, 0.62, 1.0) }
};

/* 全景 = 45° 俯角：相机从斜上方 45° 看下去，整株（花在上一头、泥里的藕在下一头）
   连水面一起收进画面，往下拖时不会先撞到边界。 */
const OVERVIEW = {
  position: new THREE.Vector3(1.36, 2.30, 1.95),
  target: new THREE.Vector3(0.02, -0.10, -0.05)
};

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createUI({ renderer, camera, controls, lotus, onDig }) {
  const dom = renderer.domElement;
  const panel = document.getElementById('panel');
  const panelTitle = document.getElementById('panelTitle');
  const panelBody = document.getElementById('panelBody');
  const panelImage = document.getElementById('panelImage');
  const hint = document.getElementById('hint');
  const backBtn = document.getElementById('back');

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const parts = lotus.parts;
  const swayGroups = new Set([parts.flower, parts.bud, parts.seedPod, ...parts.leaf.children]);

  let state = 'overview';
  let activePart = null;
  let tween = null;
  const springs = new Map();

  /* ---------------------------------------------------------- 取景（仅 URL 直达用） */

  function framingFor(part, object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.06) * 0.5;
    const cfg = FRAMING[part];
    const dir = cfg.dir.clone().normalize();
    const dist = radius * cfg.fit;

    const position = center.clone().addScaledVector(dir, dist);
    const target = center.clone();

    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const shift = right.multiplyScalar(cfg.offset * radius * 1.5);
    position.add(shift);
    target.add(shift);

    return { position, target };
  }

  function focusTargetFor(part, hitObject) {
    if (part === 'petal') return parts.flowerHead;
    if (part === 'pod') return hitObject || parts.seedPodHead || parts.podMesh;
    if (part === 'leaf') return hitObject || parts.bigLeaf;
    if (part === 'rhizome') return parts.rhizomeAnchor || parts.rhizome;
    return parts.flowerHead;
  }

  /* ---------------------------------------------------------- 面板 */

  function showPanel(data) {
    panelTitle.textContent = data.title;
    panelBody.textContent = data.body;
    /* 配图只在有的部位亮出来；没有的就别留个空框 */
    if (data.image) {
      if (panelImage.getAttribute('src') !== data.image) panelImage.src = data.image;
      panelImage.classList.remove('off');
    } else {
      panelImage.classList.add('off');
    }
    panel.dataset.side = data.side;
    panel.classList.remove('show');
    void panel.offsetWidth;
    panel.classList.add('show');
    backBtn.classList.add('show');
    hint.classList.add('hidden');
  }

  function hidePanel() {
    panel.classList.remove('show');
    backBtn.classList.remove('show');
    hint.classList.remove('hidden');
    activePart = null;
    state = 'overview';
  }

  /* 按钮写着"返回全景"，就得真的把镜头带回全景，不然下潜之后没有回头路 */
  function goOverview() {
    setDive(false);
    tween = {
      t: 0, duration: 0.85,
      fromPos: camera.position.clone(), toPos: OVERVIEW.position.clone(),
      fromTarget: controls.target.clone(), toTarget: OVERVIEW.target.clone()
    };
  }

  /* ---------------------------------------------------------- 摇动 */

  function kick(group, strength) {
    if (!group) return;
    if (!springs.has(group)) springs.set(group, { a: 0, v: 0, s: 0, sv: 0 });
    const s = springs.get(group);
    s.v += strength;
    s.sv += strength * 0.09;
  }

  /* 叠加在 lotus 每帧写好的空闲摆动之上，所以不会互相打架 */
  function updateSprings(dt) {
    springs.forEach((s, group) => {
      const settled = Math.abs(s.a) < 0.0004 && Math.abs(s.v) < 0.0008;
      if (settled) { s.a = 0; s.v = 0; }
      else {
        s.v += (-26 * s.a - 4.2 * s.v) * dt;
        s.a += s.v * dt;
        group.rotation.z += s.a;
      }

      const settledS = Math.abs(s.s) < 0.0003 && Math.abs(s.sv) < 0.0006;
      if (settledS) { s.s = 0; s.sv = 0; }
      else {
        s.sv += (-34 * s.s - 5.0 * s.sv) * dt;
        s.s += s.sv * dt;
        group.scale.setScalar(1 + s.s);
      }
    });
  }

  function findSwayGroup(object) {
    let p = object;
    while (p) {
      if (swayGroups.has(p)) return p;
      p = p.parent;
    }
    return null;
  }

  /* ---------------------------------------------------------- 点击：只动效，不推镜 */

  function reactTo(part, hitObject) {
    const object = hitObject || focusTargetFor(part, null);
    kick(findSwayGroup(object), 2.9);
    showPanel(COPY[part]);
    activePart = part;
    state = 'focused';
  }

  function jumpTo(part) {
    const object = focusTargetFor(part, null);
    if (!object) return;
    const view = framingFor(part, object);
    tween = null;
    camera.position.copy(view.position);
    controls.target.copy(view.target);
    controls.update();
    showPanel(COPY[part]);
    activePart = part;
    state = 'focused';
  }

  /* ---------------------------------------------------------- 拾取 */

  let downX = 0, downY = 0, downAt = 0;

  dom.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; downAt = performance.now();
  });

  dom.addEventListener('pointerup', (e) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    const elapsed = performance.now() - downAt;
    if (moved > 7 || elapsed > 520) return;   /* 那是拖动视角，不是点击 */

    const rect = dom.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    const hits = raycaster.intersectObjects(lotus.pickableNow(), false);
    if (!hits.length) { hidePanel(); return; }

    const part = hits[0].object.userData.part;
    if (!part) { hidePanel(); return; }

    if (part === 'mud') {
      /* 扒开就顺势把藕的说明推上来——跟点花瓣、莲蓬是同一套反馈；
         把泥盖回去的时候，卡片也跟着收起 */
      const opened = onDig ? onDig() : false;
      if (atBottom) hintText.innerHTML = hintDefault;   /* 已经扒开了，下水提示可以收了 */
      if (opened && COPY.rhizome) reactTo('rhizome', parts.rhizomeAnchor);
      else hidePanel();
      return;
    }
    if (!COPY[part]) return;
    reactTo(part, hits[0].object);
  });

  /* ---------------------------------------------------------- 收起说明 */

  let wheelAcc = 0, wheelLock = 0;
  window.addEventListener('wheel', (e) => {
    const now = performance.now();
    if (now < wheelLock) return;
    if (state === 'overview') return;      /* 全景时滚轮留给 OrbitControls 缩放 */
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 90) return;
    wheelAcc = 0;
    wheelLock = now + 620;
    hidePanel();
  }, { passive: true });

  backBtn.addEventListener('click', () => { hidePanel(); goOverview(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state === 'focused') hidePanel();
  });

  /* 底部这条提示兼作"上下潜"的开关：下水之后泥还盖着，藕要等你自己点泥土才露出来 */
  const hintText = hint.querySelector('span');
  const hintDefault = hintText.innerHTML;
  const goBtn = document.getElementById('goRhizome');
  const DIVE_HINT = '点一下<b>泥土</b>，把它扒开';
  let atBottom = false;

  function setDive(on) {
    atBottom = on;
    hintText.innerHTML = on ? DIVE_HINT : hintDefault;
    if (goBtn) goBtn.textContent = on ? '回到水面之上' : '直接去水底看藕';
  }

  if (goBtn) {
    goBtn.addEventListener('click', () => {
      if (atBottom) { goOverview(); return; }
      const object = focusTargetFor('rhizome', null);
      if (!object) return;
      const view = framingFor('rhizome', object);
      tween = {
        t: 0, duration: 0.9,
        fromPos: camera.position.clone(), toPos: view.position,
        fromTarget: controls.target.clone(), toTarget: view.target
      };
      setDive(true);
    });
  }

  /* ---------------------------------------------------------- 启动 */

  camera.position.copy(OVERVIEW.position);
  controls.target.copy(OVERVIEW.target);
  controls.update();

  return {
    update(dt) {
      if (tween) {
        tween.t = Math.min(1, tween.t + dt / tween.duration);
        const e = easeInOut(tween.t);
        camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
        if (tween.t >= 1) { tween = null; controls.update(); }
      }
      updateSprings(dt);
    },
    /** URL 片段直达某个视角 */
    focus(part) {
      if (COPY[part]) jumpTo(part);
    },
    get state() { return state; }
  };
}
