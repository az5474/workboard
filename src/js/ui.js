// 공통 UI 조각: 아이콘 · 토스트 · 업무 행 · 편집 시트

import {
  state, todayStr, diffDays, projectById, isOverdue,
  toggleComplete, togglePin, patchTask, trashTask, restoreTask,
  patchProject, addProject, moveToToday as moveTaskToToday,
  PROJECT_COLORS, addTrip, patchTrip, removeTrip, safeUrl,
} from './store.js';

export const $ = (id) => document.getElementById(id);

// ---------- 아이콘 ----------
// index.html 의 스프라이트를 <use> 로 부른다. 이모지는 쓰지 않는다.

export function icon(name, cls = 'ico') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

/** 버튼 안에 아이콘 + 글자를 넣는다 */
function setLabel(button, iconName, text) {
  button.innerHTML = icon(iconName, 'ico ico-sm');
  button.append(document.createTextNode(text));
}

// ---------- 토스트 ----------

let toastTimer = null;
/** 가장 최근에 되돌릴 수 있는 동작. main.js 의 Ctrl+Z 가 집어간다. */
export let pendingUndo = null;

export function toast(message, action = null) {
  const el = $('toast');
  el.innerHTML = '';
  el.append(document.createTextNode(message));

  pendingUndo = null;

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    const run = async () => {
      hideToast();
      pendingUndo = null;
      try { await action.run(); } catch (e) { toast(e.message); }
    };
    btn.textContent = action.label;
    btn.addEventListener('click', run);
    el.appendChild(btn);

    // 마우스를 쓰지 않는 사람에게도 되돌릴 길을 남긴다
    const key = document.createElement('span');
    key.className = 'toast-key';
    key.textContent = 'Ctrl+Z';
    el.appendChild(key);

    pendingUndo = run;
  }

  el.classList.add('is-open');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2200);
}

function hideToast() {
  $('toast').classList.remove('is-open');
  pendingUndo = null;
}

// ---------- 라벨 ----------

export const PRIORITY_LABEL = { urgent: '긴급', high: '높음', normal: '보통' };
export const STATUS_LABEL = {
  todo: '진행 전',
  doing: '진행 중',
  internal_wait: '내부 확인 대기',
  external_wait: '외부 회신 대기',
  done: '완료',
};
const STATUS_TONE = { doing: 'doing', internal_wait: 'wait', external_wait: 'wait', done: 'done' };

function dueChip(task, today) {
  if (!task.due_date) return null;
  const d = diffDays(today, task.due_date);
  if (d === null) return null;
  if (d < 0)   return { cls: 'chip-overdue', text: `${Math.abs(d)}일 지남` };
  if (d === 0) return { cls: 'chip-overdue', text: '오늘 마감' };
  if (d === 1) return { cls: 'chip-due', text: '내일 마감' };
  if (d <= 6)  return { cls: 'chip-due', text: `${d}일 뒤` };
  return null;
}

// ---------- 업무 행 ----------

export function taskRow(task, { showProject = false, flat = false, trashed = false, moveToday = false } = {}) {
  const today = todayStr();
  const row = document.createElement('div');
  row.className = 'task';
  if (flat) row.classList.add('is-flat');
  if (task.completed) row.classList.add('is-done');
  if (isOverdue(task, today)) row.classList.add('is-overdue');
  row.dataset.id = task.id;

  if (trashed) {
    const restore = document.createElement('button');
    restore.className = 'btn btn-ghost btn-sm';
    setLabel(restore, 'undo', '복구');
    restore.addEventListener('click', async () => {
      try { await restoreTask(task.id); toast('업무를 복구했습니다'); }
      catch (e) { toast(e.message); }
    });
    const body = document.createElement('div');
    body.className = 'task-body';
    body.style.cursor = 'default';
    body.innerHTML = `<div class="task-title">${escapeHtml(task.title)}</div>`;
    row.append(body, restore);
    return row;
  }

  // 체크
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'task-check';
  check.checked = !!task.completed;
  check.setAttribute('aria-label', `${task.title || '업무'} 완료`);
  check.addEventListener('click', (e) => e.stopPropagation());
  check.addEventListener('change', async () => {
    try {
      const { undo } = await toggleComplete(task.id);
      if (task.completed) toast('완료했습니다', { label: '되돌리기', run: undo });
    } catch (e) {
      check.checked = !check.checked;
      toast(e.message);
    }
  });

  // 본문
  const body = document.createElement('div');
  body.className = 'task-body';
  body.setAttribute('role', 'button');
  body.tabIndex = 0;
  body.addEventListener('click', () => openTaskSheet(task.id));
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTaskSheet(task.id); }
  });

  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title || '제목 없는 업무';
  body.appendChild(title);

  // 칩은 최대 3개까지만 보여준다.
  // 넷 이상 붙으면 정작 제목이 안 읽힌다. 급한 신호부터 자리를 준다.
  const chips = [];

  if (showProject) {
    const p = projectById(task.project_id);
    if (p) chips.push({ rank: 0, html:
      `<span class="chip chip-project"><span class="pchip-dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</span>` });
  }

  const due = dueChip(task, today);
  if (due) chips.push({ rank: 1, html: `<span class="chip ${due.cls}">${due.text}</span>` });

  const carried = task.carried_count || 0;
  if (carried >= 5) {
    chips.push({ rank: 2, html:
      `<span class="chip chip-stuck" title="계속 밀리고 있습니다">${carried}회 밀림</span>` });
  }

  if (task.priority === 'urgent') chips.push({ rank: 3, html: '<span class="chip chip-urgent">긴급</span>' });
  else if (task.priority === 'high') chips.push({ rank: 4, html: '<span class="chip chip-high">높음</span>' });

  if (!task.completed && task.status && task.status !== 'todo' && task.status !== 'done') {
    const tone = STATUS_TONE[task.status] || 'doing';
    chips.push({ rank: 5, html: `<span class="chip chip-${tone}">${STATUS_LABEL[task.status]}</span>` });
  }

  if (carried > 0 && carried < 5) {
    chips.push({ rank: 9, html: `<span class="chip chip-carried" title="며칠째 미뤄졌는지">${carried}회 이월</span>` });
  }

  if (chips.length && !task.completed) {
    const tags = document.createElement('div');
    tags.className = 'task-tags';
    chips.sort((a, b) => a.rank - b.rank)
      .slice(0, 3)
      .forEach((c) => tags.insertAdjacentHTML('beforeend', c.html));
    body.appendChild(tags);
  }

  row.append(check, body);

  // 오늘 목록으로 끌어오기
  if (moveToday) {
    const move = document.createElement('button');
    move.className = 'btn btn-ghost btn-sm';
    move.style.flexShrink = '0';
    setLabel(move, 'today', '오늘로');
    move.addEventListener('click', async (e) => {
      e.stopPropagation();
      move.disabled = true;
      try { await moveTaskToToday(task.id); toast('오늘 목록으로 가져왔습니다'); }
      catch (err) { toast(err.message); move.disabled = false; }
    });
    row.appendChild(move);
  }

  // 핵심 고정
  const pin = document.createElement('button');
  pin.className = 'task-pin' + (task.pinned ? ' is-on' : '');
  pin.innerHTML = icon('star', task.pinned ? 'ico ico-sm ico-fill' : 'ico ico-sm');
  pin.title = task.pinned ? '핵심 고정 해제' : '오늘의 핵심 3에 고정';
  pin.setAttribute('aria-label', pin.title);
  pin.setAttribute('aria-pressed', String(!!task.pinned));
  pin.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await togglePin(task.id); } catch (err) { toast(err.message); }
  });

  row.appendChild(pin);
  return row;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 시트 ----------
//
// 시트가 떠 있는 동안 지켜야 할 것 세 가지.
//   1. Esc 로 닫힌다
//   2. Tab 이 시트 밖으로 새지 않는다
//   3. 닫으면 원래 있던 자리로 포커스가 돌아간다
// 그리고 뒷면은 스크롤되지 않는다 — 시트를 밀었는데 뒤가 움직이면 어지럽다.

let sheetKeydown = null;
let lastFocused = null;
let closeTimer = null;

const FOCUSABLE = 'button:not(:disabled), [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

function closeSheet() {
  const back = $('sheet-backdrop');
  if (!back.classList.contains('is-open')) return;

  back.classList.remove('is-open');
  document.body.classList.remove('is-locked');
  if (sheetKeydown) { document.removeEventListener('keydown', sheetKeydown, true); sheetKeydown = null; }

  // 나가는 동작이 끝난 뒤에 비운다. 바로 지우면 사라지는 게 아니라 툭 끊긴다.
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { back.innerHTML = ''; }, 280);

  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}

function buildSheet(title, bodyBuilder) {
  const back = $('sheet-backdrop');
  clearTimeout(closeTimer);
  back.innerHTML = '';
  lastFocused = document.activeElement;

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);

  sheet.innerHTML = '<div class="sheet-grab"></div>';

  const head = document.createElement('div');
  head.className = 'sheet-head';
  head.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
  const close = document.createElement('button');
  close.className = 'icon-btn';
  close.innerHTML = icon('close');
  close.setAttribute('aria-label', '닫기');
  close.title = '닫기 (Esc)';
  close.addEventListener('click', closeSheet);
  head.appendChild(close);
  sheet.appendChild(head);

  bodyBuilder(sheet);

  back.appendChild(sheet);
  document.body.classList.add('is-locked');

  // 브라우저가 처음 상태를 한 번 계산한 뒤에 열어야 올라오는 게 보인다.
  // requestAnimationFrame 은 창이 가려져 있으면 돌지 않아 시트가 안 열릴 수 있다.
  void back.offsetHeight;
  back.classList.add('is-open');

  back.onclick = (e) => { if (e.target === back) closeSheet(); };

  sheetKeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const items = [...sheet.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', sheetKeydown, true);

  // 첫 입력칸으로 바로 들어간다. 단, 폰에서는 키보드가 화면을 반쯤 덮어버려 하지 않는다.
  const focusFirst = window.matchMedia('(min-width: 768px)').matches;
  const target = focusFirst ? sheet.querySelector('input, textarea, select') : null;
  if (target) target.focus();
}

function optionRow(options, current, onPick, toneMap = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-row';
  Object.entries(options).forEach(([value, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt' + (value === current ? ' is-on' : '');
    if (toneMap[value]) b.dataset.tone = toneMap[value];
    b.textContent = label;
    b.setAttribute('aria-pressed', String(value === current));
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.opt').forEach((x) => {
        x.classList.remove('is-on');
        x.setAttribute('aria-pressed', 'false');
      });
      b.classList.add('is-on');
      b.setAttribute('aria-pressed', 'true');
      onPick(value);
    });
    wrap.appendChild(b);
  });
  return wrap;
}

function field(labelText, node) {
  const f = document.createElement('div');
  f.className = 'field';
  const id = node.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  node.id = id;
  f.innerHTML = `<label class="field-label" for="${id}">${escapeHtml(labelText)}</label>`;
  f.appendChild(node);
  return f;
}

/** 버튼 무리가 아니라 고르기 묶음일 때 (label 대신 제목만) */
function group(labelText, node) {
  const f = document.createElement('div');
  f.className = 'field';
  f.innerHTML = `<span class="field-label">${escapeHtml(labelText)}</span>`;
  f.appendChild(node);
  return f;
}

/** 업무 상세 편집 */
export function openTaskSheet(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;

  buildSheet('업무 상세', (sheet) => {
    const draft = {
      title: task.title,
      priority: task.priority,
      status: task.status,
      due_date: task.due_date || '',
      project_id: task.project_id,
      note: task.note || '',
      link: task.link || '',
    };

    // 제목
    const titleInput = document.createElement('textarea');
    titleInput.className = 'input';
    titleInput.rows = 2;
    titleInput.value = draft.title;
    titleInput.addEventListener('input', () => { draft.title = titleInput.value; });
    sheet.appendChild(field('업무명', titleInput));

    // 사업
    const projSel = document.createElement('select');
    projSel.className = 'input';
    state.projects.filter((p) => !p.archived).forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      if (p.id === draft.project_id) o.selected = true;
      projSel.appendChild(o);
    });
    projSel.addEventListener('change', () => { draft.project_id = projSel.value; });
    sheet.appendChild(field('사업', projSel));

    // 우선순위
    sheet.appendChild(group('우선순위', optionRow(
      PRIORITY_LABEL,
      draft.priority,
      (v) => { draft.priority = v; },
      { urgent: 'urgent', high: 'high' },
    )));

    // 상태
    sheet.appendChild(group('상태', optionRow(
      STATUS_LABEL, draft.status, (v) => { draft.status = v; },
      { doing: 'doing', internal_wait: 'wait', external_wait: 'wait', done: 'done' },
    )));

    // 마감일
    const dueInput = document.createElement('input');
    dueInput.type = 'date';
    dueInput.className = 'input';
    dueInput.value = draft.due_date;
    dueInput.addEventListener('change', () => { draft.due_date = dueInput.value; });
    sheet.appendChild(field('마감일', dueInput));

    // 메모
    const noteInput = document.createElement('textarea');
    noteInput.className = 'input';
    noteInput.rows = 3;
    noteInput.placeholder = '진행 상황, 협의 내용 등';
    noteInput.value = draft.note;
    noteInput.addEventListener('input', () => { draft.note = noteInput.value; });
    sheet.appendChild(field('메모', noteInput));

    // 링크
    const linkInput = document.createElement('input');
    linkInput.type = 'url';
    linkInput.className = 'input';
    linkInput.placeholder = '공유폴더, 신청폼, Zoom 링크 등';
    linkInput.value = draft.link;
    linkInput.addEventListener('input', () => { draft.link = linkInput.value; });
    sheet.appendChild(field('관련 링크', linkInput));

    if (task.carried_count > 0) {
      const info = document.createElement('div');
      info.className = 'notice notice-muted';
      info.textContent = `${task.carried_count}회 이월된 업무입니다. 계속 밀린다면 쪼개거나 넘기는 것도 방법입니다.`;
      sheet.appendChild(info);
    }

    // 동작
    const save = document.createElement('button');
    save.className = 'btn btn-cta grow';
    save.textContent = '저장';
    const doSave = async () => {
      if (save.disabled) return;
      save.disabled = true;
      try {
        await patchTask(task.id, {
          title: draft.title.trim() || '제목 없는 업무',
          priority: draft.priority,
          status: draft.status,
          completed: draft.status === 'done',
          due_date: draft.due_date || null,
          project_id: draft.project_id,
          note: draft.note,
          link: draft.link,
        });
        closeSheet();
        toast('저장했습니다');
      } catch (e) {
        toast(e.message);
        save.disabled = false;
      }
    };
    save.addEventListener('click', doSave);

    // 글을 쓰다가 손을 떼지 않고 저장할 수 있게
    sheet.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doSave(); }
    });

    const del = document.createElement('button');
    del.className = 'btn btn-ghost btn-danger';
    setLabel(del, 'trash', '삭제');
    del.addEventListener('click', async () => {
      try {
        const { undo } = await trashTask(task.id);
        closeSheet();
        toast('휴지통으로 옮겼습니다', { label: '되돌리기', run: undo });
      } catch (e) { toast(e.message); }
    });

    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    actions.append(save, del);
    sheet.appendChild(actions);

    // 열 수 있는 주소일 때만 버튼을 만든다.
    // href 에 아무 문자열이나 넣으면 javascript: 같은 것이 이 페이지 권한으로 실행된다.
    if (draft.link) {
      const href = safeUrl(draft.link);
      if (href) {
        const open = document.createElement('a');
        open.className = 'btn btn-secondary btn-block';
        open.href = href;
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.textContent = '관련 링크 열기';
        sheet.appendChild(open);
      } else {
        const warn = document.createElement('div');
        warn.className = 'notice notice-muted';
        warn.textContent = '이 링크는 열 수 없는 주소입니다. http:// 또는 https:// 로 시작해야 합니다.';
        sheet.appendChild(warn);
      }
    }
  });
}

/**
 * 출장 추가/수정
 * startDate 를 주면 새 출장의 시작일이 그 날로 잡힌다 (달력에서 날짜를 눌러 들어올 때).
 */
export function openTripSheet(tripId = null, { startDate = null } = {}) {
  const trip = tripId ? state.trips.find((t) => t.id === tripId) : null;

  buildSheet(trip ? '출장 상세' : '새 출장', (sheet) => {
    const start = trip?.start_date || startDate || todayStr();
    const draft = {
      title: trip?.title ?? '',
      start_date: start,
      end_date: trip?.end_date || start,
      location: trip?.location ?? '',
      project_id: trip?.project_id ?? '',
      note: trip?.note ?? '',
    };

    const titleInput = document.createElement('input');
    titleInput.className = 'input';
    titleInput.placeholder = '예: 완주군 사전답사';
    titleInput.value = draft.title;
    titleInput.addEventListener('input', () => { draft.title = titleInput.value; });
    sheet.appendChild(field('출장명', titleInput));

    // 기간 — 두 칸을 나란히 둔다. 따로 떨어뜨리면 며칠짜리인지 감이 안 온다.
    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.className = 'input';
    startInput.value = draft.start_date;

    const endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.className = 'input';
    endInput.value = draft.end_date;

    const span = document.createElement('div');
    span.className = 'field-hint';
    const paintSpan = () => {
      const n = (diffDays(draft.start_date, draft.end_date) ?? 0) + 1;
      span.textContent = n === 1 ? '당일치기' : `${n}일 (${n - 1}박)`;
    };

    startInput.addEventListener('change', () => {
      draft.start_date = startInput.value || todayStr();
      // 시작일을 뒤로 밀면 종료일도 따라간다. 거꾸로 된 기간은 만들지 않는다.
      if (draft.end_date < draft.start_date) {
        draft.end_date = draft.start_date;
        endInput.value = draft.end_date;
      }
      endInput.min = draft.start_date;
      paintSpan();
    });
    endInput.addEventListener('change', () => {
      draft.end_date = endInput.value || draft.start_date;
      if (draft.end_date < draft.start_date) {
        draft.end_date = draft.start_date;
        endInput.value = draft.end_date;
      }
      paintSpan();
    });
    endInput.min = draft.start_date;

    const range = document.createElement('div');
    range.className = 'trip-range';
    range.append(startInput, Object.assign(document.createElement('span'), {
      className: 'trip-range-sep', textContent: '~',
    }), endInput);

    sheet.appendChild(group('기간', range));
    paintSpan();
    sheet.appendChild(span);

    const placeInput = document.createElement('input');
    placeInput.className = 'input';
    placeInput.placeholder = '예: 전북 완주군청';
    placeInput.value = draft.location;
    placeInput.addEventListener('input', () => { draft.location = placeInput.value; });
    sheet.appendChild(field('장소', placeInput));

    // 사업 — 안 고를 수도 있다. 사업과 무관한 출장도 있다.
    const projSel = document.createElement('select');
    projSel.className = 'input';
    const none = document.createElement('option');
    none.value = ''; none.textContent = '사업 없음';
    projSel.appendChild(none);
    state.projects.filter((p) => !p.archived).forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      if (p.id === draft.project_id) o.selected = true;
      projSel.appendChild(o);
    });
    projSel.value = draft.project_id || '';
    projSel.addEventListener('change', () => { draft.project_id = projSel.value; });
    const projField = field('사업', projSel);
    projField.appendChild(Object.assign(document.createElement('span'), {
      className: 'field-hint', textContent: '사업을 고르면 달력에서 그 사업 색으로 그려집니다.',
    }));
    sheet.appendChild(projField);

    const noteInput = document.createElement('textarea');
    noteInput.className = 'input';
    noteInput.rows = 2;
    noteInput.placeholder = '이동 수단, 동행, 준비물 등';
    noteInput.value = draft.note;
    noteInput.addEventListener('input', () => { draft.note = noteInput.value; });
    sheet.appendChild(field('메모', noteInput));

    const save = document.createElement('button');
    save.className = 'btn btn-cta grow';
    save.textContent = trip ? '저장' : '출장 추가';
    const doSave = async () => {
      if (save.disabled) return;
      if (!draft.title.trim()) { titleInput.focus(); return; }
      save.disabled = true;
      try {
        if (trip) {
          await patchTrip(trip.id, {
            title: draft.title.trim(),
            start_date: draft.start_date,
            end_date: draft.end_date,
            location: draft.location.trim(),
            project_id: draft.project_id || null,
            note: draft.note,
          });
          toast('저장했습니다');
        } else {
          await addTrip({
            title: draft.title,
            startDate: draft.start_date,
            endDate: draft.end_date,
            location: draft.location,
            projectId: draft.project_id || null,
            note: draft.note,
          });
          toast('출장을 추가했습니다');
        }
        closeSheet();
      } catch (e) {
        toast(e.message);
        save.disabled = false;
      }
    };
    save.addEventListener('click', doSave);
    sheet.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doSave(); }
    });

    const actions = document.createElement('div');
    actions.className = 'sheet-actions';
    actions.appendChild(save);

    if (trip) {
      const del = document.createElement('button');
      del.className = 'btn btn-ghost btn-danger';
      setLabel(del, 'trash', '삭제');
      del.addEventListener('click', async () => {
        try {
          const { undo } = await removeTrip(trip.id);
          closeSheet();
          // 출장은 휴지통이 없다. 되돌릴 기회는 이 5초뿐이라는 걸 문구로 알린다.
          toast('출장을 지웠습니다', { label: '되돌리기', run: undo });
        } catch (e) { toast(e.message); }
      });
      actions.appendChild(del);
    }
    sheet.appendChild(actions);
  });
}

/** 사업 추가/수정 */
export function openProjectSheet(projectId = null) {
  const project = projectId ? projectById(projectId) : null;

  buildSheet(project ? '사업 정보 수정' : '새 사업 추가', (sheet) => {
    const draft = {
      name: project?.name ?? '',
      color: project?.color ?? PROJECT_COLORS[4],
      archived: project?.archived ?? false,
    };

    const nameInput = document.createElement('input');
    nameInput.className = 'input';
    nameInput.placeholder = '예: 2026 청소년 진로캠프';
    nameInput.value = draft.name;
    nameInput.addEventListener('input', () => { draft.name = nameInput.value; });
    sheet.appendChild(field('사업명', nameInput));

    // 지금 쓰고 있는 색이 새 팔레트에 없으면 맨 앞에 남겨둔다.
    // 색을 새로 고르는 것은 사용자가 정할 일이지, 화면을 정리하려고 바꿀 일이 아니다.
    const current = (draft.color || '').toLowerCase();
    const palette = PROJECT_COLORS.includes(current) ? PROJECT_COLORS : [current, ...PROJECT_COLORS];

    const swatchRow = document.createElement('div');
    swatchRow.className = 'swatch-row';
    palette.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c === current ? ' is-on' : '');
      b.style.background = c;
      b.setAttribute('aria-label', `색 ${c}`);
      b.setAttribute('aria-pressed', String(c === current));
      b.addEventListener('click', () => {
        draft.color = c;
        swatchRow.querySelectorAll('.swatch').forEach((x) => {
          x.classList.remove('is-on');
          x.setAttribute('aria-pressed', 'false');
        });
        b.classList.add('is-on');
        b.setAttribute('aria-pressed', 'true');
      });
      swatchRow.appendChild(b);
    });
    sheet.appendChild(group('구분 색상', swatchRow));

    if (project) {
      sheet.appendChild(group('보관', optionRow(
        { false: '진행 중', true: '보관됨' },
        String(draft.archived),
        (v) => { draft.archived = v === 'true'; },
      )));
    }

    const save = document.createElement('button');
    save.className = 'btn btn-cta btn-block';
    save.textContent = project ? '저장' : '사업 추가';
    save.addEventListener('click', async () => {
      if (!draft.name.trim()) { nameInput.focus(); return; }
      save.disabled = true;
      try {
        if (project) {
          await patchProject(project.id, {
            name: draft.name.trim(), color: draft.color, archived: draft.archived,
          });
          toast('사업 정보를 수정했습니다');
        } else {
          const created = await addProject(draft.name);
          await patchProject(created.id, { color: draft.color });
          toast('새 사업을 추가했습니다');
        }
        closeSheet();
      } catch (e) {
        toast(e.message);
        save.disabled = false;
      }
    });
    sheet.appendChild(save);
  });
}

export { closeSheet };
