import * as THREE from 'three';
import { createStarfield, STAR_VERTEX, STAR_FRAGMENT } from './starfield.js';
import { createConstellations, pointAtLength } from './constellations.js';
import { createControls } from './controls.js';
import { createPicker } from './picking.js';
import { createGround } from './ground.js';
import { createUI } from './ui.js';
import { getVoice } from './voices.js';

// 북극성용 sparkle(✦) 프래그먼트: 둥근 코어 + 가로/세로 방향 미세한 광선
const POLARIS_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float core = exp(-d * d * 46.0);
    float sx = exp(-uv.y * uv.y * 560.0) * exp(-abs(uv.x) * 4.6);
    float sy = exp(-uv.x * uv.x * 560.0) * exp(-abs(uv.y) * 4.6);
    float halo = exp(-d * 7.0) * 0.2;
    float spike = (sx + sy) * (0.32 + 0.22 * vTw); // 아주 약간
    float a = (core + spike * 0.5 + halo) * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * (0.9 + 0.3 * vTw), clamp(a, 0.0, 1.0));
  }
`;

// slow-in / slow-out (easeInOutCubic)
function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

const WORLD = 1600;          // 성도 반경(탐색 경계)
const BASE_VIEW_HEIGHT = 2200;
const ZOOM_RANGE = 6;        // 최소 줌 대비 최대 확대 배율

// 화면 비율에 맞춰 성도가 화면을 '꽉 채우는' 최소 줌을 계산한다.
// 이 값이 초기 줌이자 최소 줌 → 축소는 불가, 확대만 가능.
function computeFitZoom(aspect) {
  return (BASE_VIEW_HEIGHT / 2) / WORLD * Math.max(aspect, 1);
}

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`데이터 로드 실패: ${path}`);
  return res.json();
}

async function init() {
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(0x02030a, 1);
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.autoClear = false; // 별밭 → 지상 오버레이 순서로 수동 렌더

  const scene = new THREE.Scene();

  // 직교 카메라 (2D 성도 탐험)
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = BASE_VIEW_HEIGHT / 2;
  const halfW = halfH * aspect;
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
  camera.position.set(0, 0, 100);
  // 초기 화면을 별로 꽉 채우고, 이 줌을 최소값으로 고정
  const fitZoom = computeFitZoom(aspect);
  camera.zoom = fitZoom;
  camera.updateProjectionMatrix();

  // 모든 별 셰이더가 공유하는 uniform (uOpacity=1: 배경/특별한 별은 항상 불투명)
  const uniforms = {
    uTime: { value: 0 },
    uTwinkle: { value: 1 },
    uZoom: { value: camera.zoom },
    uPixelRatio: { value: pixelRatio },
    uOpacity: { value: 1 },
  };

  // --- 배경 별 (북극성 중심 원반: 회전 시 스치는 전 영역을 채움) ---
  const POLARIS = { x: 640, y: 200 };
  const halfWv = (camera.right - camera.left) / 2 / camera.zoom;
  const halfHv = (camera.top - camera.bottom) / 2 / camera.zoom;
  let rMax = 0;
  for (const cxp of [halfWv, -halfWv]) {
    for (const cyp of [halfHv, -halfHv]) {
      rMax = Math.max(rMax, Math.hypot(cxp - POLARIS.x, cyp - POLARIS.y));
    }
  }
  const STAR_RADIUS = rMax * 1.12; // 여유
  const STAR_DENSITY = 10000 / (3200 * 3200); // 기존 밀도 유지
  const STAR_COUNT_DISK = Math.min(30000, Math.ceil(STAR_DENSITY * Math.PI * STAR_RADIUS * STAR_RADIUS));
  const starfield = createStarfield(STAR_COUNT_DISK, uniforms, POLARIS.x, POLARIS.y, STAR_RADIUS);
  scene.add(starfield);

  // --- 데이터 로드 ---
  const constData = await loadJSON('./data/constellations.json');

  // --- 별자리 (별자리별 독립 제어) ---
  const cons = createConstellations(constData, uniforms);
  scene.add(cons.group);

  // 임의 월드 좌표 → 가장 가까운 별자리 아이템(색상/인덱스)
  function nearestConst(x, y) {
    let best = cons.items[0], bestD = Infinity;
    for (const it of cons.items) {
      const dx = x - it.data.center[0];
      const dy = y - it.data.center[1];
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  // --- 클릭/Auto로 강조되는 별 (더 크게 + 별자리 지정 색상) ---
  const hlGeo = new THREE.BufferGeometry();
  hlGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  hlGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array([1, 1, 1]), 3));
  hlGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([26]), 1));
  hlGeo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array([0]), 1));
  hlGeo.setAttribute('aSpeed', new THREE.BufferAttribute(new Float32Array([0]), 1));
  const hlUniforms = {
    uTime: uniforms.uTime, uTwinkle: { value: 0 }, uZoom: uniforms.uZoom,
    uPixelRatio: uniforms.uPixelRatio, uOpacity: { value: 0 },
  };
  const highlight = new THREE.Points(hlGeo, new THREE.ShaderMaterial({
    uniforms: hlUniforms, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  highlight.frustumCulled = false;
  scene.add(highlight);
  let hlTarget = 0;
  const _hlColor = new THREE.Color();
  function setHighlight(x, y, colorHex) {
    const pos = hlGeo.getAttribute('position'); pos.setXYZ(0, x, y, 3); pos.needsUpdate = true;
    _hlColor.set(colorHex);
    const col = hlGeo.getAttribute('aColor'); col.setXYZ(0, _hlColor.r, _hlColor.g, _hlColor.b); col.needsUpdate = true;
    hlTarget = 1;
  }
  function clearHighlight() { hlTarget = 0; }

  // --- 북극성 (약한 sparkle 느낌 / 세로 2/5 지점) ---
  const polGeo = new THREE.BufferGeometry();
  polGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([POLARIS.x, POLARIS.y, 3]), 3));
  polGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array([1, 1, 1]), 3));
  polGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([28]), 1));
  polGeo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array([0]), 1));
  polGeo.setAttribute('aSpeed', new THREE.BufferAttribute(new Float32Array([1.0]), 1));
  const polUniforms = {
    uTime: uniforms.uTime, uTwinkle: { value: 0.4 }, uZoom: uniforms.uZoom,
    uPixelRatio: uniforms.uPixelRatio, uOpacity: { value: 1 },
  };
  const polaris = new THREE.Points(polGeo, new THREE.ShaderMaterial({
    uniforms: polUniforms, vertexShader: STAR_VERTEX, fragmentShader: POLARIS_FRAGMENT,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  polaris.frustumCulled = false;
  scene.add(polaris);
  function nearPolaris(clientX, clientY) {
    const p = worldToScreen(POLARIS.x, POLARIS.y);
    return Math.hypot(clientX - p.x, clientY - p.y) < 30;
  }

  // 별 전체를 북극성 중심으로 회전시키기 위한 피벗(회전 0에서는 항등 변환)
  const pivot = new THREE.Group();
  pivot.position.set(POLARIS.x, POLARIS.y, 0);
  const inner = new THREE.Group();
  inner.position.set(-POLARIS.x, -POLARIS.y, 0);
  pivot.add(inner);
  scene.add(pivot);
  inner.add(starfield, cons.group, highlight); // 북극성/지상은 제외(중심·오버레이)

  // --- 하단 지상(지구 곡률 지평선) ---
  const ground = createGround();

  // Auto 쇼케이스용: 지상 위 중앙 영역(잘 보이는 곳)의 별 인덱스 모음
  const _sfPos = starfield.geometry.getAttribute('position');
  const showcaseIdx = [];
  for (let i = 0; i < _sfPos.count; i++) {
    const x = _sfPos.getX(i), y = _sfPos.getY(i);
    if (x > -1350 && x < 1350 && y > -420 && y < 900) showcaseIdx.push(i);
  }

  // 월드 좌표 → 화면 픽셀
  const _v = new THREE.Vector3();
  function worldToScreen(x, y) {
    _v.set(x, y, 0).project(camera);
    return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight };
  }

  // --- 상태 ---
  let twinkleTarget = 1, twinkleFactor = 1;
  let manualConst = false;   // 별자리 수동 표시(전체)
  let autoOn = true;         // Auto 모드
  let autoActiveIdx = -1;    // Auto가 현재 보여주는 별자리 인덱스
  let activeAnchor = null;   // 팝업이 따라갈 월드 좌표 {x,y}

  // 별을 선택: 팝업 + 강조(더 크고 별자리 색상). 소속 별자리 인덱스 반환.
  function selectStar(worldX, worldY, opts) {
    const c = nearestConst(worldX, worldY);
    activeAnchor = { x: worldX, y: worldY };
    setHighlight(worldX, worldY, c.data.color);
    ui.showMessage({ ...opts, accent: c.data.color });
    const p = worldToScreen(worldX, worldY);
    ui.positionCard(p.x, p.y);
    return c.index;
  }
  function hidePopup() {
    ui.hideMessage();
    activeAnchor = null;
    clearHighlight();
  }

  // --- Auto 시퀀스: 고객의 소리 팝업 + 해당 별자리를 하나씩 랜덤으로 2초간 ---
  let autoT1 = null, autoT2 = null, lastAutoIdx = -1;
  function clearAutoTimers() { clearTimeout(autoT1); clearTimeout(autoT2); autoT1 = autoT2 = null; }
  function autoStep() {
    if (!autoOn || showcaseIdx.length === 0) return;
    let k;
    do { k = showcaseIdx[Math.floor(Math.random() * showcaseIdx.length)]; } while (showcaseIdx.length > 1 && k === lastAutoIdx);
    lastAutoIdx = k;
    const x = _sfPos.getX(k), y = _sfPos.getY(k);
    const v = getVoice(k);
    autoActiveIdx = selectStar(x, y, { title: v.name, message: v.message, kicker: '고객의 소리' });
    autoT1 = setTimeout(() => {
      if (!autoOn) return;
      hidePopup();
      autoActiveIdx = -1;          // 별자리도 함께 사라짐
      autoT2 = setTimeout(autoStep, 600);
    }, 2000);
  }
  function startAuto() { clearAutoTimers(); lastAutoIdx = -1; autoStep(); }
  function stopAuto() { clearAutoTimers(); autoActiveIdx = -1; hidePopup(); }

  // --- Life's Good 피날레: 북극성 중심 회전 + 장노출 궤적(거의 완전한 원) ---
  let trailMode = false, rotT = 0, holdT = 0, lgDelay = null;
  const ROT_DUR = 8.5, HOLD_DUR = 2.8, TURNS = 1.25; // 더 긴 장노출 + 원 완성/겹침
  function playLifesGood() {
    if (trailMode || lgDelay) return;
    autoOn = false; ui.setToggle('auto', false); stopAuto();
    manualConst = false; ui.setToggle('constellations', false);
    hidePopup();
    canvas.style.pointerEvents = 'none';   // 애니메이션 중 조작 차단
    // 1) 북극성 별 위에 'Life's Good' 텍스트(호버 효과와 동일)
    const p = worldToScreen(POLARIS.x, POLARIS.y);
    ui.showName("Life's Good", p.x, p.y, { brand: true });
    lgDelay = setTimeout(() => { lgDelay = null; startTrail(); }, 1000); // 2) 1초 후 회전
  }
  function startTrail() {
    trailMode = true; rotT = 0; holdT = 0;
    pivot.rotation.z = 0;
    renderer.clear(); // 한 번 지우고 이후 프레임은 누적(장노출 궤적)
  }
  function endTrail() {
    trailMode = false;
    pivot.rotation.z = 0;
    canvas.style.pointerEvents = '';
  }

  // --- UI ---
  const ui = createUI({
    onToggle: (key, value) => {
      if (key === 'twinkle') { twinkleTarget = value ? 1 : 0; return; }
      if (key === 'constellations') {
        manualConst = value;
        if (value && autoOn) { autoOn = false; ui.setToggle('auto', false); stopAuto(); }
        return;
      }
      if (key === 'auto') {
        autoOn = value;
        if (value) {
          manualConst = false;
          ui.setToggle('constellations', false);
          startAuto();
        } else {
          stopAuto();
        }
        return;
      }
    },
    onReset: () => controls.reset(),
    onLifesGood: () => playLifesGood(),
  });

  // --- 픽킹 (배경 별 전체 + 별자리 노드) ---
  const picker = createPicker(camera, canvas, starfield, cons.nodePointsList);

  // --- 컨트롤 ---
  const controls = createControls(camera, canvas, WORLD, (worldPoint, clientXY) => {
    if (trailMode) return;
    // 북극성은 클릭 효과 없음
    if (nearPolaris(clientXY.x, clientXY.y)) return;
    const hit = picker.pick(clientXY.x, clientXY.y);
    if (!hit) { hidePopup(); return; }
    if (hit.type === 'star') {
      // 모든 별 = 고객의 소리
      const v = getVoice(hit.index);
      selectStar(hit.worldPos.x, hit.worldPos.y, { title: v.name, message: v.message, kicker: '고객의 소리' });
    } else {
      // 별자리 노드: 테마 메시지 + 강조 + 포커스
      const c = hit.constellation;
      activeAnchor = { x: hit.worldPos.x, y: hit.worldPos.y };
      setHighlight(hit.worldPos.x, hit.worldPos.y, c.color);
      ui.showMessage({ title: hit.name, phrase: hit.phrase, message: hit.message, accent: c.color });
      const p = worldToScreen(hit.worldPos.x, hit.worldPos.y);
      ui.positionCard(p.x, p.y);
      controls.focusOn(hit.worldPos.x, hit.worldPos.y, Math.max(2.1, controls.minZoom * 1.7));
    }
  }, { minZoom: fitZoom, maxZoom: fitZoom * ZOOM_RANGE });

  // 호버: 고객 이름만 투명 텍스트로 표시(드래그 중엔 숨김)
  let isDown = false;
  canvas.addEventListener('pointerdown', () => { isDown = true; });
  window.addEventListener('pointerup', () => { isDown = false; });
  let hoverRaf = false;
  canvas.addEventListener('pointermove', (e) => {
    if (hoverRaf) return;
    hoverRaf = true;
    requestAnimationFrame(() => {
      hoverRaf = false;
      if (trailMode) return; // 피날레 중엔 북극성 위 텍스트 유지
      if (isDown) { ui.hideName(); return; }
      if (nearPolaris(e.clientX, e.clientY)) {
        const p = worldToScreen(POLARIS.x, POLARIS.y);
        ui.showName("Life's Good", p.x, p.y, { brand: true });
        canvas.style.cursor = 'pointer';
        return;
      }
      const hit = picker.pick(e.clientX, e.clientY);
      if (hit && hit.type === 'star') {
        const v = getVoice(hit.index);
        const p = worldToScreen(hit.worldPos.x, hit.worldPos.y);
        ui.showName(v.name, p.x, p.y);
        canvas.style.cursor = 'pointer';
      } else if (hit && hit.type === 'constellation') {
        const p = worldToScreen(hit.worldPos.x, hit.worldPos.y);
        ui.showName(hit.constellation.name, p.x, p.y);
        canvas.style.cursor = 'pointer';
      } else {
        ui.hideName();
        canvas.style.cursor = 'grab';
      }
    });
  });

  function onResize() {
    const a = window.innerWidth / window.innerHeight;
    const hh = BASE_VIEW_HEIGHT / 2;
    const hw = hh * a;
    camera.left = -hw;
    camera.right = hw;
    camera.top = hh;
    camera.bottom = -hh;
    camera.updateProjectionMatrix();
    // 새 비율에 맞춘 fit zoom으로 최소 줌 갱신(축소 불가 유지)
    const newFit = computeFitZoom(a);
    controls.setZoomLimits(newFit, newFit * ZOOM_RANGE);
    renderer.setSize(window.innerWidth, window.innerHeight);
    ground.setResolution(window.innerWidth, window.innerHeight);
    // fat line은 픽셀 단위 굵기 → 뷰포트 해상도 갱신 필요
    for (const m of cons.lineMaterials) m.resolution.set(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onResize);

  // --- 애니메이션 루프 ---
  const clock = new THREE.Clock();
  function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);
    controls.update(dt);

    twinkleFactor += (twinkleTarget - twinkleFactor) * Math.min(1, dt * 6);
    uniforms.uTime.value += dt;
    uniforms.uTwinkle.value = twinkleFactor;
    uniforms.uZoom.value = camera.zoom;

    // 별자리: 나타날 때 선을 점진적으로 그리고(끝점 발광), 사라질 땐 페이드아웃
    const glowPulse = 0.8 + 0.2 * Math.sin(uniforms.uTime.value * 0.9);
    const DRAW_DUR = 1.3; // 그리기 시간(초)
    for (const it of cons.items) {
      const shouldShow = manualConst || (autoOn && it.index === autoActiveIdx);
      if (shouldShow && !it.shown) { it.drawT = 0; it.shown = true; }
      if (!shouldShow) it.shown = false;
      if (shouldShow && it.drawT < 1) it.drawT = Math.min(1, it.drawT + dt / DRAW_DUR);

      // 표시 알파: 켜질 땐 빠르게 1, 꺼질 땐 부드럽게 0
      const oTarget = shouldShow ? 1 : 0;
      it.opacity += (oTarget - it.opacity) * Math.min(1, dt * (shouldShow ? 12 : 4));
      const vis = it.opacity > 0.02;

      // 선: dash로 진행 그리기 + 발광 호흡
      for (const s of it.strokes) {
        const dash = Math.max(1.5, it.drawT * s.length);
        s.halo.material.dashSize = dash;
        s.core.material.dashSize = dash;
        s.halo.material.opacity = s.halo.material.userData.baseOpacity * it.opacity * glowPulse;
        s.core.material.opacity = s.core.material.userData.baseOpacity * it.opacity * glowPulse;
        s.halo.line.visible = vis;
        s.core.line.visible = vis;
      }

      // 노드/라벨: 그리기 진행에 따라 서서히 밝아짐
      it.nodeUniforms.uOpacity.value = it.opacity * (0.15 + 0.85 * it.drawT);
      it.nodePoints.visible = vis;
      it.label.material.opacity = it.opacity * Math.max(0, (it.drawT - 0.35) / 0.65);
      it.label.visible = it.label.material.opacity > 0.02;

      // 그리는 끝점(tracer): 그리는 동안 각 획 끝에 빛나는 점
      const drawing = vis && it.drawT < 1;
      it.tracerOpacity += ((drawing ? 1 : 0) - it.tracerOpacity) * Math.min(1, dt * 12);
      it.tracerUniforms.uOpacity.value = it.tracerOpacity;
      it.tracer.visible = it.tracerOpacity > 0.02;
      if (it.tracer.visible) {
        const tp = it.tracer.geometry.getAttribute('position');
        it.strokes.forEach((s, si) => {
          const [x, y] = pointAtLength(s, it.drawT * s.length);
          tp.setXYZ(si, x, y, 4);
        });
        tp.needsUpdate = true;
      }
    }

    // 강조 별 페이드
    hlUniforms.uOpacity.value += (hlTarget - hlUniforms.uOpacity.value) * Math.min(1, dt * 8);
    highlight.visible = hlUniforms.uOpacity.value > 0.02;

    // 팝업이 별을 따라가도록(줌·팬 시)
    if (activeAnchor && ui.isCardVisible()) {
      const p = worldToScreen(activeAnchor.x, activeAnchor.y);
      ui.positionCard(p.x, p.y);
    }

    ground.uniforms.uTime.value += dt;

    if (trailMode) {
      // 북극성 중심 360° 회전(slow-in/out), 화면을 지우지 않고 별을 누적 → 장노출 궤적
      if (rotT < 1) {
        const start = rotT;
        const end = Math.min(1, rotT + dt / ROT_DUR);
        const angA = easeInOut(start) * Math.PI * 2 * TURNS;
        const angB = easeInOut(end) * Math.PI * 2 * TURNS;
        // 이번 프레임 회전각에 맞춰 sub-step 수를 적응적으로 (바깥 별도 끊김 없는 연속 라인)
        const subs = Math.max(2, Math.min(24, Math.ceil((Math.abs(angB - angA) * STAR_RADIUS) / 14)));
        for (let s = 1; s <= subs; s++) {
          pivot.rotation.z = angA + (angB - angA) * (s / subs);
          renderer.render(scene, camera);
        }
        rotT = end;
        if (rotT >= 1) { holdT = 0; ui.hideName(); } // 5) 텍스트 페이드아웃
      } else {
        holdT += dt;
        pivot.rotation.z = 0; // 2π ≡ 0 → 별이 시작 위치로 (궤적 위에 겹침)
        renderer.render(scene, camera);
        if (holdT >= HOLD_DUR) endTrail();
      }
      // 지상은 회전 중에도 계속 표시 (매 프레임 위에 합성)
      renderer.render(ground.scene, ground.camera);
    } else {
      renderer.clear();
      renderer.render(scene, camera);
      renderer.render(ground.scene, ground.camera);
    }
    requestAnimationFrame(animate);
  }
  animate();

  // 최초 화면: Auto On → 시퀀스 시작
  startAuto();
}

init().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#fff;font-family:sans-serif;text-align:center;padding:2rem;';
  el.textContent = '초기화 중 오류가 발생했습니다: ' + err.message;
  document.body.appendChild(el);
});
