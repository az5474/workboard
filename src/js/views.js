// 화면 렌더링
// 사업별로 나눠 보는 것을 기본으로 삼는다.
// 사업이 여럿일 때 "어느 사업이 급한가"가 먼저 보여야 하기 때문이다.

import {
  state, todayStr, projectById, liveTasks, isOverdue, isDueSoon,
  urgencyScore, projectSummary, togglePin, MAX_PINNED, subscribe,
  reorderProjects, moveProject, pinnedTasks, setProjectFilter,
  diffDays, addDays, parseDate, monthRange, formatMonthLabel,
  tripsInRange, tripLength, tripColor, monthOf, setCalMonth,
} from './store.js';
import { $, taskRow, toast, openProjectSheet, openTripSheet, escapeHtml, icon } from './ui.js';
import { enableSort } from './sortable.js';

// 현재 필터가 적용된 업무들
function visibleTasks() {
  let list = liveTasks();
  if (state.projectFilter !== 'all') list = list.filter((t) => t.project_id === state.projectFilter);
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    list = list.filter((t) =>
      (t.title || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q));
  }
  return list;
}

// ---------- 사이드바 (PC) ----------

function renderSidebar() {
  const box = $('side-projects');
  if (!box) return;
  box.innerHTML = '';
  const today = todayStr();

  const mk = (id, name, color, count, danger, active) => {
    const b = document.createElement('button');
    b.className = 'side-project' + (active ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(active));
    b.innerHTML =
      `<span class="side-dot" style="background:${color}"></span>` +
      `<span class="side-name">${escapeHtml(name)}</span>` +
      `<span class="side-count${danger ? ' is-danger' : ''}">${count}</span>`;
    b.addEventListener('click', () => setProjectFilter(id));
    return b;
  };

  const allOpen = liveTasks().filter((t) => !t.completed).length;
  box.appendChild(mk('all', '전체 사업', 'var(--stone)', allOpen, false, state.projectFilter === 'all'));

  state.projects.filter((p) => !p.archived).forEach((p) => {
    const s = projectSummary(p.id, today);
    const label = s.overdue > 0 ? `${s.overdue}!` : String(s.open);
    box.appendChild(mk(p.id, p.name, p.color, label, s.overdue > 0, state.projectFilter === p.id));
  });
}

// ---------- 사업 칩 (모바일) ----------

function renderChips() {
  const box = $('project-chips');
  if (!box) return;
  box.innerHTML = '';
  const today = todayStr();

  const mk = (id, name, color, num, active) => {
    const b = document.createElement('button');
    b.className = 'pchip' + (active ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(active));
    b.innerHTML =
      (color ? `<span class="pchip-dot" style="background:${color}"></span>` : '') +
      escapeHtml(name) +
      (num !== null ? `<span class="pchip-num">${num}</span>` : '');
    b.addEventListener('click', () => setProjectFilter(id));
    return b;
  };

  box.appendChild(mk('all', '전체', null, liveTasks().filter((t) => !t.completed).length, state.projectFilter === 'all'));
  state.projects.filter((p) => !p.archived).forEach((p) => {
    const s = projectSummary(p.id, today);
    box.appendChild(mk(p.id, p.name, p.color, s.overdue > 0 ? `${s.overdue}!` : s.open, state.projectFilter === p.id));
  });
}

// ---------- 다가오는 출장 ----------
//
// 출장은 결국 "그날 다른 일을 못 잡는다"는 정보다.
// 달력을 열어야만 보이면 늦는다. 2주 안의 출장을 보드 맨 위에 한 줄로 보여준다.
// 없으면 줄 자체가 안 나온다 — 빈 줄로 자리를 차지하지 않는다.

function renderBoardTrips() {
  const box = $('board-trips');
  if (!box) return;
  const today = todayStr();
  const upcoming = tripsInRange(today, addDays(today, 14)).slice(0, 3);

  box.innerHTML = '';
  if (!upcoming.length) { box.classList.add('hidden'); return; }

  const label = document.createElement('span');
  label.className = 'board-trips-label';
  label.textContent = '출장';
  box.appendChild(label);

  upcoming.forEach((t) => {
    const end = t.end_date || t.start_date;
    const ongoing = t.start_date <= today;
    const d = diffDays(today, t.start_date);
    const when = ongoing ? '진행 중' : `D-${d}`;
    const dates = t.start_date === end
      ? shortDate(t.start_date)
      : `${shortDate(t.start_date)}~${shortDate(end)}`;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btrip';
    b.title = tripSummary(t);
    b.innerHTML =
      `<span class="pchip-dot" style="background:${tripColor(t)}"></span>` +
      `<span class="btrip-d${ongoing ? ' is-now' : ''}">${when}</span>` +
      `<span class="btrip-title">${escapeHtml(t.title)}</span>` +
      `<span class="btrip-dates">${dates}</span>`;
    b.addEventListener('click', () => {
      setCalMonth(monthOf(t.start_date));
      // 화면 전환은 main.js 가 맡는다 (switchView 가 거기 있다)
      document.dispatchEvent(new CustomEvent('wb:view', { detail: 'calendar' }));
    });
    box.appendChild(b);
  });
  box.classList.remove('hidden');
}

// ---------- 요약 ----------

function renderSummary() {
  const today = todayStr();
  const list = visibleTasks();
  const open = list.filter((t) => !t.completed);

  const cells = [
    { label: '오늘 할 일', value: open.filter((t) => t.work_date === today).length },
    { label: '오늘 완료', value: list.filter((t) => t.completed && t.work_date === today).length },
    { label: '지연', value: open.filter((t) => isOverdue(t, today)).length, tone: 'is-danger' },
    { label: '곧 마감', value: open.filter((t) => isDueSoon(t, 6, today)).length, tone: 'is-warn' },
  ];

  const box = $('summary');
  box.innerHTML = '';
  cells.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sum-sep';
      box.appendChild(sep);
    }
    const el = document.createElement('div');
    el.className = 'sum' + (c.value > 0 && c.tone ? ` ${c.tone}` : '');
    el.innerHTML = `<span class="sum-value">${c.value}</span><span class="sum-label">${c.label}</span>`;
    box.appendChild(el);
  });
}

// ---------- 오늘의 핵심 3 ----------
//
// 자리는 세 개고, 그 사실이 화면에 보여야 한다.
// 빈 자리를 지워버리면 "하나 더 넣어도 되겠지" 가 된다.
// 번호를 붙이는 이유는 장식이 아니라, 정원이 정해진 목록이기 때문이다.

/** 지금 보고 있는 사업. 전체 보기면 null. */
const focusScope = () => (state.projectFilter === 'all' ? null : state.projectFilter);

function renderFocus() {
  const box = $('list-focus');
  const scope = focusScope();
  const project = scope ? projectById(scope) : null;
  const pinned = pinnedTasks(scope);
  const shown = pinned.slice(0, MAX_PINNED);

  // 사업 안에서는 정원이 3이라 넘칠 수 없다. 전체 보기에서만 넘친다.
  const hidden = pinned.slice(MAX_PINNED);

  $('focus-title').textContent = project ? '이 사업의 핵심 3' : '오늘의 핵심 3';
  $('focus-note').textContent = hidden.length
    ? `${pinned.length}개 고정 중 급한 순 ${MAX_PINNED}개`
    : `${shown.length} / ${MAX_PINNED} · ${project ? '이 사업에서' : '오늘'} 먼저 끝낼 일`;

  box.innerHTML = '';
  for (let i = 0; i < MAX_PINNED; i++) {
    const slot = document.createElement('li');
    slot.className = 'fslot';

    if (shown[i]) {
      // 사업 안에서 보고 있으면 어느 사업인지 다시 말할 필요가 없다
      slot.appendChild(taskRow(shown[i], { showProject: !project }));
    } else {
      slot.classList.add('is-empty');
      const fill = document.createElement('button');
      fill.className = 'fslot-empty';
      fill.innerHTML = icon('star', 'ico ico-sm') + '<span>급한 일 하나 앉히기</span>';
      fill.addEventListener('click', () => suggestFocus(1));
      slot.appendChild(fill);
    }
    box.appendChild(slot);
  }

  renderFocusElsewhere(scope, hidden);
}

/**
 * 전체 보기에서 세 자리에 못 들어간 고정 업무를 사업별로 알려준다.
 * 숨겼다는 사실을 숨기지 않는다. 누르면 그 사업으로 들어가 세 자리를 그대로 본다.
 */
function renderFocusElsewhere(scope, hidden) {
  const box = $('focus-elsewhere');
  if (scope || !hidden.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  const byProject = new Map();
  hidden.forEach((t) => byProject.set(t.project_id, (byProject.get(t.project_id) || 0) + 1));

  box.innerHTML = '<span class="focus-elsewhere-label">다른 사업의 핵심</span>';
  [...byProject.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([pid, n]) => {
      const p = projectById(pid);
      const b = document.createElement('button');
      b.className = 'pchip';
      b.innerHTML =
        `<span class="pchip-dot" style="background:${p?.color || 'var(--stone)'}"></span>` +
        escapeHtml(p?.name || '사업 없음') +
        `<span class="pchip-num">${n}</span>`;
      b.addEventListener('click', () => setProjectFilter(pid));
      box.appendChild(b);
    });
  box.classList.remove('hidden');
}

/**
 * 빈 자리를 급한 순으로 채운다. limit 을 주면 그만큼만.
 * 지금 보고 있는 범위 안에서만 고른다 — 사업 탭에서 다른 사업 일이 끼어들면 곤란하다.
 */
async function suggestFocus(limit = MAX_PINNED) {
  const today = todayStr();
  const scope = focusScope();

  const candidates = visibleTasks()
    .filter((t) => !t.completed && !t.pinned)
    .sort((a, b) => urgencyScore(b, today) - urgencyScore(a, today));

  const already = pinnedTasks(scope).filter((t) => !t.completed).length;
  const room = Math.min(limit, MAX_PINNED - already);

  if (room <= 0) {
    toast(scope ? `이 사업은 이미 ${MAX_PINNED}개가 고정되어 있습니다` : `이미 ${MAX_PINNED}개가 고정되어 있습니다`);
    return;
  }
  if (!candidates.length) { toast('앉힐 업무가 없습니다'); return; }

  // 전체 보기에서는 사업마다 정원이 따로라, 정원이 찬 사업은 건너뛰고 다음 후보로 간다
  let done = 0;
  let lastError = null;
  for (const t of candidates) {
    if (done >= room) break;
    try { await togglePin(t.id); done++; }
    catch (e) { lastError = e; }
  }
  if (done) toast(`급한 순으로 ${done}개를 골랐습니다`);
  else toast(lastError ? lastError.message : '고정하지 못했습니다');
}

// ---------- 사업 카드 머리글 ----------

function projectHead(project, metricsHtml) {
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'pcard-head';
  const color = project?.color || 'var(--stone)';
  head.style.setProperty('--pcolor', color);
  head.innerHTML =
    `<span class="pcard-bar" style="background:${color}"></span>` +
    `<span class="pcard-title">${escapeHtml(project?.name || '사업 없음')}</span>` +
    `<span class="pcard-metrics">${metricsHtml}${icon('pencil', 'ico ico-sm pcard-edit')}</span>`;
  if (project) {
    head.title = `${project.name} 정보 수정`;
    head.addEventListener('click', () => openProjectSheet(project.id));
  } else {
    head.disabled = true;
  }
  return head;
}

// ---------- 놓치고 있는 업무 ----------
//
// '오늘 할 일'로 잡지 않았는데 마감이 임박했거나 이미 지난 업무.
// 오늘 목록에 있는 건 아래 사업별 카드에서 이미 보이므로 여기서 제외한다.
// 두 섹션에 같은 업무가 겹쳐 보이면 목록만 길어지고 판단이 흐려진다.

function renderDue() {
  const today = todayStr();
  const box = $('list-due');
  box.innerHTML = '';

  const items = visibleTasks().filter((t) =>
    !t.completed &&
    t.work_date !== today &&                                    // 오늘 목록에 없는 것만
    t.due_date &&
    (isOverdue(t, today) || isDueSoon(t, 6, today)));

  if (!items.length) {
    box.innerHTML = '<div class="empty">빠뜨린 업무가 없습니다. 마감이 가까운 일은 모두 오늘 목록에 들어와 있습니다.</div>';
    return;
  }

  // 사업별로 묶는다. 전체 보기일 때 어느 사업이 급한지 바로 보이도록.
  const byProject = new Map();
  items.forEach((t) => {
    if (!byProject.has(t.project_id)) byProject.set(t.project_id, []);
    byProject.get(t.project_id).push(t);
  });

  // 지연 많은 사업 먼저
  const groups = [...byProject.entries()].sort((a, b) => {
    const ao = a[1].filter((t) => isOverdue(t, today)).length;
    const bo = b[1].filter((t) => isOverdue(t, today)).length;
    return bo - ao || b[1].length - a[1].length;
  });

  groups.forEach(([pid, list]) => {
    const p = projectById(pid);
    const overdue = list.filter((t) => isOverdue(t, today)).length;

    const card = document.createElement('div');
    card.className = 'pcard';
    card.appendChild(projectHead(p,
      (overdue ? `<span class="chip chip-overdue">지연 ${overdue}</span>` : '') +
      `<span class="chip chip-due">${list.length}건</span>`));

    const body = document.createElement('div');
    body.className = 'pcard-body';
    list.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
      .forEach((t) => body.appendChild(taskRow(t, { flat: true, moveToday: true })));
    card.appendChild(body);
    box.appendChild(card);
  });
}

// ---------- 사업별 오늘의 업무 ----------

function renderProjectCards() {
  const today = todayStr();
  const box = $('list-projects');
  box.innerHTML = '';

  let projects = state.projects.filter((p) => !p.archived);
  if (state.projectFilter !== 'all') projects = projects.filter((p) => p.id === state.projectFilter);

  let rendered = 0;

  projects.forEach((p) => {
    let list = visibleTasks().filter((t) => t.project_id === p.id && t.work_date === today);
    if (state.hideDone) list = list.filter((t) => !t.completed);
    const s = projectSummary(p.id, today);

    // 오늘 잡힌 게 없고 필터도 전체면 건너뛴다 (화면을 비우지 않기 위해)
    if (!list.length && state.projectFilter === 'all') return;
    rendered++;

    const card = document.createElement('div');
    card.className = 'pcard';
    card.appendChild(projectHead(p,
      (s.overdue ? `<span class="chip chip-overdue">지연 ${s.overdue}</span>` : '') +
      (s.stuck ? `<span class="chip chip-stuck">막힘 ${s.stuck}</span>` : '') +
      `<span class="chip chip-due">${list.filter((t) => !t.completed).length}/${list.length}</span>`));

    const body = document.createElement('div');
    body.className = 'pcard-body';
    if (!list.length) {
      body.innerHTML = '<div class="pcard-empty">오늘 잡힌 업무가 없습니다.</div>';
    } else {
      list
        .sort((a, b) => Number(a.completed) - Number(b.completed) || urgencyScore(b, today) - urgencyScore(a, today))
        .forEach((t) => body.appendChild(taskRow(t, { flat: true })));
    }
    card.appendChild(body);
    box.appendChild(card);
  });

  if (!rendered) {
    const live = state.projects.filter((p) => !p.archived);
    if (!live.length) {
      // 처음 온 사람 (동료가 주소를 받아 막 로그인한 경우).
      // 사업이 없으면 업무를 적을 수 없는데, 모바일에서는 사업 추가가 설정 안에
      // 숨어 있다. 여기서 바로 만들 수 있게 길을 낸다.
      box.innerHTML = '';
      const d = document.createElement('div');
      d.className = 'empty stack stack-md';
      d.style.alignItems = 'center';
      d.innerHTML = '<p>먼저 사업(프로젝트)을 하나 만들면 업무를 적을 수 있습니다.</p>';
      const b = document.createElement('button');
      b.className = 'btn btn-primary btn-sm';
      b.textContent = '첫 사업 만들기';
      b.addEventListener('click', () => openProjectSheet());
      d.appendChild(b);
      box.appendChild(d);
    } else {
      box.innerHTML = '<div class="empty">오늘로 잡힌 업무가 없습니다. 위 입력창에서 추가해 보세요.</div>';
    }
  }
}

// ---------- 출장 달력 ----------
//
// 출장은 하루짜리가 아니라 기간이다. 하루씩 끊어 점으로 찍으면
// 사흘 출장인지 하루 출장인지 눈으로 셀 수가 없다.
// 한 주 안에서는 막대 하나로 이어 그리고, 주를 넘어가면 양 끝을 각지게 둔다.

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function renderCalendar() {
  const ym = state.calMonth;
  const { first, last } = monthRange(ym);

  // 격자는 1일이 속한 주의 일요일부터, 말일이 속한 주의 토요일까지
  const gridStart = addDays(first, -parseDate(first).getDay());
  const gridEnd = addDays(last, 6 - parseDate(last).getDay());

  $('cal-month').textContent = formatMonthLabel(ym);

  const trips = tripsInRange(gridStart, gridEnd);
  const today = todayStr();

  const box = $('cal-grid');
  box.innerHTML = '';

  const dow = document.createElement('div');
  dow.className = 'cal-dow';
  DOW.forEach((d) => {
    const s = document.createElement('span');
    s.textContent = d;
    dow.appendChild(s);
  });
  box.appendChild(dow);

  for (let ws = gridStart; ws <= gridEnd; ws = addDays(ws, 7)) {
    box.appendChild(calendarWeek(ws, trips, ym, today));
  }

  renderTripList(ym, today);
}

/**
 * 한 주를 그린다.
 *
 * 막대를 층(lane)에 쌓는 규칙은 단순하다 — 시작이 이른 것부터 훑으면서
 * 아직 자리가 남은 가장 위 층에 넣는다. 같은 층에서 겹치지만 않으면 된다.
 * (tripsInRange 가 시작일 순, 같은 날이면 긴 것부터 정렬해 준다.
 *  긴 것이 위로 가야 눈이 따라가기 쉽다.)
 */
function calendarWeek(weekStart, trips, ym, today) {
  const weekEnd = addDays(weekStart, 6);
  const week = document.createElement('div');
  week.className = 'cal-week';

  const laneEnds = [];        // laneEnds[i] = 그 층이 채워진 마지막 칸 번호
  const segments = [];

  trips.forEach((t) => {
    const s = t.start_date;
    const e = t.end_date || t.start_date;
    if (e < weekStart || s > weekEnd) return;

    const from = s < weekStart ? weekStart : s;
    const to = e > weekEnd ? weekEnd : e;
    const i0 = diffDays(weekStart, from);
    const i1 = diffDays(weekStart, to);

    let lane = laneEnds.findIndex((end) => end < i0);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(-1); }
    laneEnds[lane] = i1;

    segments.push({ trip: t, i0, i1, lane, contLeft: s < weekStart, contRight: e > weekEnd });
  });

  week.style.setProperty('--lanes', laneEnds.length);

  // 날짜 칸
  const days = document.createElement('div');
  days.className = 'cal-days';
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-day';
    if (date.slice(0, 7) !== ym) cell.classList.add('is-outside');
    if (date === today) cell.classList.add('is-today');
    if (i === 0) cell.classList.add('is-sun');
    if (i === 6) cell.classList.add('is-sat');
    cell.innerHTML = `<span class="cal-num">${Number(date.slice(8))}</span>`;
    cell.title = `${date} 에 출장 추가`;
    cell.setAttribute('aria-label', `${date} 에 출장 추가`);
    cell.addEventListener('click', () => openTripSheet(null, { startDate: date }));
    days.appendChild(cell);
  }
  week.appendChild(days);

  // 기간 막대
  const bars = document.createElement('div');
  bars.className = 'cal-bars';
  segments.forEach((seg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cal-bar'
      + (seg.contLeft ? ' cont-left' : '')
      + (seg.contRight ? ' cont-right' : '');
    b.style.left = `calc(${(seg.i0 / 7) * 100}% + 3px)`;
    b.style.width = `calc(${((seg.i1 - seg.i0 + 1) / 7) * 100}% - 6px)`;
    b.style.setProperty('--lane', seg.lane);
    b.style.setProperty('--tcolor', tripColor(seg.trip));
    b.textContent = seg.trip.title;
    b.title = tripSummary(seg.trip);
    b.setAttribute('aria-label', tripSummary(seg.trip));
    b.addEventListener('click', (e) => { e.stopPropagation(); openTripSheet(seg.trip.id); });
    bars.appendChild(b);
  });
  week.appendChild(bars);

  return week;
}

const shortDate = (s) => `${Number(s.slice(5, 7))}.${Number(s.slice(8))}`;

function tripSummary(trip) {
  const end = trip.end_date || trip.start_date;
  const days = tripLength(trip);
  const when = trip.start_date === end
    ? shortDate(trip.start_date)
    : `${shortDate(trip.start_date)} ~ ${shortDate(end)} (${days}일)`;
  return [trip.title, when, trip.location].filter(Boolean).join(' · ');
}

/** 지금 기준으로 언제인지. 오늘 자리를 비우는지가 가장 먼저 궁금하다. */
function tripWhen(trip, today) {
  const end = trip.end_date || trip.start_date;
  if (trip.start_date <= today && today <= end) return { text: '진행 중', cls: 'is-now' };
  if (trip.start_date > today) {
    const d = diffDays(today, trip.start_date);
    if (d === 1) return { text: '내일', cls: 'is-soon' };
    if (d <= 7) return { text: `${d}일 뒤`, cls: 'is-soon' };
    return { text: `${d}일 뒤`, cls: '' };
  }
  return { text: '지남', cls: '' };
}

function renderTripList(ym, today) {
  const { first, last } = monthRange(ym);
  const trips = tripsInRange(first, last);

  $('cal-count').textContent = trips.length ? `${trips.length}건` : '';

  const box = $('trip-list');
  box.innerHTML = '';
  if (!trips.length) {
    box.innerHTML =
      '<div class="empty">이 달에 잡힌 출장이 없습니다. 달력의 날짜를 눌러 바로 추가할 수 있습니다.</div>';
    return;
  }

  trips.forEach((t) => {
    const end = t.end_date || t.start_date;
    const p = projectById(t.project_id);
    const when = tripWhen(t, today);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'trip-row' + (end < today ? ' is-past' : '');

    const meta = [
      t.start_date === end
        ? `${shortDate(t.start_date)} (${DOW[parseDate(t.start_date).getDay()]})`
        : `${shortDate(t.start_date)} ~ ${shortDate(end)} · ${tripLength(t)}일`,
    ];

    row.innerHTML =
      `<span class="trip-bar" style="background:${tripColor(t)}"></span>
       <span class="trip-body">
         <span class="trip-title">${escapeHtml(t.title)}</span>
         <span class="trip-meta">
           <span>${meta[0]}</span>
           ${t.location ? `<span class="trip-place">${icon('pin-map', 'ico')}${escapeHtml(t.location)}</span>` : ''}
           ${p ? `<span class="chip chip-project"><span class="pchip-dot" style="background:${p.color}"></span>${escapeHtml(p.name)}</span>` : ''}
         </span>
       </span>
       <span class="trip-when ${when.cls}">${when.text}</span>`;

    row.addEventListener('click', () => openTripSheet(t.id));
    box.appendChild(row);
  });
}

// ---------- 전체 목록 ----------

const STATUS_FILTERS = { all: '전체', todo: '진행 전', doing: '진행 중', internal_wait: '내부 대기', external_wait: '외부 대기', done: '완료' };

function renderStatusFilters() {
  const box = $('status-filters');
  box.innerHTML = '';
  Object.entries(STATUS_FILTERS).forEach(([v, label]) => {
    const b = document.createElement('button');
    b.className = 'pill' + (state.statusFilter === v ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(state.statusFilter === v));
    b.textContent = label;
    b.addEventListener('click', () => { state.statusFilter = v; renderAll(); });
    box.appendChild(b);
  });
}

function renderAllList() {
  const box = $('list-all');
  box.innerHTML = '';

  let list = visibleTasks();
  if (state.statusFilter === 'done') list = list.filter((t) => t.completed);
  else if (state.statusFilter !== 'all') list = list.filter((t) => !t.completed && t.status === state.statusFilter);

  if (!list.length) {
    box.innerHTML = '<div class="empty">조건에 맞는 업무가 없습니다.</div>';
    return;
  }

  const today = todayStr();
  list.sort((a, b) => Number(a.completed) - Number(b.completed) || urgencyScore(b, today) - urgencyScore(a, today));
  list.forEach((t) => box.appendChild(taskRow(t, { showProject: true })));
}

// ---------- 휴지통 ----------

function renderTrash() {
  const box = $('list-trash');
  box.innerHTML = '';
  const list = state.tasks.filter((t) => t.deleted_at);
  if (!list.length) {
    box.innerHTML = '<div class="empty">휴지통이 비어 있습니다.</div>';
    return;
  }
  list.sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || ''));
  list.forEach((t) => box.appendChild(taskRow(t, { trashed: true })));
}

// ---------- 설정: 사업 관리 ----------
//
// 여기서 사업 순서를 바꾼다. 이 순서가 사이드바 · 사업 칩 · 사업별 카드 ·
// 빠른 추가의 사업 선택까지 전부 따라간다.

function renderManageProjects() {
  const box = $('manage-projects');
  if (!box) return;
  box.innerHTML = '';

  if (!state.projects.length) {
    box.innerHTML = '<div class="empty">등록된 사업이 없습니다. 위 버튼으로 첫 사업을 만들어 보세요.</div>';
    return;
  }

  const total = state.projects.length;

  state.projects.forEach((p, i) => {
    const s = projectSummary(p.id);
    const row = document.createElement('div');
    row.className = 'sortrow';
    row.dataset.id = p.id;

    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'grip';
    grip.innerHTML = icon('grip');
    grip.title = '끌어서 순서 바꾸기 (위아래 화살표로도 됩니다)';
    grip.setAttribute('aria-label', `${p.name} 순서 바꾸기. 현재 ${total}개 중 ${i + 1}번째`);

    const body = document.createElement('div');
    body.className = 'sortrow-body';
    body.innerHTML =
      `<div class="sortrow-title">
         <span class="side-dot" style="background:${p.color}"></span>
         <span class="sortrow-name">${escapeHtml(p.name)}</span>
         ${p.archived ? '<span class="chip chip-carried">보관됨</span>' : ''}
       </div>
       <div class="sortrow-meta">업무 ${s.total}개 · 미완료 ${s.open}개</div>`;

    const edit = document.createElement('button');
    edit.className = 'btn btn-ghost btn-sm';
    edit.innerHTML = icon('pencil', 'ico ico-sm');
    edit.append(document.createTextNode('수정'));
    edit.addEventListener('click', () => openProjectSheet(p.id));

    row.append(grip, body, edit);
    box.appendChild(row);
  });

  if (pendingGripFocus) {
    const g = box.querySelector(`.sortrow[data-id="${CSS.escape(pendingGripFocus)}"] .grip`);
    pendingGripFocus = null;
    if (g) g.focus();
  }
}

// 화살표로 옮기면 목록이 통째로 다시 그려진다. 손잡이를 놓치지 않게 다시 잡아준다.
let pendingGripFocus = null;

/** 끌어놓기 기계는 sortable.js 가 맡고, 여기서는 결과를 저장하는 일만 한다. */
function enableProjectSort(box) {
  enableSort(box, {
    onReorder: async (ids) => {
      try { await reorderProjects(ids); }
      catch (e) { toast(e.message); }
    },
    onStep: async (id, delta) => {
      pendingGripFocus = id;
      try {
        const moved = await moveProject(id, delta);
        if (!moved) pendingGripFocus = null;    // 끝이라 못 움직였으면 포커스는 그대로 둔다
      } catch (e) {
        pendingGripFocus = null;
        toast(e.message);
      }
    },
  });
}

// ---------- 전체 ----------

export function renderAll() {
  if (!state.ready) return;

  renderSidebar();
  renderChips();

  if (state.view === 'board') {
    renderBoardTrips();
    renderSummary();
    renderFocus();
    renderDue();
    renderProjectCards();
  } else if (state.view === 'list') {
    renderStatusFilters();
    renderAllList();
  } else if (state.view === 'calendar') {
    renderCalendar();
  } else if (state.view === 'trash') {
    renderTrash();
  } else if (state.view === 'settings') {
    renderManageProjects();
    const n = state.tasks.filter((t) => t.deleted_at).length;
    $('trash-count').textContent = n
      ? `삭제한 업무 ${n}개가 남아 있습니다.`
      : '비어 있습니다.';
  }
}

export function initViews() {
  $('btn-suggest').addEventListener('click', () => suggestFocus());
  $('hide-done').addEventListener('change', (e) => {
    state.hideDone = e.target.checked;
    renderProjectCards();
  });
  // 목록은 다시 그려져도 이 상자 자체는 그대로라 한 번만 걸어두면 된다
  enableProjectSort($('manage-projects'));
  subscribe(renderAll);
}
