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

  // 모든 별 셰이더가 공유하는 uniform
  const uniforms = {
    uTime: { value: 0 },
    uTwinkle: { value: 1 },
    uZoom: { value: camera.zoom },
    uPixelRatio: { value: pixelRatio },
  };

  // --- 배경 별 1만 개 ---
  const starfield = createStarfield(STAR_COUNT, WORLD, uniforms);
  scene.add(starfield);

  // --- 데이터 로드 ---
  const [constData, starsData] = await Promise.all([
    loadJSON('./data/constellations.json'),
    loadJSON('./data/stars.json'),
  ]);

  // --- 별자리 ---
  const cons = createConstellations(constData, uniforms);
  scene.add(cons.group);

  // --- 특별한 별(고객 감사글) ---
  const featuredPoints = createFeaturedStars(starsData.featured, uniforms);
  scene.add(featuredPoints);

  // --- 하단 지상(지구 곡률 지평선) ---
  const ground = createGround();

  // --- UI ---
  const ui = createUI({
    onToggle: (key, value) => {
      if (key === 'twinkle') twinkleTarget = value ? 1 : 0;
      if (key === 'constellations') constellationTarget = value ? 1 : 0;
      if (key === 'labels') labelTarget = value ? 1 : 0;
    },
    onReset: () => controls.reset(),
  });

  // --- 픽킹 ---
  const picker = createPicker(camera, canvas, featuredPoints, starsData.featured, cons.nodePoints, cons.nodeMeta);

  // --- 컨트롤 ---
  const controls = createControls(camera, canvas, WORLD, (worldPoint, clientXY) => {
    const hit = picker.pick(clientXY.x, clientXY.y);
    if (!hit) {
      ui.hideMessage();
      return;
    }
    if (hit.type === 'featured') {
      ui.showMessage({
        title: hit.name,
        message: hit.message,
        accent: hit.voice ? '#fff0c8' : '#ffd97a',
        kicker: hit.voice ? '고객의 목소리' : null,
      });
    } else {
      ui.showMessage({
        title: hit.name,
        phrase: hit.phrase,
        message: hit.message,
        accent: hit.constellation.color,
      });
      // 항상 확대 방향이 되도록 최소 줌보다 크게
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

  // --- 토글용 보간 상태 ---
  let twinkleTarget = 1, twinkleFactor = 1;
  let constellationTarget = 1, constellationFactor = 1;
  let labelTarget = 1, labelFactor = 1;

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

    // 부드러운 토글 보간
    twinkleFactor += (twinkleTarget - twinkleFactor) * Math.min(1, dt * 6);
    constellationFactor += (constellationTarget - constellationFactor) * Math.min(1, dt * 8);
    labelFactor += (labelTarget - labelFactor) * Math.min(1, dt * 8);

    uniforms.uTime.value += dt;
    uniforms.uTwinkle.value = twinkleFactor;
    uniforms.uZoom.value = camera.zoom;

    // 별자리 선 / 라벨 페이드 + 은은한 발광 호흡
    const glowPulse = 0.8 + 0.2 * Math.sin(uniforms.uTime.value * 0.9);
    for (const m of cons.lineMaterials) {
      m.opacity = m.userData.baseOpacity * constellationFactor * glowPulse;
    }
    const labelOpacity = constellationFactor * labelFactor;
    for (const s of cons.labels) {
      s.material.opacity = labelOpacity;
      s.visible = labelOpacity > 0.02;
    }
    // 완전히 꺼진 별자리 선은 렌더 생략
    for (const line of cons.lineObjects) line.visible = constellationFactor > 0.02;

    ground.uniforms.uTime.value += dt;

    renderer.clear();
    renderer.render(scene, camera);
    renderer.render(ground.scene, ground.camera);
    requestAnimationFrame(animate);
  }
  animate();
}

init().catch((err) => {
  console.error(err);
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#fff;font-family:sans-serif;text-align:center;padding:2rem;';
  el.textContent = '초기화 중 오류가 발생했습니다: ' + err.message;
  document.body.appendChild(el);
});
