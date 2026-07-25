import * as THREE from 'three';

/**
 * 클릭/호버 픽킹.
 * 배경 별(1만 개) 전체 + 별자리 노드를 검사한다. 배경 별은 각자 '고객의 소리'를 갖는다.
 */
export function createPicker(camera, domElement, starfield, nodePointsList) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const starPos = starfield.geometry.getAttribute('position');

  function setNdc(clientX, clientY) {
    const rect = domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  }

  function pick(clientX, clientY) {
    setNdc(clientX, clientY);
    // 픽킹 임계값을 zoom에 반비례시켜 확대해도 클릭 난이도가 일정하게 유지되도록.
    raycaster.params.Points.threshold = 22 / camera.zoom;
    raycaster.setFromCamera(ndc, camera);

    const hits = raycaster.intersectObjects([starfield, ...nodePointsList], false);
    if (hits.length === 0) return null;

    // 가장 가까운(화면상) 히트 선택
    hits.sort((a, b) => a.distanceToRay - b.distanceToRay);
    const hit = hits[0];

    if (hit.object === starfield) {
      const idx = hit.index;
      return {
        type: 'star',
        index: idx,
        worldPos: new THREE.Vector2(starPos.getX(idx), starPos.getY(idx)),
      };
    }

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

  return { pick };
}
