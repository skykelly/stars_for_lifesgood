import * as THREE from 'three';

// 화면 하단에 고정되는 '지상' 오버레이.
// 지구 곡률이 드러나는 곡선형 지평선 + 다크 그레이 지상 + 지평선 발광 그라데이션.
// 별밭을 렌더한 뒤 NDC 전체를 덮는 풀스크린 쿼드로 덧그린다.

const GROUND_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const GROUND_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uGroundEdge;   // 화면 가장자리에서 지상 상단 높이(0~1)
  uniform float uGroundBulge;  // 중앙 부풀림(지구 곡률)
  uniform float uGlowWidth;    // 지평선 발광 밴드 폭
  uniform vec3  uGroundTop;    // 지평선 근처 지상색
  uniform vec3  uGroundBottom; // 바닥 지상색
  uniform vec3  uGlowWarm;     // 림 근처 따뜻한 빛
  uniform vec3  uGlowCool;     // 위로 갈수록 차가운 빛

  const float PI = 3.14159265;

  void main() {
    // 지구 곡률: 중앙이 볼록한 완만한 돔 형태의 지평선
    float horizon = uGroundEdge + uGroundBulge * cos(PI * (vUv.x - 0.5));
    float d = vUv.y - horizon; // >0 하늘, <0 지상

    // 은은한 발광 호흡
    float breathe = 0.9 + 0.1 * sin(uTime * 0.6);

    // --- 지상 ---
    float groundT = clamp(vUv.y / max(horizon, 0.0001), 0.0, 1.0);
    vec3 groundCol = mix(uGroundBottom, uGroundTop, groundT);

    // 소프트한 경계(안티에일리어싱)
    float aa = 1.5 / uResolution.y;
    float groundAlpha = smoothstep(aa, -aa, d);

    // --- 지평선 발광(하늘 쪽으로 페이드) ---
    float glow = exp(-max(d, 0.0) / uGlowWidth) * breathe;
    // 지평선 바로 위는 따뜻하게, 더 위로는 차갑게
    vec3 glowCol = mix(uGlowWarm, uGlowCool, clamp(max(d, 0.0) / (uGlowWidth * 2.5), 0.0, 1.0));

    // 지상 상단 가장자리에도 살짝 빛이 걸치도록 림 라이트
    float rim = exp(-abs(d) / (uGlowWidth * 0.4)) * breathe;

    // --- 합성 ---
    vec3 color = groundCol + glowCol * rim * 0.35 * groundAlpha;
    float glowAlpha = clamp(glow * 0.75, 0.0, 1.0);
    color = mix(color, glowCol, glowAlpha * (1.0 - groundAlpha));
    float alpha = max(groundAlpha, glowAlpha);

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function createGround() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uTime: { value: 0 },
    uGroundEdge: { value: 0.11 },
    uGroundBulge: { value: 0.075 },
    uGlowWidth: { value: 0.09 },
    uGroundTop: { value: new THREE.Color(0x191c24) },
    uGroundBottom: { value: new THREE.Color(0x07080c) },
    uGlowWarm: { value: new THREE.Color(0xffe6c4) },
    uGlowCool: { value: new THREE.Color(0x9ec2ff) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: GROUND_VERTEX,
    fragmentShader: GROUND_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  function setResolution(w, h) {
    uniforms.uResolution.value.set(w, h);
  }

  return { scene, camera, material, uniforms, setResolution };
}
