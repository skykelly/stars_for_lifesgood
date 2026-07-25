import * as THREE from 'three';
import { createStarfield } from './starfield.js';
import { createConstellations } from './constellations.js';
import { createControls } from './controls.js';
import { createFeaturedStars, createPicker } from './picking.js';
import { createGround } from './ground.js';
import { createUI } from './ui.js';

const WORLD = 1600;          // 성도 반경
const STAR_COUNT = 10000;    // 배경 별 개수
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

  // --- 배경 별 1만 개 ---
  const starfield = createStarfield(STAR_COUNT, WORLD, uniforms);
  scene.add(starfield);

  // --- 데이터 로드 ---
  const [constData, starsData] = await Promise.all([
    loadJSON('./data/constellations.json'),
    loadJSON('./data/stars.json'),
  ]);

  // --- 별자리 (별자리별 독립 제어) ---
  const cons = createConstellations(constData, uniforms);
  scene.add(cons.group);
  const nConst = cons.items.length;
  const constFactors = new Array(nConst).fill(0);

  // --- 특별한 별(고객의 소리) ---
  const featuredPoints = createFeaturedStars(starsData.featured, uniforms);
  scene.add(featuredPoints);

  // 각 featured 별 → 가장 가까운 별자리 인덱스 (Auto 모드에서 함께 표시)
  const featuredConstIndex = starsData.featured.map((s) => {
    let best = 0, bestD = Infinity;
    for (const it of cons.items) {
      const dx = s.x - it.data.center[0];
      const dy = s.y - it.data.center[1];
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = it.index; }
    }
    return best;
  });

  // --- 하단 지상(지구 곡률 지평선) ---
  const ground = createGround();

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

  function showPopupAt(worldX, worldY, opts) {
    activeAnchor = { x: worldX, y: worldY };
    ui.showMessage(opts);
    const p = worldToScreen(worldX, worldY);
    ui.positionCard(p.x, p.y);
  }
  function hidePopup() {
    ui.hideMessage();
    activeAnchor = null;
  }

  // --- Auto 시퀀스: 고객의 소리 팝업 + 해당 별자리를 하나씩 랜덤으로 2초간 ---
  let autoT1 = null, autoT2 = null, lastAutoIdx = -1;
  function clearAutoTimers() { clearTimeout(autoT1); clearTimeout(autoT2); autoT1 = autoT2 = null; }
  function autoStep() {
    if (!autoOn) return;
    const len = starsData.featured.length;
    let i;
    do { i = Math.floor(Math.random() * len); } while (len > 1 && i === lastAutoIdx);
    lastAutoIdx = i;
    const d = starsData.featured[i];
    autoActiveIdx = featuredConstIndex[i];
    showPopupAt(d.x, d.y, {
      title: d.name,
      message: d.message,
      accent: d.voice ? '#fff0c8' : '#ffd97a',
      kicker: d.voice ? '고객의 목소리' : null,
    });
    autoT1 = setTimeout(() => {
      if (!autoOn) return;
      hidePopup();
      autoActiveIdx = -1;          // 별자리도 함께 사라짐
      autoT2 = setTimeout(autoStep, 600);
    }, 2000);
  }
  function startAuto() { clearAutoTimers(); lastAutoIdx = -1; autoStep(); }
  function stopAuto() { clearAutoTimers(); autoActiveIdx = -1; hidePopup(); }

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
  });

  // --- 픽킹 ---
  const picker = createPicker(camera, canvas, featuredPoints, starsData.featured, cons.nodePointsList);

  // --- 컨트롤 ---
  const controls = createControls(camera, canvas, WORLD, (worldPoint, clientXY) => {
    const hit = picker.pick(clientXY.x, clientXY.y);
    if (!hit) { hidePopup(); return; }
    if (hit.type === 'featured') {
      showPopupAt(hit.worldPos.x, hit.worldPos.y, {
        title: hit.name,
        message: hit.message,
        accent: hit.voice ? '#fff0c8' : '#ffd97a',
        kicker: hit.voice ? '고객의 목소리' : null,
      });
    } else {
      showPopupAt(hit.worldPos.x, hit.worldPos.y, {
        title: hit.name,
        phrase: hit.phrase,
        message: hit.message,
        accent: '#ffffff',
      });
      controls.focusOn(hit.worldPos.x, hit.worldPos.y, Math.max(2.1, controls.minZoom * 1.7));
    }
  }, { minZoom: fitZoom, maxZoom: fitZoom * ZOOM_RANGE });

  // 호버 시 커서 변경 (작은 픽킹 대상만 검사 → 저렴)
  let hoverRaf = false;
  canvas.addEventListener('pointermove', (e) => {
    if (hoverRaf) return;
    hoverRaf = true;
    requestAnimationFrame(() => {
      hoverRaf = false;
      const hit = picker.pick(e.clientX, e.clientY);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
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

    // 별자리별 목표 팩터: 수동이면 전체 표시, Auto면 활성 하나만 표시
    const glowPulse = 0.8 + 0.2 * Math.sin(uniforms.uTime.value * 0.9);
    for (const it of cons.items) {
      let target = 0;
      if (manualConst) target = 1;
      else if (autoOn && it.index === autoActiveIdx) target = 1;
      constFactors[it.index] += (target - constFactors[it.index]) * Math.min(1, dt * 4);
      const f = constFactors[it.index];
      for (const m of it.lineMaterials) m.opacity = m.userData.baseOpacity * f * glowPulse;
      it.label.material.opacity = f;
      it.label.visible = f > 0.02;
      for (const line of it.lineObjects) line.visible = f > 0.02;
      it.nodeUniforms.uOpacity.value = f;
      it.nodePoints.visible = f > 0.02;
    }

    // 팝업이 별을 따라가도록(줌·팬 시)
    if (activeAnchor && ui.isCardVisible()) {
      const p = worldToScreen(activeAnchor.x, activeAnchor.y);
      ui.positionCard(p.x, p.y);
    }

    ground.uniforms.uTime.value += dt;

    renderer.clear();
    renderer.render(scene, camera);
    renderer.render(ground.scene, ground.camera);
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
