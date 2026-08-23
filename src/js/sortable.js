// 끌어서 순서 바꾸기
//
// 무엇을 옮기는지는 여기서 모른다. 줄과 손잡이만 안다.
// 사업 목록이 쓰고 있고, 나중에 다른 목록이 생겨도 그대로 쓸 수 있다.
//
// 라이브러리를 들이지 않은 이유: 이 앱은 빌드가 없고, 목록은 길어야 열댓 줄이다.
// 필요한 것은 세 가지뿐이다 — 손끝을 따라오기, 절반 넘으면 자리 바꾸기, 키보드로도 되기.

const DEFAULTS = {
  itemSelector: '.sortrow',
  handleSelector: '.grip',
  draggingClass: 'is-dragging',
  sortingClass: 'is-sorting',
};

/**
 * @param {HTMLElement} box  줄들을 담고 있는 상자. 안이 다시 그려져도 이 요소는 그대로여야 한다.
 * @param {object} opts
 *   onReorder(ids)      끌어놓기가 끝나고 순서가 실제로 바뀌었을 때. ids 는 새 순서의 data-id 배열
 *   onStep(id, delta)   손잡이에 포커스를 두고 위(-1)/아래(+1) 화살표를 눌렀을 때
 * @returns {() => void}  걸어둔 것을 떼는 함수
 */
export function enableSort(box, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const { itemSelector, handleSelector, draggingClass, sortingClass } = cfg;

  let dragging = null;
  let startY = 0;
  let originalOrder = null;

  const ids = () => [...box.querySelectorAll(itemSelector)].map((r) => r.dataset.id);

  /** 자리를 내준 줄이 뚝 끊기지 않고 미끄러지게 한다 (FLIP) */
  const slide = (el, fromTop) => {
    const dy = fromTop - el.getBoundingClientRect().top;
    if (!dy) return;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
    void el.offsetHeight;        // 여기까지를 한 번 계산하게 한 뒤
    el.style.transition = '';    // CSS 전환에 맡긴다
    el.style.transform = '';
  };

  /** 이웃과 한 번 자리를 바꾼다. 바꿨으면 true. */
  const swapOnce = (clientY) => {
    const rect = dragging.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;

    // 이웃의 절반을 넘어섰는지 본다. 높이가 서로 달라도 되도록 실제 위치로 잰다.
    let neighbor = null;
    let putBefore = false;
    const prev = dragging.previousElementSibling;
    const next = dragging.nextElementSibling;

    if (prev) {
      const r = prev.getBoundingClientRect();
      if (mid < r.top + r.height / 2) { neighbor = prev; putBefore = true; }
    }
    if (!neighbor && next) {
      const r = next.getBoundingClientRect();
      if (mid > r.top + r.height / 2) { neighbor = next; putBefore = false; }
    }
    if (!neighbor) return false;

    const dragTop0 = rect.top;
    const nbTop0 = neighbor.getBoundingClientRect().top;

    box.insertBefore(dragging, putBefore ? neighbor : neighbor.nextElementSibling);

    // 자리를 바꾸면 잡은 줄의 제자리가 달라진다.
    // 그만큼 기준점을 옮겨야 화면에서는 손끝에 그대로 붙어 있다.
    // 이 보정이 없으면 자리를 바꿀 때마다 줄이 한 칸씩 튄다.
    startY += dragging.getBoundingClientRect().top - dragTop0;
    dragging.style.transform = `translateY(${clientY - startY}px)`;

    slide(neighbor, nbTop0);
    return true;
  };

  const onMove = (e) => {
    if (!dragging) return;
    dragging.style.transform = `translateY(${e.clientY - startY}px)`;

    // 빠르게 끌면 이동 신호가 띄엄띄엄 온다. 한 번에 여러 칸을 건너뛰어도
    // 따라잡도록 더 바꿀 것이 없을 때까지 반복한다.
    // 줄 수가 한계라 반드시 멈추지만, 만일을 위해 횟수를 막아둔다.
    let guard = box.children.length + 1;
    while (guard-- > 0 && swapOnce(e.clientY)) { /* 계속 */ }
  };

  const onUp = () => {
    if (!dragging) return;
    const row = dragging;
    dragging = null;

    row.style.transform = '';
    row.classList.remove(draggingClass);
    box.classList.remove(sortingClass);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);

    const now = ids();
    if (now.join() === originalOrder) return;   // 제자리로 돌아왔으면 저장하지 않는다
    cfg.onReorder?.(now);
  };

  const onDown = (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !box.contains(handle) || dragging) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    e.preventDefault();
    handle.focus();          // 놓은 뒤 곧바로 화살표로 이어서 옮길 수 있게

    dragging = handle.closest(itemSelector);
    startY = e.clientY;
    originalOrder = ids().join();
    dragging.classList.add(draggingClass);
    box.classList.add(sortingClass);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // 마우스를 쓰지 않아도 순서를 바꿀 수 있어야 한다
  const onKey = (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !box.contains(handle)) return;
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    cfg.onStep?.(handle.closest(itemSelector).dataset.id, delta);
  };

  box.addEventListener('pointerdown', onDown);
  box.addEventListener('keydown', onKey);

  return () => {
    box.removeEventListener('pointerdown', onDown);
    box.removeEventListener('keydown', onKey);
    onUp();
  };
}
