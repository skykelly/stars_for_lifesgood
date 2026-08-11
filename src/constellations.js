import * as THREE from 'three';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { STAR_VERTEX, STAR_FRAGMENT } from './starfield.js';

// 별자리 이름/문구를 그린 텍스트 스프라이트(작게). 라벨만 별자리 지정 색상.
function makeLabel(constellation) {
  const canvas = document.createElement('canvas');
  const w = 512, h = 200;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const color = constellation.color || '#ffffff';
  ctx.textAlign = 'center';
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;

  ctx.fillStyle = color;
  ctx.font = '700 46px "Noto Sans KR", system-ui, sans-serif';
  ctx.fillText(constellation.name, w / 2, 72);

  ctx.shadowBlur = 7;
  ctx.globalAlpha = 0.82;
  ctx.font = '500 26px "Noto Sans KR", system-ui, sans-serif';
  ctx.fillText(constellation.phrase, w / 2, 118);
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(232, 90, 1);
  return sprite;
}

// 엣지들을 연속된 획(폴리라인)들로 분해한다(그리기 순서).
function buildStrokes(nodes, edges) {
  const adj = nodes.map(() => []);
  edges.forEach(([a, b], ei) => { adj[a].push({ to: b, ei }); adj[b].push({ to: a, ei }); });
  const used = new Array(edges.length).fill(false);
  const degRemaining = (n) => adj[n].reduce((s, e) => s + (used[e.ei] ? 0 : 1), 0);
  const strokes = [];
  let remaining = edges.length;
  while (remaining > 0) {
    let start = -1;
    for (let n = 0; n < nodes.length; n++) if (degRemaining(n) % 2 === 1) { start = n; break; }
    if (start < 0) for (let n = 0; n < nodes.length; n++) if (degRemaining(n) > 0) { start = n; break; }
    if (start < 0) break;
    const seq = [start];
    let cur = start;
    for (;;) {
      const e = adj[cur].find((e) => !used[e.ei]);
      if (!e) break;
      used[e.ei] = true; remaining--;
      cur = e.to; seq.push(cur);
    }
    strokes.push(seq.map((i) => nodes[i]));
  }
  return strokes;
}

function cumulative(pts) {
  const c = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    c[i] = c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return c;
}

// dash로 진행 그리기가 가능한 얇은 발광 선 한 겹(fat line).
function makeStrokeLayer(geometry, color, linewidth, opacity) {
  const material = new LineMaterial({
    color: new THREE.Color(color),
    linewidth,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    dashed: true,
    dashSize: 0.001,   // 처음엔 거의 안 보임 → main에서 점점 키움
    gapSize: 1e9,      // 단일 대시(전체를 한 번에 채울 수 있게)
  });
  material.resolution.set(window.innerWidth, window.innerHeight);
  material.userData.baseOpacity = opacity;
  const line = new Line2(geometry, material);
  line.frustumCulled = false;
  return { line, material };
}

function nodeUniforms(shared) {
  return {
    uTime: shared.uTime, uTwinkle: shared.uTwinkle, uZoom: shared.uZoom,
    uPixelRatio: shared.uPixelRatio, uOpacity: { value: 0 },
  };
}

export function createConstellations(data, sharedUniforms) {
  const group = new THREE.Group();
  const scale = data.scale || 300;
  const list = data.constellations;

  const items = [];
  const lineMaterials = [];
  const nodePointsList = [];

  list.forEach((c, index) => {
    const [cx, cy] = c.center;
    const worldNodes = c.nodes.map(([nx, ny]) => [cx + nx * scale, cy + ny * scale]);

    // --- 연속 획 → Line2(halo/core) with dash reveal ---
    const strokeSeqs = buildStrokes(worldNodes, c.edges);
    const strokes = [];
    for (const pts of strokeSeqs) {
      const flat = [];
      for (const [x, y] of pts) flat.push(x, y, 0);
      const geo = new LineGeometry();
      geo.setPositions(flat);
      const cuml = cumulative(pts);
      const length = cuml[cuml.length - 1] || 1;
      const halo = makeStrokeLayer(geo, '#ffffff', 5.0, 0.22);
      const core = makeStrokeLayer(geo, '#ffffff', 1.4, 0.5);
      // dash용 라인 거리 계산(공유 지오메트리에 채워짐)
      halo.line.computeLineDistances();
      core.line.computeLineDistances();
      group.add(halo.line, core.line);
      lineMaterials.push(halo.material, core.material);
      strokes.push({ pts, cuml, length, halo, core });
    }

    // --- 라벨 ---
    const topY = Math.max(...worldNodes.map((p) => p[1]));
    const label = makeLabel(c);
    label.position.set(cx, topY + 55, 0);
    group.add(label);

    // --- 노드 별 (흰색, 별자리별 독립 uOpacity) ---
    const n = worldNodes.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const phases = new Float32Array(n);
    const speeds = new Float32Array(n);
    worldNodes.forEach(([wx, wy], i) => {
      positions[i * 3] = wx; positions[i * 3 + 1] = wy; positions[i * 3 + 2] = 1;
      colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;
      sizes[i] = 9.0;
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.6 + Math.random() * 1.4;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    const nUniforms = nodeUniforms(sharedUniforms);
    const nodePoints = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: nUniforms, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    nodePoints.frustumCulled = false;
    nodePoints.userData.constellation = c;
    nodePoints.userData.index = index;
    group.add(nodePoints);
    nodePointsList.push(nodePoints);

    // --- 그리는 끝점(tracer): 획마다 하나씩 빛나는 점 ---
    const tCount = strokes.length;
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tCount * 3), 3));
    tGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(tCount * 3).fill(1), 3));
    tGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(tCount).fill(22), 1));
    tGeo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(tCount), 1));
    tGeo.setAttribute('aSpeed', new THREE.BufferAttribute(new Float32Array(tCount), 1));
    const tUniforms = {
      uTime: sharedUniforms.uTime, uTwinkle: { value: 0 }, uZoom: sharedUniforms.uZoom,
      uPixelRatio: sharedUniforms.uPixelRatio, uOpacity: { value: 0 },
    };
    const tracer = new THREE.Points(tGeo, new THREE.ShaderMaterial({
      uniforms: tUniforms, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    tracer.frustumCulled = false;
    tracer.visible = false;
    group.add(tracer);

    items.push({
      index, data: c, strokes, label,
      lineMaterials: strokes.flatMap((s) => [s.halo.material, s.core.material]),
      lineObjects: strokes.flatMap((s) => [s.halo.line, s.core.line]),
      nodePoints, nodeUniforms: nUniforms,
      tracer, tracerUniforms: tUniforms,
      opacity: 0, drawT: 0, shown: false, tracerOpacity: 0,
    });
  });

  return { group, items, lineMaterials, nodePointsList };
}

// 획 위 arc-length L 지점의 좌표
export function pointAtLength(stroke, L) {
  const { pts, cuml, length } = stroke;
  if (L <= 0) return pts[0];
  if (L >= length) return pts[pts.length - 1];
  let i = 1;
  while (i < cuml.length && cuml[i] < L) i++;
  const seg = (cuml[i] - cuml[i - 1]) || 1;
  const t = (L - cuml[i - 1]) / seg;
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
}
