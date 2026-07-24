import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { STAR_VERTEX, STAR_FRAGMENT } from './starfield.js';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// 굵고 은은하게 빛나는 별자리 선(fat line) 한 겹을 만든다.
// worldUnits=false → linewidth는 화면 픽셀 단위. resolution은 뷰포트 크기로 갱신 필요.
function makeGlowLine(geometry, color, linewidth, opacity) {
  const material = new LineMaterial({
    color: new THREE.Color(color),
    linewidth,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.resolution.set(window.innerWidth, window.innerHeight);
  material.userData.baseOpacity = opacity;
  const line = new LineSegments2(geometry, material);
  line.frustumCulled = false;
  line.userData.isConstellationLine = true;
  return { line, material };
}

// 별자리 이름/문구를 그린 텍스트 스프라이트를 만든다.
function makeLabel(constellation) {
  const canvas = document.createElement('canvas');
  const w = 512, h = 200;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.shadowColor = constellation.color;
  ctx.shadowBlur = 18;

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 60px "Noto Sans KR", system-ui, sans-serif';
  ctx.fillText(constellation.name, w / 2, 78);

  ctx.shadowBlur = 8;
  ctx.fillStyle = constellation.color;
  ctx.font = '500 34px "Noto Sans KR", system-ui, sans-serif';
  ctx.fillText(constellation.phrase, w / 2, 132);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(360, 140, 1);
  return sprite;
}

/**
 * 7개 별자리를 생성한다.
 * 반환: { group, lineMaterials, labels, nodePoints, nodeMeta }
 *  - group: 씬에 추가할 THREE.Group
 *  - lineMaterials/labels: 토글 시 opacity를 조절할 대상
 *  - nodePoints: 별자리 노드 별(Points) — 픽킹에 사용
 *  - nodeMeta: 노드 인덱스 → 소속 별자리 정보 매핑
 */
export function createConstellations(data, uniforms) {
  const group = new THREE.Group();
  const lineMaterials = [];
  const lineObjects = [];
  const labels = [];
  const scale = data.scale || 190;

  const list = data.constellations;
  const totalNodes = list.reduce((n, c) => n + c.nodes.length, 0);

  const positions = new Float32Array(totalNodes * 3);
  const colors = new Float32Array(totalNodes * 3);
  const sizes = new Float32Array(totalNodes);
  const phases = new Float32Array(totalNodes);
  const speeds = new Float32Array(totalNodes);
  const nodeMeta = [];

  let ni = 0;
  for (const c of list) {
    const [cx, cy] = c.center;
    const rgb = hexToRgb(c.color);
    const worldNodes = c.nodes.map(([nx, ny]) => [cx + nx * scale, cy + ny * scale]);

    // 연결선
    const linePositions = [];
    for (const [a, b] of c.edges) {
      linePositions.push(worldNodes[a][0], worldNodes[a][1], 0);
      linePositions.push(worldNodes[b][0], worldNodes[b][1], 0);
    }
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(linePositions);

    // 코어 색은 별자리 색을 흰색 쪽으로 밝혀 뜨거운 심지 느낌을 준다.
    const coreColor = new THREE.Color(c.color).lerp(new THREE.Color(0xffffff), 0.45);

    // 넓고 투명한 발광 헤일로 → 굵고 은은한 빛번짐
    const halo = makeGlowLine(lineGeo, c.color, 13.0, 0.16);
    // 가는 밝은 코어
    const core = makeGlowLine(lineGeo, coreColor, 4.0, 0.85);
    group.add(halo.line);
    group.add(core.line);
    lineMaterials.push(halo.material, core.material);
    lineObjects.push(halo.line, core.line);

    // 라벨 (별자리 상단)
    const ys = worldNodes.map((p) => p[1]);
    const topY = Math.max(...ys);
    const label = makeLabel(c);
    label.position.set(cx, topY + 120, 0);
    group.add(label);
    labels.push(label);

    // 노드 별 (배경 별보다 크고 밝게)
    for (const [wx, wy] of worldNodes) {
      positions[ni * 3 + 0] = wx;
      positions[ni * 3 + 1] = wy;
      positions[ni * 3 + 2] = 1;
      colors[ni * 3 + 0] = rgb[0];
      colors[ni * 3 + 1] = rgb[1];
      colors[ni * 3 + 2] = rgb[2];
      sizes[ni] = 9.0;
      phases[ni] = Math.random() * Math.PI * 2;
      speeds[ni] = 0.6 + Math.random() * 1.4;
      nodeMeta.push(c);
      ni++;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const nodeMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const nodePoints = new THREE.Points(geometry, nodeMaterial);
  nodePoints.frustumCulled = false;
  group.add(nodePoints);

  return { group, lineMaterials, lineObjects, labels, nodePoints, nodeMeta };
}
