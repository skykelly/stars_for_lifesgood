/**
 * 화면 오버레이 UI: 토글 버튼 바, 메시지 카드, 조작 안내.
 * 상태 변화는 콜백(handlers)으로 main에 전달한다.
 */
export function createUI(handlers) {
  const state = {
    constellations: true,
    twinkle: true,
    labels: true,
  };

  // ---- 컨트롤 바 ----
  const bar = document.createElement('div');
  bar.className = 'control-bar';

  function makeToggle(key, label) {
    const btn = document.createElement('button');
    btn.className = 'toggle-btn' + (state[key] ? ' on' : '');
    btn.innerHTML = `<span class="dot"></span><span>${label}</span>`;
    btn.setAttribute('aria-pressed', String(state[key]));
    btn.addEventListener('click', () => {
      state[key] = !state[key];
      btn.classList.toggle('on', state[key]);
      btn.setAttribute('aria-pressed', String(state[key]));
      handlers.onToggle?.(key, state[key]);
    });
    return btn;
  }

  bar.appendChild(makeToggle('constellations', '별자리'));
  bar.appendChild(makeToggle('twinkle', '반짝임'));
  bar.appendChild(makeToggle('labels', '라벨'));

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

  // ---- 메시지 카드 ----
  const card = document.createElement('div');
  card.className = 'message-card';
  card.setAttribute('role', 'dialog');
  document.body.appendChild(card);
  let cardVisible = false;

  function showMessage({ title, phrase, message, accent }) {
    card.innerHTML = `
      <button class="card-close" aria-label="닫기">×</button>
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

  function hideMessage() {
    card.classList.remove('visible');
    cardVisible = false;
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cardVisible) hideMessage();
  });

  return { state, showMessage, hideMessage, isCardVisible: () => cardVisible };
}
