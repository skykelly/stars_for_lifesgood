import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { STAR_VERTEX, STAR_FRAGMENT } from './starfield.js';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// 별자리 이름/문구를 그린 텍스트 스프라이트(작게)를 만든다.
function makeLabel(constellation) {
  const canvas = document.createElement('canvas');
  const w = 512, h = 200;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(255,255,255,0.6)';
  ctx.shadowBlur = 12;

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 46px "Noto Sans KR", system-ui, sans-serif';
  ctx.fillText(constellation.name, w / 2, 72);

  ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = '500 26px "Noto Sans KR", system-ui, sans-serif';
  ctx.fillText(constellation.phrase, w / 2, 118);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(232, 90, 1); // 더 작게
  return sprite;
}

// 얇고 은은하게 빛나는 선 한 겹(fat line). linewidth는 화면 픽셀 단위.
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
  return { line, material };
}

// 별자리 노드 별용 uniform: 시간/반짝임/줌은 공유 참조, uOpacity만 독립.
function nodeUniforms(shared) {
  return {
    uTime: shared.uTime,
    uTwinkle: shared.uTwinkle,
    uZoom: shared.uZoom,
    uPixelRatio: shared.uPixelRatio,
    uOpacity: { value: 1 },
  };
}

/**
 * 7개 별자리를 각각 독립 제어 가능한 형태로 생성한다.
 * 반환:
 *  - group: 씬에 추가할 THREE.Group
 *  - items: 별자리별 { index, data, lineMaterials, lineObjects, label, nodePoints, nodeUniforms }
 *  - lineMaterials: 전체 선 머티리얼(해상도 갱신용)
 *  - nodePointsList: 별자리별 노드 Points 배열(픽킹용, userData.constellation/index 포함)
 */
export function createConstellations(data, sharedUniforms) {
  const group = new THREE.Group();
  const scale = data.scale || 300;
  const list = data.constellations;

  const items = [];
  const lineMaterials = [];
  const nodePointsList = [];

  list.forEach((c, index) => {
    const [cx, cy] = c.center;
    const rgb = hexToRgb(c.color);
    const worldNodes = c.nodes.map(([nx, ny]) => [cx + nx * scale, cy + ny * scale]);

    // --- 연결선 (fat line, 얇고 은은) ---
    const linePositions = [];
    for (const [a, b] of c.edges) {
      linePositions.push(worldNodes[a][0], worldNodes[a][1], 0);
      linePositions.push(worldNodes[b][0], worldNodes[b][1], 0);
    }
    const lineGeo = new LineSegmentsGeometry();
    lineGeo.setPositions(linePositions);

    const coreColor = new THREE.Color(c.color).lerp(new THREE.Color(0xffffff), 0.45);
    // 선 투명도 ~50%: 코어 0.5 + 넓고 투명한 발광 헤일로
    const halo = makeGlowLine(lineGeo, c.color, 5.0, 0.22);
    const core = makeGlowLine(lineGeo, coreColor, 1.4, 0.5);
    group.add(halo.line, core.line);
    lineMaterials.push(halo.material, core.material);

    // --- 라벨 (별자리에 가깝게, 조금 아래로) ---
    const ys = worldNodes.map((p) => p[1]);
    const topY = Math.max(...ys);
    const label = makeLabel(c);
    label.position.set(cx, topY + 55, 0);
    group.add(label);

    // --- 노드 별 (별자리별 독립 Points + 독립 uOpacity) ---
    const n = worldNodes.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const phases = new Float32Array(n);
    const speeds = new Float32Array(n);
    worldNodes.forEach(([wx, wy], i) => {
      positions[i * 3 + 0] = wx;
      positions[i * 3 + 1] = wy;
      positions[i * 3 + 2] = 1;
      colors[i * 3 + 0] = rgb[0];
      colors[i * 3 + 1] = rgb[1];
      colors[i * 3 + 2] = rgb[2];
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
    const nodeMaterial = new THREE.ShaderMaterial({
      uniforms: nUniforms,
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nodePoints = new THREE.Points(geometry, nodeMaterial);
    nodePoints.frustumCulled = false;
    nodePoints.userData.constellation = c;
    nodePoints.userData.index = index;
    group.add(nodePoints);
    nodePointsList.push(nodePoints);

    items.push({
      index,
      data: c,
      lineMaterials: [halo.material, core.material],
      lineObjects: [halo.line, core.line],
      label,
      nodePoints,
      nodeUniforms: nUniforms,
    });
  });

  return { group, items, lineMaterials, nodePointsList };
}
