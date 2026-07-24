import * as THREE from 'three';
import { createStarfield } from './starfield.js';
import { createConstellations } from './constellations.js';
import { createControls } from './controls.js';
import { createFeaturedStars, createPicker } from './picking.js';
import { createUI } from './ui.js';

const WORLD = 1600;          // 성도 반경
const STAR_COUNT = 10000;    // 배경 별 개수
const BASE_VIEW_HEIGHT = 2200;

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

  const scene = new THREE.Scene();

  // 직교 카메라 (2D 성도 탐험)
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = BASE_VIEW_HEIGHT / 2;
  const halfW = halfH * aspect;
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
  camera.position.set(0, 0, 100);

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
      ui.showMessage({ title: hit.name, message: hit.message, accent: '#ffd97a' });
    } else {
      ui.showMessage({
        title: hit.name,
        phrase: hit.phrase,
        message: hit.message,
        accent: hit.constellation.color,
      });
      controls.focusOn(hit.worldPos.x, hit.worldPos.y, 2.1);
    }
  });

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
    controls.clampCamera();
    renderer.setSize(window.innerWidth, window.innerHeight);
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

    // 별자리 선 / 라벨 페이드
    for (const m of cons.lineMaterials) m.opacity = 0.6 * constellationFactor;
    const labelOpacity = constellationFactor * labelFactor;
    for (const s of cons.labels) {
      s.material.opacity = labelOpacity;
      s.visible = labelOpacity > 0.02;
    }
    // 완전히 꺼진 별자리 선은 렌더 생략
    cons.group.children.forEach((c) => {
      if (c.type === 'LineSegments') c.visible = constellationFactor > 0.02;
    });

    renderer.render(scene, camera);
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
