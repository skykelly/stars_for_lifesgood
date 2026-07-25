import * as THREE from 'three';
import { STAR_VERTEX, STAR_FRAGMENT } from './starfield.js';

/**
 * 메시지를 가진 '특별한 별'(고객 감사글)을 Points로 생성한다.
 * 배경 별보다 크고 황금빛으로 도드라지게 한다.
 */
export function createFeaturedStars(featured, uniforms) {
  const count = featured.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = featured[i].x;
    positions[i * 3 + 1] = featured[i].y;
    positions[i * 3 + 2] = 2;
    // '고객의 목소리' 별은 더 크고 밝은 흰빛으로 도드라지게
    if (featured[i].voice) {
      colors[i * 3 + 0] = 1.0;
      colors[i * 3 + 1] = 0.96;
      colors[i * 3 + 2] = 0.82;
      sizes[i] = 15.0;
      speeds[i] = 1.0 + Math.random() * 1.0;
    } else {
      colors[i * 3 + 0] = 1.0;
      colors[i * 3 + 1] = 0.86;
      colors[i * 3 + 2] = 0.5;
      sizes[i] = 11.0;
      speeds[i] = 0.8 + Math.random() * 1.2;
    }
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

/**
 * 클릭/호버 픽킹. 작은 픽킹 대상(특별한 별 + 별자리 노드)만 검사하므로 저렴하다.
 */
export function createPicker(camera, domElement, featuredPoints, featuredData, nodePointsList) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function setNdc(clientX, clientY) {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  }

  function pick(clientX, clientY) {
    setNdc(clientX, clientY);
    // 픽킹 임계값을 zoom에 반비례시켜 확대해도 클릭 난이도가 일정하게 유지되도록.
    raycaster.params.Points.threshold = 26 / camera.zoom;
    raycaster.setFromCamera(ndc, camera);

    const hits = raycaster.intersectObjects([featuredPoints, ...nodePointsList], false);
    if (hits.length === 0) return null;

    // 가장 가까운(화면상) 히트 선택
    hits.sort((a, b) => a.distanceToRay - b.distanceToRay);
    const hit = hits[0];
    if (hit.object === featuredPoints) {
      const d = featuredData[hit.index];
      return {
        type: 'featured',
        name: d.name,
        message: d.message,
        voice: !!d.voice,
        worldPos: new THREE.Vector2(d.x, d.y),
      };
    } else {
      const c = hit.object.userData.constellation;
      return {
        type: 'constellation',
        index: hit.object.userData.index,
        name: `${c.name} · ${c.subtitle}`,
        phrase: c.phrase,
        message: c.message,
        constellation: c,
        worldPos: new THREE.Vector2(c.center[0], c.center[1]),
      };
    }
  }

  return { pick };
}
