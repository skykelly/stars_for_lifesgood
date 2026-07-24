import * as THREE from 'three';

/**
 * 직교 카메라용 줌/팬 컨트롤.
 * - 휠: 커서 위치를 기준으로 줌
 * - 드래그: 팬
 * - 핀치(터치 2점): 줌 + 팬
 * - 짧게 누르면(움직임 임계값 이하) onTap(worldPoint, clientXY) 콜백
 * 카메라 이동은 성도 경계(±world) 안으로 클램프된다.
 */
export function createControls(camera, domElement, world, onTap) {
  const minZoom = 0.4;
  const maxZoom = 6.0;
  const dragThreshold = 6; // px

  let isPointerDown = false;
  let moved = 0;
  let lastX = 0, lastY = 0;
  const pointers = new Map();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;

  // tween 상태 (별자리로 부드럽게 이동)
  let tween = null;

  function clampCamera() {
    camera.zoom = THREE.MathUtils.clamp(camera.zoom, minZoom, maxZoom);
    const halfW = ((camera.right - camera.left) / 2) / camera.zoom;
    const halfH = ((camera.top - camera.bottom) / 2) / camera.zoom;
    const limitX = Math.max(0, world - halfW * 0.35);
    const limitY = Math.max(0, world - halfH * 0.35);
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -world - limitX, world + limitX);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, -world - limitY, world + limitY);
    camera.updateProjectionMatrix();
  }

  // 화면 좌표(px) → 월드 좌표
  function screenToWorld(clientX, clientY) {
    const rect = domElement.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const wx = camera.position.x + (nx * (camera.right - camera.left) / 2) / camera.zoom;
    const wy = camera.position.y + (ny * (camera.top - camera.bottom) / 2) / camera.zoom;
    return new THREE.Vector2(wx, wy);
  }

  function zoomAt(clientX, clientY, factor) {
    const before = screenToWorld(clientX, clientY);
    camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, minZoom, maxZoom);
    camera.updateProjectionMatrix();
    const after = screenToWorld(clientX, clientY);
    // 커서 아래 월드 지점이 고정되도록 카메라 위치 보정
    camera.position.x += before.x - after.x;
    camera.position.y += before.y - after.y;
    clampCamera();
  }

  function onWheel(e) {
    e.preventDefault();
    tween = null;
    const factor = Math.pow(0.998, e.deltaY);
    zoomAt(e.clientX, e.clientY, factor);
  }

  function onPointerDown(e) {
    tween = null;
    domElement.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    isPointerDown = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartZoom = camera.zoom;
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      if (pinchStartDist > 0) {
        const targetZoom = THREE.MathUtils.clamp(pinchStartZoom * (dist / pinchStartDist), minZoom, maxZoom);
        zoomAt(midX, midY, targetZoom / camera.zoom);
      }
      moved += 10;
      return;
    }

    if (!isPointerDown) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX;
    lastY = e.clientY;

    const worldPerPxX = (camera.right - camera.left) / camera.zoom / domElement.clientWidth;
    const worldPerPxY = (camera.top - camera.bottom) / camera.zoom / domElement.clientHeight;
    camera.position.x -= dx * worldPerPxX;
    camera.position.y += dy * worldPerPxY;
    clampCamera();
  }

  function onPointerUp(e) {
    const wasDown = isPointerDown;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = 0;
    if (pointers.size === 0) isPointerDown = false;

    if (wasDown && moved < dragThreshold && onTap) {
      onTap(screenToWorld(e.clientX, e.clientY), { x: e.clientX, y: e.clientY });
    }
  }

  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('pointercancel', onPointerUp);
  domElement.addEventListener('pointerleave', onPointerUp);

  // 특정 지점으로 부드럽게 이동 (별자리 포커스)
  function focusOn(x, y, targetZoom) {
    const from = { x: camera.position.x, y: camera.position.y, z: camera.zoom };
    const to = { x, y, z: targetZoom };
    tween = { from, to, t: 0, dur: 0.9 };
  }

  function reset() {
    focusOn(0, 0, 1.0);
  }

  // 매 프레임 tween 갱신
  function update(dt) {
    if (!tween) return;
    tween.t = Math.min(1, tween.t + dt / tween.dur);
    const e = tween.t;
    const k = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2; // easeInOutCubic
    camera.position.x = tween.from.x + (tween.to.x - tween.from.x) * k;
    camera.position.y = tween.from.y + (tween.to.y - tween.from.y) * k;
    camera.zoom = tween.from.z + (tween.to.z - tween.from.z) * k;
    clampCamera();
    if (tween.t >= 1) tween = null;
  }

  return { update, focusOn, reset, screenToWorld, clampCamera, get zoom() { return camera.zoom; } };
}
