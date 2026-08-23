// 데스크톱 앱(v2.9)의 dashboard.json / trips.json 을 DB 형식으로 바꾼다.
//
// 여기가 바깥 파일이 들어오는 유일한 길목이다. 색처럼 화면에 그대로 얹히는 값은
// 여기서 모양을 확인해 걸러낸다. DB 에 들어간 뒤에 고치려면 이미 늦다.
//
// 원칙: id 를 그대로 쓴다.
//   기존 id("p3", "task-1786518879031-4nslf")를 유지해야 업무-사업 연결이
//   이관 중에 흐트러지지 않고, 여러 번 올려도 중복이 생기지 않는다.

import { safeColor } from './store.js';

/** 빈 문자열이나 공백은 null 로. date 컬럼에 ""를 넣으면 에러가 난다. */
function dateOrNull(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  // YYYY-MM-DD 형태만 통과시킨다
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function textOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

function intOrZero(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * dashboard.json 을 { projects, tasks } 로 펼친다.
 * 휴지통(trashedTasks)도 tasks 로 합치되 deleted_at 을 채워 구분한다.
 */
export function convertDashboard(json) {
  const source = Array.isArray(json) ? json : json?.projects;
  if (!Array.isArray(source)) {
    throw new Error('dashboard.json 형식이 아닙니다. projects 배열을 찾지 못했습니다.');
  }

  const projects = [];
  const tasks = [];
  const warnings = [];

  source.forEach((p, pIndex) => {
    const projectId = String(p?.id ?? '').trim();
    if (!projectId) {
      warnings.push(`${pIndex + 1}번째 사업에 id 가 없어 건너뜁니다.`);
      return;
    }

    projects.push({
      id: projectId,
      name: textOrEmpty(p.name) || '이름 없는 사업',
      color: safeColor(p.color, '#2e9a6e'),
      archived: Boolean(p.archived),
      sort_order: pIndex,
    });

    const pushTask = (t, index, deletedAt) => {
      const taskId = String(t?.id ?? '').trim();
      if (!taskId) {
        warnings.push(`'${p.name}' 의 ${index + 1}번째 업무에 id 가 없어 건너뜁니다.`);
        return;
      }
      tasks.push({
        id: taskId,
        project_id: projectId,
        title: textOrEmpty(t.title) || '제목 없는 업무',
        priority: textOrEmpty(t.priority) || 'normal',
        status: textOrEmpty(t.status) || 'todo',
        completed: Boolean(t.completed),
        due_date: dateOrNull(t.dueDate),
        note: textOrEmpty(t.note),
        link: textOrEmpty(t.link),
        work_date: dateOrNull(t.workDate),
        last_rolled_date: dateOrNull(t.lastRolledDate),
        carried_count: intOrZero(t.carriedCount),
        pinned: Boolean(t.pinned),
        sort_order: index,
        deleted_at: deletedAt,
      });
    };

    (Array.isArray(p.tasks) ? p.tasks : []).forEach((t, i) => {
      // 원본에 deletedAt 이 남아 있으면 그대로 존중한다
      const d = textOrEmpty(t.deletedAt).trim();
      pushTask(t, i, d ? d : null);
    });

    // 휴지통에 있던 업무들 — 삭제 시각을 모르면 이관 시각으로 표시한다
    (Array.isArray(p.trashedTasks) ? p.trashedTasks : []).forEach((t, i) => {
      const d = textOrEmpty(t.deletedAt).trim();
      pushTask(t, i, d ? d : new Date().toISOString());
    });
  });

  return { projects, tasks, warnings };
}

/** trips.json 을 DB 형식으로. project_id 는 실제 있는 사업만 연결한다. */
export function convertTrips(json, knownProjectIds = []) {
  const source = Array.isArray(json) ? json : json?.trips;
  if (!Array.isArray(source)) {
    throw new Error('trips.json 형식이 아닙니다. trips 배열을 찾지 못했습니다.');
  }

  const known = new Set(knownProjectIds);
  const trips = [];
  const warnings = [];

  source.forEach((t, i) => {
    const id = String(t?.id ?? '').trim();
    if (!id) {
      warnings.push(`${i + 1}번째 출장에 id 가 없어 건너뜁니다.`);
      return;
    }

    // 없는 사업을 가리키면 연결을 끊는다. 그대로 두면 외래키 오류가 난다.
    let projectId = String(t.projectId ?? '').trim() || null;
    if (projectId && !known.has(projectId)) {
      warnings.push(`출장 '${t.title}' 이 없는 사업(${projectId})을 가리켜 연결을 해제했습니다.`);
      projectId = null;
    }

    // 날짜가 없는 출장은 달력에 그릴 수가 없다. 조용히 사라지면 찾을 방법이 없으므로
    // 들어가기 전에 알려준다.
    if (!dateOrNull(t.startDate)) {
      warnings.push(`출장 '${textOrEmpty(t.title) || id}' 에 시작일이 없어 달력에 나오지 않습니다.`);
    }

    trips.push({
      id,
      title: textOrEmpty(t.title) || '제목 없는 출장',
      start_date: dateOrNull(t.startDate),
      end_date: dateOrNull(t.endDate) ?? dateOrNull(t.startDate),
      location: textOrEmpty(t.location),
      project_id: projectId,
      color: safeColor(t.color, '#7459e8'),
      note: textOrEmpty(t.note),
    });
  });

  return { trips, warnings };
}

/** 이관 전에 눈으로 확인할 요약 */
export function summarize({ projects = [], tasks = [], trips = [] }) {
  const live = tasks.filter((t) => !t.deleted_at);
  return {
    사업: projects.length,
    보관사업: projects.filter((p) => p.archived).length,
    업무: live.length,
    휴지통: tasks.length - live.length,
    완료: live.filter((t) => t.completed).length,
    미완료: live.filter((t) => !t.completed).length,
    이월있음: live.filter((t) => t.carried_count > 0).length,
    출장: trips.length,
  };
}
