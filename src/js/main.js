// 앱 진입점: 로그인 · 뷰 전환 · 이월 실행 · 데이터 가져오기

import { supabase, getSession, sendMagicLink, signOut, countAll, upsertRows } from './db.js';
import { convertDashboard, convertTrips, summarize } from './migrate.js';
import {
  state, loadAll, runRollover, addTask, todayStr, formatDateLabel, cleanupOverdue, subscribe,
  shiftCalMonth, setCalMonth, monthOf,
} from './store.js';
import { $, toast, openProjectSheet, openTripSheet, pendingUndo, escapeHtml } from './ui.js';
import { renderAll, initViews } from './views.js';

let started = false;
let pending = null;

// ---------- 도우미 ----------

function showMessage(node, text, kind = 'info') {
  node.className = `notice notice-${kind}`;
  node.textContent = text;
  node.classList.remove('hidden');
}
const hide = (node) => node.classList.add('hidden');

// 버튼 안에 아이콘이 있을 수 있으므로 글자가 아니라 내용을 통째로 맡아둔다
const busyStash = new WeakMap();

function setBusy(button, busy, busyText = '처리 중') {
  if (busy) {
    if (!busyStash.has(button)) busyStash.set(button, button.innerHTML);
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${busyText}`;
  } else {
    button.disabled = false;
    if (busyStash.has(button)) {
      button.innerHTML = busyStash.get(button);
      busyStash.delete(button);
    }
  }
}

// ---------- 로그인 ----------

$('btn-login').addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email.includes('@')) {
    showMessage($('login-msg'), '이메일 주소를 확인해 주세요.', 'error');
    return;
  }
  setBusy($('btn-login'), true, '보내는 중');
  try {
    await sendMagicLink(email);
    showMessage($('login-msg'), `${email} 로 로그인 링크를 보냈습니다. 메일함을 확인해 주세요.`, 'success');
  } catch (e) {
    showMessage($('login-msg'), `보내지 못했습니다: ${e.message}`, 'error');
  } finally {
    setBusy($('btn-login'), false);
  }
});

$('btn-logout').addEventListener('click', async () => {
  await signOut();
  location.reload();
});

// ---------- 뷰 전환 ----------

const VIEWS = ['board', 'list', 'calendar', 'trash', 'settings'];

function switchView(view) {
  state.view = view;
  VIEWS.forEach((v) => {
    $(`pane-${v}`).classList.toggle('hidden', v !== view);
  });
  document.querySelectorAll('.pill[data-view]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.view === view));
  document.querySelectorAll('.tabbar-btn').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.view === view));
  // 설정은 알약 탭이 아니라 아이콘이라, 여기에도 지금 어디인지 표시한다
  document.querySelectorAll('.icon-btn[data-view]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.view === view));

  // 보드 밖에서는 사업 칩이 의미가 옅어진다. 달력은 사업별로 거르는 게 쓸모 있어 남긴다.
  $('project-chips').classList.toggle('hidden', view === 'settings' || view === 'trash');

  if (view === 'settings') refreshStats();
  renderAll();
  window.scrollTo({ top: 0 });
}

document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// views.js 가 화면을 바꾸고 싶을 때 쓰는 문. (switchView 를 직접 주면 서로 물고 돈다)
document.addEventListener('wb:view', (e) => switchView(e.detail));

// ---------- 검색 ----------

// 검색어를 친다고 화면을 멋대로 바꾸지 않는다.
// 보드에서 검색하면 보드 안에서 걸러지고, 전체를 보려면 직접 '전체' 탭을 누른다.
let searchTimer = null;
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value;
    renderAll();
  }, 180);
});
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.target.value = ''; state.search = ''; renderAll(); }
});

// ---------- 화면 밝기 ----------
// 자동 → 밝게 → 어둡게 를 돌아간다. 아이콘이 지금 어느 상태인지 말해준다.

const THEME_KEY = 'workboard-theme';
const THEME_ICON = { auto: '#i-auto', light: '#i-sun', dark: '#i-moon' };
const THEME_LABEL = { auto: '시스템 설정을 따릅니다', light: '밝게', dark: '어둡게' };

function applyTheme(theme) {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);

  const ico = $('theme-icon');
  if (ico) ico.setAttribute('href', THEME_ICON[theme] || THEME_ICON.auto);
  const btn = $('btn-theme');
  if (btn) btn.title = `화면 밝기: ${THEME_LABEL[theme]}`;
}

$('btn-theme').addEventListener('click', () => {
  const now = localStorage.getItem(THEME_KEY) || 'auto';
  const next = now === 'auto' ? 'light' : now === 'light' ? 'dark' : 'auto';
  applyTheme(next);
  toast(THEME_LABEL[next]);
});
applyTheme(localStorage.getItem(THEME_KEY) || 'auto');

// ---------- 키보드 ----------
//
// 매일 여는 도구다. 손이 마우스로 가지 않아도 되게 한다.
// 입력창 안에서는 아무 일도 하지 않는다 — 'n' 을 못 치면 곤란하다.

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** 모바일에서도 같은 자리로 데려간다: 보드로 옮기고 입력창에 커서를 둔다. */
function focusQuickAdd() {
  if (state.view !== 'board') switchView('board');
  const el = $('quick-title');
  // scrollIntoView 는 CSS 의 scroll-behavior 를 무시하므로 여기서 직접 확인한다
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  el.focus();
}

document.addEventListener('keydown', (e) => {
  // 시트가 떠 있으면 시트가 키를 가져간다 (ui.js 가 처리)
  if (document.getElementById('sheet-backdrop').classList.contains('is-open')) return;

  // 되돌리기는 입력창 안에서도 통해야 하지만, 글자를 되돌리는 것과 겹치면 안 된다
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
    if (pendingUndo) { e.preventDefault(); pendingUndo(); }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (isTyping(e.target)) {
    // 검색창에서 Esc 는 검색어를 지운다 (search 자체 처리와 별개로 여기서도 빠져나온다)
    if (e.key === 'Escape' && e.target.id === 'search') e.target.blur();
    return;
  }

  // 달력에서는 좌우 화살표가 달을 넘긴다
  if (state.view === 'calendar' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    shiftCalMonth(e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }

  switch (e.key) {
    case '/':
      e.preventDefault();
      $('search').focus();
      break;
    case 'n': case 'N': case 'ㅜ':
      e.preventDefault();
      focusQuickAdd();
      break;
    case '1': switchView('board'); break;
    case '2': switchView('list'); break;
    case '3': switchView('calendar'); break;
    case '4': switchView('trash'); break;
    case '5': switchView('settings'); break;
    default: break;
  }
});

// ---------- 출장 달력 ----------

$('cal-prev').addEventListener('click', () => shiftCalMonth(-1));
$('cal-next').addEventListener('click', () => shiftCalMonth(1));
$('cal-today').addEventListener('click', () => setCalMonth(monthOf()));
$('btn-add-trip').addEventListener('click', () => openTripSheet());

// ---------- 빠른 추가 ----------

// 사업 목록이 실제로 달라졌을 때만 다시 만든다.
// 상태가 바뀔 때마다 select 를 헐어내면 펼쳐놓고 고르던 중에 목록이 닫힌다.
let quickProjectsKey = '';

function renderQuickProjects(force = false) {
  const live = state.projects.filter((p) => !p.archived);
  const key = live.map((p) => `${p.id}:${p.name}`).join('|');
  if (!force && key === quickProjectsKey) return;
  quickProjectsKey = key;

  const sel = $('quick-project');
  const prev = sel.value;
  sel.innerHTML = '';
  live.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  });
  if (prev && live.some((p) => p.id === prev)) sel.value = prev;
  else if (state.projectFilter !== 'all') sel.value = state.projectFilter;
  paintQuickDot();
}

// 사업 탭에 들어가면 그 사업에 바로 적을 수 있어야 한다.
// 사업을 골라놓고 다른 사업에 업무를 적어버리는 일이 이 앱에서 가장 흔한 실수다.
let lastFilter = state.projectFilter;

function followProjectFilter() {
  if (state.projectFilter === lastFilter) return;
  lastFilter = state.projectFilter;
  if (lastFilter === 'all') return;      // 전체로 돌아올 때는 마지막에 쓰던 사업을 그대로 둔다

  const sel = $('quick-project');
  if ([...sel.options].some((o) => o.value === lastFilter)) sel.value = lastFilter;
}

// 사업 순서를 바꾸거나 이름을 고치면 여기 목록도 따라간다
subscribe(() => {
  renderQuickProjects();
  followProjectFilter();
  paintQuickDot();
});

/** 어느 사업에 적히는지 색으로 보여준다. 잘못 적어두는 일이 줄어든다. */
function paintQuickDot() {
  const p = state.projects.find((x) => x.id === $('quick-project').value);
  $('quick-dot').style.background = p?.color || 'var(--stone)';
}
$('quick-project').addEventListener('change', paintQuickDot);

// ---------- 빠른 추가의 마감일 ----------
// 진짜 입력은 투명하게 숨어 있고, 고른 날짜를 라벨에 적어준다.

function paintQuickDue() {
  const v = $('quick-due').value;
  const wrap = $('quick-due-wrap');
  const label = $('quick-due-label');
  if (v) {
    label.textContent = `${Number(v.slice(5, 7))}.${Number(v.slice(8))} 마감`;
    wrap.classList.add('is-set');
  } else {
    label.textContent = '마감일';
    wrap.classList.remove('is-set');
  }
}
$('quick-due').addEventListener('change', paintQuickDue);

// 폰은 누르면 달력이 저절로 뜨지만, 데스크톱 크롬은 숨은 입력을 눌러도 안 뜬다.
// 데스크톱에서만 직접 열어준다 (폰에서도 부르면 두 번 뜨거나 닫힌다).
$('quick-due-wrap').addEventListener('click', () => {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  try { $('quick-due').showPicker?.(); } catch { /* 포커스만으로 충분한 브라우저 */ }
});

// 폰에서 가장 자주 하는 일은 "지금 생각난 것 적어두기" 다
$('tab-add').addEventListener('click', focusQuickAdd);

async function quickAdd() {
  const titleEl = $('quick-title');
  const title = titleEl.value.trim();
  const projectId = $('quick-project').value;
  if (!title) { titleEl.focus(); return; }
  if (!projectId) { toast('사업을 먼저 만들어 주세요'); return; }

  const btn = $('btn-quick-add');
  btn.disabled = true;
  try {
    await addTask({ projectId, title, dueDate: $('quick-due').value || null });
    titleEl.value = '';
    $('quick-due').value = '';     // 마감일은 매번 새로 정한다
    paintQuickDue();
    toast('업무를 추가했습니다');
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    titleEl.focus();
  }
}

$('btn-quick-add').addEventListener('click', quickAdd);
$('quick-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAdd(); });

// ---------- 사업 추가 ----------

$('btn-add-project').addEventListener('click', () => openProjectSheet());
$('btn-add-project-2').addEventListener('click', () => openProjectSheet());

// ---------- 서버 현황 ----------

async function refreshStats() {
  try {
    const c = await countAll();
    const box = $('db-stats');
    box.innerHTML = '';
    Object.entries({ 사업: c.projects, 업무: c.tasks, 출장: c.trips }).forEach(([label, value]) => {
      const el = document.createElement('div');
      el.className = 'sum';
      el.innerHTML = `<div class="sum-value">${value}</div><div class="sum-label">${label}</div>`;
      box.appendChild(el);
    });
  } catch (e) {
    showMessage($('import-msg'), `데이터를 읽지 못했습니다: ${e.message}`, 'error');
  }
}
$('btn-refresh').addEventListener('click', refreshStats);

// ---------- 백업 ----------
//
// 서버가 전부지만, 서버 하나만 믿는 건 백업이 아니다.
// 화면에 이미 있는 데이터를 그대로 파일로 내린다 (휴지통 포함 — loadAll 이 다 가져온다).
// 복원은 upsert 라 같은 파일을 여러 번 올려도 안전하고, 파일에 없는 것은 지우지 않는다.

function backupStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

$('btn-backup').addEventListener('click', () => {
  const data = {
    app: 'workboard',
    version: 1,
    exported_at: new Date().toISOString(),
    projects: state.projects,
    tasks: state.tasks,
    trips: state.trips,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `업무보드-백업-${backupStamp()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('백업 파일을 내려받았습니다');
});

$('btn-restore').addEventListener('click', () => $('file-restore').click());
$('file-restore').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  hide($('backup-msg'));
  try {
    const json = JSON.parse(await file.text());
    if (json.app !== 'workboard' || !Array.isArray(json.projects) || !Array.isArray(json.tasks)) {
      throw new Error('업무보드 백업 파일이 아닙니다.');
    }
    // 서버가 채우는 값은 빼고 올린다. 특히 user_id 를 남겨두면
    // 다른 계정의 백업일 때 RLS 에 걸려 전부 실패한다.
    const strip = ({ user_id, created_at, updated_at, ...rest }) => rest;
    const p = await upsertRows('projects', json.projects.map(strip));
    const t = await upsertRows('tasks', json.tasks.map(strip));
    const r = Array.isArray(json.trips) && json.trips.length
      ? await upsertRows('trips', json.trips.map(strip)) : 0;
    await loadAll();
    showMessage($('backup-msg'), `복원했습니다. 사업 ${p}개 · 업무 ${t}개 · 출장 ${r}개`, 'success');
    toast('복원했습니다');
  } catch (err) {
    showMessage($('backup-msg'), `복원하지 못했습니다: ${err.message}`, 'error');
  } finally {
    e.target.value = '';
  }
});

// ---------- 밀린 업무 정리 ----------

// 기본값은 내일. "지난 건 일단 내일로 미루고 다시 보자"가 가장 흔한 쓰임이다.
(function initCleanupDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  $('cleanup-date').value = todayStr(d);
})();

$('btn-cleanup').addEventListener('click', async () => {
  const moveDueTo = $('cleanup-date').value || null;
  const resetCarried = $('cleanup-reset').checked;
  const pullToToday = $('cleanup-pull').checked;

  const btn = $('btn-cleanup');
  setBusy(btn, true, '정리 중');
  hide($('cleanup-msg'));
  try {
    const r = await cleanupOverdue({ moveDueTo, resetCarried, pullToToday });
    showMessage($('cleanup-msg'),
      `마감일 이동 ${r.moved}건 · 이월 초기화 ${r.reset}건 · 오늘로 ${r.pulled}건`, 'success');
    toast('정리했습니다');
  } catch (e) {
    showMessage($('cleanup-msg'), `정리하지 못했습니다: ${e.message}`, 'error');
  } finally {
    setBusy(btn, false);
  }
});

// ---------- 가져오기 ----------

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { resolve(JSON.parse(reader.result)); }
      catch { reject(new Error(`${file.name} 을 읽지 못했습니다.`)); }
    };
    reader.onerror = () => reject(new Error(`${file.name} 을 열지 못했습니다.`));
    reader.readAsText(file, 'utf-8');
  });
}

async function buildPreview() {
  const dashFile = $('file-dashboard').files?.[0];
  const tripFile = $('file-trips').files?.[0];
  if (!dashFile) { pending = null; $('btn-import').disabled = true; hide($('preview')); return; }

  try {
    const { projects, tasks, warnings } = convertDashboard(await readJsonFile(dashFile));
    let trips = [], tripWarnings = [];
    if (tripFile) {
      const c = convertTrips(await readJsonFile(tripFile), projects.map((p) => p.id));
      trips = c.trips; tripWarnings = c.warnings;
    }
    pending = { projects, tasks, trips };

    const box = $('preview-stats');
    box.innerHTML = '';
    Object.entries(summarize(pending)).forEach(([label, value]) => {
      const el = document.createElement('div');
      el.className = 'sum';
      el.innerHTML = `<div class="sum-value">${value}</div><div class="sum-label">${label}</div>`;
      box.appendChild(el);
    });

    const all = [...warnings, ...tripWarnings];
    const warnBox = $('preview-warnings');
    if (all.length) {
      warnBox.className = 'notice notice-info';
      // 경고 문구 안에는 가져온 파일의 사업명·출장명이 그대로 섞여 있다.
      // 남이 준 파일을 열어보는 화면이라 여기는 반드시 escape 한다.
      warnBox.innerHTML = `<div class="stack stack-xs"><strong class="text-sm">확인할 점 ${all.length}건</strong>` +
        all.map((w) => `<div class="text-cap">· ${escapeHtml(w)}</div>`).join('') + '</div>';
      warnBox.classList.remove('hidden');
    } else hide(warnBox);

    $('preview').classList.remove('hidden');
    $('btn-import').disabled = false;
  } catch (e) {
    pending = null;
    $('btn-import').disabled = true;
    hide($('preview'));
    showMessage($('import-msg'), e.message, 'error');
  }
}

$('file-dashboard').addEventListener('change', buildPreview);
$('file-trips').addEventListener('change', buildPreview);

$('btn-import').addEventListener('click', async () => {
  if (!pending) return;
  setBusy($('btn-import'), true, '옮기는 중');
  try {
    const p = await upsertRows('projects', pending.projects);
    const t = await upsertRows('tasks', pending.tasks);
    const r = pending.trips.length ? await upsertRows('trips', pending.trips) : 0;
    showMessage($('import-msg'), `옮겼습니다. 사업 ${p}개 · 업무 ${t}개 · 출장 ${r}개`, 'success');
    await refreshStats();
    await loadAll();
    renderQuickProjects();
  } catch (e) {
    showMessage($('import-msg'), `옮기지 못했습니다: ${e.message}`, 'error');
  } finally {
    setBusy($('btn-import'), false);
  }
});

// ---------- 시작 ----------

async function boot() {
  const session = await getSession();
  if (!session) {
    $('view-app').classList.add('hidden');
    $('view-login').classList.remove('hidden');
    return;
  }

  hide($('view-login'));
  $('view-app').classList.remove('hidden');
  $('user-email').textContent = session.user.email ?? '';
  $('today-label').textContent = formatDateLabel();

  if (started) { await loadAll(); renderQuickProjects(); return; }
  started = true;

  initViews();
  showSkeleton();

  try {
    await loadAll();
    renderQuickProjects();

    // 어제 못 끝낸 일을 오늘로 넘긴다
    // (쌓인 이월 기록을 걷어내는 것은 설정 > 밀린 업무 정리 에서 직접 실행한다)
    const moved = await runRollover();
    if (moved > 0) toast(`${moved}건을 오늘로 넘겼습니다`);
  } catch (e) {
    showLoadError(e.message);
  }
}

/** 데이터가 오는 동안 빈 화면 대신 뼈대를 보여준다. 고장난 것처럼 보이지 않도록. */
function showSkeleton() {
  // 줄 길이를 조금씩 다르게 둔다. 전부 같은 길이면 뼈대가 아니라 표처럼 보인다.
  const widths = ['62%', '44%', '73%'];
  const box = $('list-projects');
  box.innerHTML = Array.from({ length: 2 }, () => `
    <div class="pcard">
      <div class="pcard-head" style="cursor:default">
        <span class="pcard-bar skeleton"></span>
        <span class="pcard-title"><span class="skeleton" style="display:inline-block;height:13px;width:120px"></span></span>
      </div>
      <div class="pcard-body">
        ${widths.map((w) => `
          <div class="task is-flat">
            <span class="task-check" style="border-color:var(--hairline-soft)"></span>
            <div class="task-body"><span class="skeleton" style="height:13px;width:${w}"></span></div>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function showLoadError(message) {
  const box = $('list-projects');
  box.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'notice notice-error';
  wrap.innerHTML = `<div class="stack stack-md"><span>불러오지 못했습니다: ${message}</span></div>`;
  const retry = document.createElement('button');
  retry.className = 'btn btn-primary btn-sm';
  retry.textContent = '다시 시도';
  retry.addEventListener('click', async () => {
    showSkeleton();
    try { await loadAll(); renderQuickProjects(); }
    catch (e) { showLoadError(e.message); }
  });
  wrap.querySelector('.stack').appendChild(retry);
  box.appendChild(wrap);
}

// ---------- 자정 넘김 ----------
// 밤새 열어둔 창이 어제 날짜에 머물지 않도록 한다.
let currentDay = todayStr();
setInterval(async () => {
  const now = todayStr();
  if (now === currentDay) return;
  currentDay = now;
  $('today-label').textContent = formatDateLabel();
  try {
    await loadAll();
    const moved = await runRollover();
    toast(moved > 0 ? `날짜가 바뀌어 ${moved}건을 오늘로 넘겼습니다` : '날짜가 바뀌었습니다');
  } catch { /* 다음 주기에 다시 시도한다 */ }
}, 60_000);

// ---------- 다른 기기에서 바꾼 내용 반영 ----------
// 창으로 돌아왔을 때 다시 읽는다. 폰에서 체크하고 PC를 보면 반영되도록.
let lastSync = Date.now();
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  if (Date.now() - lastSync < 5000) return;   // 잦은 전환에 매번 받아오지 않는다
  lastSync = Date.now();
  try {
    await loadAll();
    const now = todayStr();
    if (now !== currentDay) {
      currentDay = now;
      $('today-label').textContent = formatDateLabel();
      await runRollover();
    }
  } catch { /* 조용히 넘긴다. 다음 기회에 다시 맞춰진다 */ }
});

supabase.auth.onAuthStateChange((_e, session) => { if (session) boot(); });
boot();
