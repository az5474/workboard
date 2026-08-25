// 앱 상태와 데이터 조작
//
// 두 가지 원칙
//   1) 낙관적 업데이트 — 화면을 먼저 바꾸고 뒤에서 저장한다.
//      모바일에서 신호가 약해도 누른 즉시 반응하게 하려는 것.
//      저장이 실패하면 되돌리고 알린다.
//   2) 이월은 앱을 열 때 자동으로 처리한다.
//      어제 못 끝낸 일이 오늘로 넘어오고 carried_count 가 1 올라간다.

import {
  fetchProjects, fetchTasks, fetchTrips,
  updateTask, insertTask, upsertRows, supabase, newTaskId,
  insertTrip, updateTrip, deleteTrip, newTripId,
} from './db.js';

// ---------- 상태 ----------

export const state = {
  projects: [],
  tasks: [],
  trips: [],
  ready: false,
  // 화면 필터
  view: 'board',          // board | list | calendar | trash | settings
  projectFilter: 'all',   // 'all' 또는 project id
  search: '',
  hideDone: false,
  statusFilter: 'all',
  calMonth: '',           // 달력이 보고 있는 달 'YYYY-MM'. 아래에서 이번 달로 채운다.
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify() { listeners.forEach((fn) => fn()); }

// ---------- 날짜 ----------

/** 로컬 기준 YYYY-MM-DD. toISOString() 은 UTC 라 하루가 밀릴 수 있어 쓰지 않는다. */
export function todayStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function diffDays(fromStr, toStr) {
  if (!fromStr || !toStr) return null;
  const a = new Date(`${fromStr}T00:00:00`);
  const b = new Date(`${toStr}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

export function formatDateLabel(d = new Date()) {
  const week = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${week})`;
}

/** 'YYYY-MM-DD' 를 로컬 Date 로. 뒤에 시각을 붙이지 않으면 UTC 로 읽혀 하루가 밀린다. */
export function parseDate(s) {
  return s ? new Date(`${s}T00:00:00`) : null;
}

/** 날짜 문자열에 며칠을 더한다. 달을 넘기는 계산은 Date 에 맡긴다. */
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

export const monthOf = (s) => (s || todayStr()).slice(0, 7);   // 'YYYY-MM'

/** 그 달의 1일과 말일 */
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  return { first: todayStr(first), last: todayStr(last) };
}

export function formatMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}년 ${m}월`;
}

// 달력은 이번 달에서 시작한다
state.calMonth = monthOf();

// ---------- 바깥에서 온 값 검사 ----------
//
// 색과 링크는 DB 와 가져오기 파일에서 온다. 둘 다 화면에 그대로 얹히는 값이라
// 모양을 확인하고 들여보낸다. 색은 style 속성으로, 링크는 href 로 들어가는데
// 검사 없이 통과시키면 각각 속성 탈출과 javascript: 실행이 가능해진다.

const COLOR_SHAPE = /^(#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|var\(--[a-z0-9-]+\))$/i;

export function safeColor(value, fallback = 'var(--stone)') {
  const v = String(value ?? '').trim();
  return COLOR_SHAPE.test(v) ? v : fallback;
}

/**
 * 열어도 되는 주소만 돌려준다. 아니면 빈 문자열.
 * 'example.com' 처럼 적는 사람이 많아서 그건 https 를 붙여 살린다.
 */
export function safeUrl(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/|\?|$)/.test(v)) return `https://${v}`;
  return '';
}

// ---------- 파생 ----------

export const projectById = (id) => state.projects.find((p) => p.id === id);
export const liveTasks = () => state.tasks.filter((t) => !t.deleted_at);

export function isOverdue(task, today = todayStr()) {
  return !task.completed && task.due_date && task.due_date < today;
}

export function isDueSoon(task, days = 6, today = todayStr()) {
  if (task.completed || !task.due_date) return false;
  const d = diffDays(today, task.due_date);
  return d !== null && d >= 0 && d <= days;
}

/**
 * 오늘 얼마나 급한지 점수.
 *   이월이 쌓였다 = 계속 밀리고 있다 = 뭔가 막혔다는 신호
 *   기한 초과 > 오늘 마감 > 임박 순으로 가중
 * '오늘의 핵심 3' 자동 제안에 쓴다.
 */
export function urgencyScore(task, today = todayStr()) {
  if (task.completed) return -1;
  let score = 0;

  const d = diffDays(today, task.due_date);
  if (d !== null) {
    if (d < 0)       score += 60 + Math.min(Math.abs(d), 14) * 2;  // 지남
    else if (d === 0) score += 55;                                  // 오늘
    else if (d === 1) score += 40;
    else if (d <= 6)  score += 30 - d * 2;
  }

  if (task.priority === 'urgent') score += 35;
  else if (task.priority === 'high') score += 18;

  score += Math.min(task.carried_count || 0, 10) * 4;   // 밀린 만큼 가산

  if (task.status === 'external_wait' || task.status === 'internal_wait') score -= 12; // 남의 회신 대기
  if (task.pinned) score += 25;

  return score;
}

/** 사업별 요약 — 사이드바와 칩에 쓴다. */
export function projectSummary(projectId, today = todayStr()) {
  const list = liveTasks().filter((t) => t.project_id === projectId);
  const open = list.filter((t) => !t.completed);
  return {
    total: list.length,
    open: open.length,
    todayOpen: open.filter((t) => t.work_date === today).length,
    overdue: open.filter((t) => isOverdue(t, today)).length,
    dueSoon: open.filter((t) => isDueSoon(t, 6, today)).length,
    stuck: open.filter((t) => (t.carried_count || 0) >= 5).length,
    nextDue: open.filter((t) => t.due_date).map((t) => t.due_date).sort()[0] || null,
  };
}

// ---------- 불러오기 ----------

export async function loadAll() {
  // 휴지통에 있는 업무도 함께 불러온다. 빼고 불러오면 새로고침한 순간
  // 휴지통 화면이 텅 비어 보이고, 백업에도 빠진다. (liveTasks 가 화면에서 걸러준다)
  const [projects, tasks, trips] = await Promise.all([
    fetchProjects(), fetchTasks({ includeDeleted: true }), fetchTrips(),
  ]);

  // 색은 들어오는 길목에서 한 번만 걸러둔다.
  // 화면 쪽 여덟 군데에서 각자 검사하게 두면 언젠가 한 곳을 빠뜨린다.
  state.projects = projects.map((p) => ({ ...p, color: safeColor(p.color, '#5c6570') }));
  state.trips = trips.map((t) => ({ ...t, color: safeColor(t.color, '#7459e8') }));
  state.tasks = tasks;
  state.ready = true;
  notify();
}

// ---------- 이월 ----------

/**
 * 어제 이전의 미완료 업무를 오늘로 넘긴다.
 * 하루에 한 번만 올라가도록 last_rolled_date 로 막는다.
 * 반환: 넘긴 개수
 */
export async function runRollover() {
  const today = todayStr();
  const targets = liveTasks().filter((t) =>
    !t.completed &&
    t.work_date &&
    t.work_date < today &&
    t.last_rolled_date !== today
  );
  if (!targets.length) return 0;

  const rows = targets.map((t) => {
    // 이월 횟수는 '정말 밀렸을 때'만 올린다 — 마감일이 없거나 이미 지난 업무.
    // 마감이 아직 남은 일은 오늘 목록으로 옮기기만 한다.
    // 다음 주 마감인 일이 매일 "N회 이월" 배지를 다는 건 신호가 아니라 소음이다.
    const lateOrDateless = !t.due_date || t.due_date < today;
    return {
      ...t,
      work_date: today,
      last_rolled_date: today,
      carried_count: (t.carried_count || 0) + (lateOrDateless ? 1 : 0),
    };
  });

  await upsertRows('tasks', rows);

  // 로컬 상태도 맞춘다
  rows.forEach((r) => {
    const t = state.tasks.find((x) => x.id === r.id);
    if (t) Object.assign(t, {
      work_date: r.work_date,
      last_rolled_date: r.last_rolled_date,
      carried_count: r.carried_count,
    });
  });
  notify();
  return rows.length;
}

// ---------- 낙관적 업데이트 ----------

/**
 * 로컬을 먼저 바꾸고 서버에 저장한다.
 * 실패하면 원래 값으로 되돌린다.
 */
export async function patchTask(id, patch) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new Error('업무를 찾을 수 없습니다.');

  const before = {};
  Object.keys(patch).forEach((k) => { before[k] = task[k]; });

  Object.assign(task, patch);
  notify();

  try {
    await updateTask(id, patch);
    return { ok: true, undo: () => patchTask(id, before) };
  } catch (e) {
    Object.assign(task, before);   // 되돌리기
    notify();
    throw e;
  }
}

export async function toggleComplete(id) {
  const task = state.tasks.find((t) => t.id === id);
  const next = !task.completed;
  return patchTask(id, {
    completed: next,
    status: next ? 'done' : (task.status === 'done' ? 'todo' : task.status),
  });
}

export const MAX_PINNED = 3;

/**
 * 고정된 업무. projectId 를 주면 그 사업 것만.
 * 끝낸 것을 뒤로 보내고, 그 안에서 급한 순으로 정렬한다.
 */
export function pinnedTasks(projectId = null) {
  return liveTasks()
    .filter((t) => t.pinned && (!projectId || t.project_id === projectId))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || urgencyScore(b) - urgencyScore(a));
}

/**
 * 정원은 사업마다 따로 센다.
 * 사업을 여러 개 굴리는 사람에게 "오늘 세 개"는 앱 전체가 아니라
 * 사업 하나 안에서의 이야기다. 캠프의 핵심 3과 세미나의 핵심 3은 다른 목록이다.
 */
export async function togglePin(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new Error('업무를 찾을 수 없습니다.');
  const next = !task.pinned;

  if (next) {
    const inProject = liveTasks()
      .filter((t) => t.project_id === task.project_id && t.pinned && !t.completed).length;
    if (inProject >= MAX_PINNED) {
      const name = projectById(task.project_id)?.name || '이 사업';
      throw new Error(`${name}의 핵심 업무는 최대 ${MAX_PINNED}개입니다. 하나를 풀고 다시 눌러 주세요`);
    }
  }
  return patchTask(id, { pinned: next });
}

/**
 * 보고 있는 사업을 바꾼다.
 * 화면 여기저기서 state 를 직접 건드리지 않고 여기 한 곳만 쓴다.
 * 그래야 빠른 추가처럼 "지금 보는 사업"을 따라가야 하는 것들이 소식을 받는다.
 */
export function setProjectFilter(id) {
  if (state.projectFilter === id) return;
  state.projectFilter = id;
  notify();
}

export async function addTask({ projectId, title, priority = 'normal', dueDate = null }) {
  const row = {
    id: newTaskId(),
    project_id: projectId,
    title: title.trim(),
    priority,
    status: 'todo',
    completed: false,
    due_date: dueDate,
    work_date: todayStr(),
    carried_count: 0,
    pinned: false,
    sort_order: state.tasks.length,
  };
  const created = await insertTask(row);
  state.tasks.push(created);
  notify();
  return created;
}

export async function trashTask(id) {
  return patchTask(id, { deleted_at: new Date().toISOString() });
}

/** 오늘 할 일 목록으로 끌어온다. 이월 횟수는 건드리지 않는다(직접 가져온 것이므로). */
export async function moveToToday(id) {
  return patchTask(id, { work_date: todayStr() });
}

/**
 * 밀린 업무를 한 번에 정리한다.
 *   - 기한이 지난 미완료 업무의 마감일을 지정한 날짜로 옮긴다
 *   - 이월 횟수를 모두 0 으로 되돌린다
 *   - 미완료 업무를 오늘 할 일로 올린다
 * 반복해서 눌러도 안전하다.
 */
export async function cleanupOverdue({ moveDueTo, resetCarried = true, pullToToday = true }) {
  const today = todayStr();
  const targets = liveTasks().filter((t) => !t.completed);
  if (!targets.length) return { moved: 0, reset: 0, pulled: 0 };

  let moved = 0, reset = 0, pulled = 0;

  const rows = targets.map((t) => {
    const next = { ...t };

    if (moveDueTo && t.due_date && t.due_date < moveDueTo) {
      next.due_date = moveDueTo;
      moved++;
    }
    if (resetCarried && (t.carried_count || 0) > 0) {
      next.carried_count = 0;
      next.last_rolled_date = null;
      reset++;
    }
    if (pullToToday && t.work_date !== today) {
      next.work_date = today;
      pulled++;
    }
    return next;
  });

  await upsertRows('tasks', rows);

  rows.forEach((r) => {
    const t = state.tasks.find((x) => x.id === r.id);
    if (t) Object.assign(t, {
      due_date: r.due_date,
      carried_count: r.carried_count,
      last_rolled_date: r.last_rolled_date,
      work_date: r.work_date,
    });
  });
  notify();

  return { moved, reset, pulled };
}

export async function restoreTask(id) {
  return patchTask(id, { deleted_at: null });
}

// ---------- 출장 ----------
//
// 출장은 하루짜리가 아니라 기간이다. 달력에서 막대로 이어져 보여야
// "이 주에 이틀은 자리에 없다" 가 눈에 들어온다.
// 그래서 어디서든 start_date ~ end_date 를 함께 본다.

/** 달력이 보고 있는 달을 옮긴다. delta 는 달 단위. */
export function shiftCalMonth(delta) {
  const [y, m] = state.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.calMonth = todayStr(d).slice(0, 7);
  notify();
}

export function setCalMonth(ym) {
  if (state.calMonth === ym) return;
  state.calMonth = ym;
  notify();
}

/** [from, to] 와 하루라도 겹치는 출장. 사업 필터가 걸려 있으면 그 사업 것만. */
export function tripsInRange(from, to, { respectFilter = true } = {}) {
  return state.trips
    .filter((t) => {
      if (!t.start_date) return false;
      const end = t.end_date || t.start_date;
      if (end < from || t.start_date > to) return false;
      if (respectFilter && state.projectFilter !== 'all' && t.project_id !== state.projectFilter) return false;
      return true;
    })
    .sort((a, b) =>
      (a.start_date || '').localeCompare(b.start_date || '') ||
      // 같은 날 시작이면 긴 것부터. 막대가 층층이 쌓일 때 긴 것이 위로 가야 읽기 쉽다.
      tripLength(b) - tripLength(a) ||
      (a.title || '').localeCompare(b.title || ''));
}

export function tripLength(trip) {
  const end = trip.end_date || trip.start_date;
  return (diffDays(trip.start_date, end) ?? 0) + 1;
}

/** 출장 막대의 색. 사업에 묶여 있으면 사업 색을 따른다 — 색은 사업을 가리키는 신호다. */
export function tripColor(trip) {
  return projectById(trip.project_id)?.color || trip.color || 'var(--steel)';
}

export async function addTrip({ title, startDate, endDate, location = '', projectId = null, note = '' }) {
  const start = startDate || todayStr();
  const row = {
    id: newTripId(),
    title: (title || '').trim() || '제목 없는 출장',
    start_date: start,
    end_date: endDate && endDate >= start ? endDate : start,
    location: location.trim(),
    project_id: projectId || null,
    color: projectById(projectId)?.color || '#7459e8',
    note,
  };
  const created = await insertTrip(row);
  state.trips.push(created);
  notify();
  return created;
}

export async function patchTrip(id, patch) {
  const trip = state.trips.find((t) => t.id === id);
  if (!trip) throw new Error('출장을 찾을 수 없습니다.');

  const before = {};
  Object.keys(patch).forEach((k) => { before[k] = trip[k]; });

  Object.assign(trip, patch);
  notify();

  try {
    await updateTrip(id, patch);
    return { ok: true, undo: () => patchTrip(id, before) };
  } catch (e) {
    Object.assign(trip, before);
    notify();
    throw e;
  }
}

/**
 * 출장은 휴지통이 없다. 지우면 정말 지워진다.
 * 대신 지운 행을 그대로 들고 있다가, 되돌리기를 누르면 같은 id 로 다시 넣는다.
 */
export async function removeTrip(id) {
  const i = state.trips.findIndex((t) => t.id === id);
  if (i < 0) throw new Error('출장을 찾을 수 없습니다.');
  const snapshot = { ...state.trips[i] };

  state.trips.splice(i, 1);
  notify();

  try {
    await deleteTrip(id);
  } catch (e) {
    state.trips.splice(i, 0, snapshot);
    notify();
    throw e;
  }

  return {
    undo: async () => {
      // 서버가 채워주는 값은 빼고 다시 넣는다
      const { created_at, updated_at, user_id, ...row } = snapshot;
      const restored = await insertTrip(row);
      state.trips.push(restored);
      notify();
    },
  };
}

// ---------- 사업 ----------

export function newProjectId() {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// 사업 구분 색. tokens.css 의 --proj-1..10 과 같은 값이다.
// 같은 명도·채도 축에서 골라 열 가지가 한 가족처럼 보인다.
// 이미 저장된 사업 색은 여기 없어도 그대로 둔다 (편집 시트가 첫 칸에 남겨준다).
export const PROJECT_COLORS = [
  '#ab4636', '#a96b33', '#9a7f2e', '#658f32', '#2e9a6e',
  '#2f9c9a', '#3c7fb0', '#4a5cb8', '#7a45b5', '#a93b77',
];

export async function addProject(name) {
  const used = new Set(state.projects.map((p) => p.color));
  const color = PROJECT_COLORS.find((c) => !used.has(c)) || PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length];
  const row = {
    id: newProjectId(),
    name: name.trim() || '새 사업',
    color,
    archived: false,
    sort_order: state.projects.length,
  };
  const { data, error } = await supabase.from('projects').insert(row).select().single();
  if (error) throw new Error(`사업 추가 실패: ${error.message}`);
  state.projects.push(data);
  notify();
  return data;
}

export async function patchProject(id, patch) {
  const project = projectById(id);
  if (!project) throw new Error('사업을 찾을 수 없습니다.');
  const before = {};
  Object.keys(patch).forEach((k) => { before[k] = project[k]; });

  Object.assign(project, patch);
  notify();

  const { error } = await supabase.from('projects').update(patch).eq('id', id);
  if (error) {
    Object.assign(project, before);
    notify();
    throw new Error(`사업 수정 실패: ${error.message}`);
  }
}

/**
 * 사업 순서를 통째로 다시 매긴다.
 * 화면은 이미 바뀌어 있으므로 여기서는 번호만 다시 붙이고 저장한다.
 * 저장이 실패하면 원래 순서로 되돌린다 — 화면과 서버가 어긋난 채 남지 않도록.
 */
export async function reorderProjects(orderedIds) {
  const before = state.projects.map((p) => ({ id: p.id, sort_order: p.sort_order }));

  orderedIds.forEach((id, i) => {
    const p = projectById(id);
    if (p) p.sort_order = i;
  });
  state.projects.sort((a, b) => a.sort_order - b.sort_order);
  notify();

  try {
    await upsertRows('projects', state.projects);
  } catch (e) {
    before.forEach((b) => {
      const p = projectById(b.id);
      if (p) p.sort_order = b.sort_order;
    });
    state.projects.sort((a, b) => a.sort_order - b.sort_order);
    notify();
    throw new Error(`순서를 저장하지 못했습니다: ${e.message}`);
  }
}

/**
 * 사업 하나를 위(-1) 또는 아래(+1)로 한 칸 옮긴다.
 * 키보드로 순서를 바꿀 때 쓴다. 끝에서 더 가면 아무 일도 일어나지 않는다.
 * 반환: 실제로 움직였으면 true
 */
export async function moveProject(id, delta) {
  const ids = state.projects.map((p) => p.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return false;

  ids.splice(to, 0, ids.splice(from, 1)[0]);
  await reorderProjects(ids);
  return true;
}
