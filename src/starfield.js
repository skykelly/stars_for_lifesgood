import * as THREE from 'three';

// 별에서 사용하는 공통 셰이더. gl_PointSize를 카메라 zoom에 비례시켜
// 직교 카메라에서도 확대/축소 시 별 크기가 자연스럽게 따라오게 한다.
export const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uTwinkle;
  uniform float uZoom;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vColor = aColor;
    float tw = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
    vTw = mix(1.0, tw, uTwinkle);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float zoomScale = clamp(uZoom, 0.35, 3.5);
    gl_PointSize = aSize * uPixelRatio * zoomScale * (0.55 + 0.9 * vTw);
  }
`;

export const STAR_FRAGMENT = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float glow = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.22, 0.0, d);
    float alpha = glow * 0.45 + core * 0.75;
    alpha *= (0.3 + 0.7 * vTw);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * (0.55 + 0.7 * vTw), alpha);
  }
`;

// 흰색을 중심으로 청/미색으로 살짝 치우친 별 색을 만든다.
function starTint() {
  const r = Math.random();
  if (r < 0.55) return [1.0, 1.0, 1.0];            // 흰색
  if (r < 0.78) return [0.72, 0.82, 1.0];          // 푸른빛
  if (r < 0.93) return [1.0, 0.94, 0.8];           // 따뜻한빛
  return [1.0, 0.78, 0.72];                        // 붉은빛
}

/**
 * 1만 개의 배경 별을 THREE.Points 하나로 생성한다.
 * @param {number} count 별 개수
 * @param {number} world 성도 반경(±world 범위에 분포)
 * @param {object} uniforms 공유 uniform (uTime, uTwinkle, uZoom, uPixelRatio)
 */
export function createStarfield(count, world, uniforms) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() * 2 - 1) * world;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * world;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * 40; // 약간의 깊이감

    const tint = starTint();
    colors[i * 3 + 0] = tint[0];
    colors[i * 3 + 1] = tint[1];
    colors[i * 3 + 2] = tint[2];

    // 대부분 작은 별, 소수의 큰 별 (지수 분포 느낌)
    const s = Math.pow(Math.random(), 2.2);
    sizes[i] = 1.4 + s * 5.0;
    phases[i] = Math.random() * Math.PI * 2;
    speeds[i] = 0.4 + Math.random() * 2.2;
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
