/**
 * 화면 오버레이 UI: 토글 버튼 바(별자리·반짝임·Auto·뷰 리셋),
 * 별 옆에 뜨는 메시지 팝업, 조작 안내.
 */
export function createUI(handlers) {
  const state = {
    constellations: false, // Auto가 기본 On이라 별자리 수동 토글은 Off로 시작
    twinkle: true,
    auto: true,
  };

  const buttons = {};

  const bar = document.createElement('div');
  bar.className = 'control-bar';

  function makeToggle(key, label) {
    const btn = document.createElement('button');
    btn.className = 'toggle-btn' + (state[key] ? ' on' : '');
    btn.innerHTML = `<span class="dot"></span><span>${label}</span>`;
    btn.setAttribute('aria-pressed', String(state[key]));
    btn.addEventListener('click', () => {
      setToggle(key, !state[key]);
      handlers.onToggle?.(key, state[key]);
    });
    buttons[key] = btn;
    return btn;
  }

  // 외부(main)에서 버튼 상태를 프로그램적으로 바꾼다(핸들러는 호출하지 않음).
  function setToggle(key, value) {
    state[key] = value;
    const btn = buttons[key];
    if (btn) {
      btn.classList.toggle('on', value);
      btn.setAttribute('aria-pressed', String(value));
    }
  }

  bar.appendChild(makeToggle('constellations', '별자리'));
  bar.appendChild(makeToggle('twinkle', '반짝임'));
  bar.appendChild(makeToggle('auto', 'Auto'));

  const resetBtn = document.createElement('button');
  resetBtn.className = 'toggle-btn action';
  resetBtn.innerHTML = '<span>뷰 리셋</span>';
  resetBtn.addEventListener('click', () => handlers.onReset?.());
  bar.appendChild(resetBtn);

  document.body.appendChild(bar);

  // ---- 조작 안내 (좌상단) ----
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.innerHTML = `
    <div class="hint-title">별로 전하는 감사</div>
    <div class="hint-sub">스크롤·핀치로 줌 · 드래그로 이동 · 별을 눌러 메시지 보기</div>
  `;
  document.body.appendChild(hint);

  // ---- 호버 시 고객 이름 (글박스 없이 투명 텍스트) ----
  const hoverName = document.createElement('div');
  hoverName.className = 'hover-name';
  document.body.appendChild(hoverName);
  function showName(text, x, y) {
    hoverName.textContent = text;
    hoverName.style.left = `${x}px`;
    hoverName.style.top = `${y}px`;
    hoverName.classList.add('visible');
  }
  function hideName() {
    hoverName.classList.remove('visible');
  }

  // ---- 메시지 팝업 (별 옆에 뜸) ----
  const card = document.createElement('div');
  card.className = 'message-card';
  card.setAttribute('role', 'dialog');
  document.body.appendChild(card);
  let cardVisible = false;

  function showMessage({ title, phrase, message, accent, kicker }) {
    card.innerHTML = `
      <button class="card-close" aria-label="닫기">×</button>
      ${kicker ? `<div class="card-kicker">🎙 ${kicker}</div>` : ''}
      ${phrase ? `<div class="card-phrase">"${phrase}"</div>` : ''}
      <div class="card-message">${message}</div>
      <div class="card-title">— ${title}</div>
    `;
    if (accent) card.style.setProperty('--accent', accent);
    else card.style.removeProperty('--accent');
    card.classList.add('visible');
    cardVisible = true;
    card.querySelector('.card-close').addEventListener('click', hideMessage);
  }

  // 화면 좌표(ax,ay: 별의 위치) 옆에 팝업을 배치한다.
  function positionCard(ax, ay) {
    if (!cardVisible) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = card.offsetWidth || 260;
    const ch = card.offsetHeight || 120;
    const gap = 18;
    // 기본은 별 오른쪽. 오른쪽 공간이 부족하면 왼쪽에 배치.
    let left = ax + gap;
    if (left + cw > vw - 12) left = ax - gap - cw;
    left = Math.max(12, Math.min(left, vw - cw - 12));
    let top = ay - ch / 2;
    top = Math.max(12, Math.min(top, vh - ch - 12));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function hideMessage() {
    card.classList.remove('visible');
    cardVisible = false;
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cardVisible) hideMessage();
  });

  return { state, setToggle, showMessage, positionCard, hideMessage, isCardVisible: () => cardVisible, showName, hideName };
}
