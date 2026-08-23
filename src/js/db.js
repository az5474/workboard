// Supabase 클라이언트와 데이터 접근 함수
// 빌드 도구 없이 쓰기 위해 CDN 에서 ES 모듈로 직접 가져온다.

// 버전을 정확히 박아둔다. '@2' 로 두면 새 배포가 나올 때마다 우리 앱이 같이 바뀐다.
// 그쪽에서 뭔가 깨지면 내 코드를 하나도 안 건드렸는데 앱이 멈춘다.
// 올릴 때는 여기 숫자를 직접 바꾸고 한 번 확인하고 올린다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,      // 새로고침해도 로그인 유지
    autoRefreshToken: true,
    detectSessionInUrl: true,  // 메일 링크로 돌아왔을 때 세션 인식
  },
});

// ---------- 인증 ----------

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split('#')[0] },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ---------- 조회 ----------

export async function fetchProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchTasks({ includeDeleted = false } = {}) {
  let query = supabase.from('tasks').select('*').order('sort_order', { ascending: true });
  if (!includeDeleted) query = query.is('deleted_at', null);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function fetchTrips() {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('start_date', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function countAll() {
  const tables = ['projects', 'tasks', 'trips'];
  const result = {};
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) throw error;
    result[t] = count ?? 0;
  }
  return result;
}

// ---------- 쓰기 ----------

// upsert 로 넣는다. 같은 id 를 다시 올려도 중복이 생기지 않아
// 이관을 여러 번 시도해도 안전하다.
export async function upsertRows(table, rows, chunkSize = 200) {
  let done = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`${table} 저장 실패: ${error.message}`);
    done += chunk.length;
  }
  return done;
}

export async function deleteAllRows(table) {
  // RLS 때문에 본인 행만 지워진다.
  const { error } = await supabase.from(table).delete().neq('id', '__never__');
  if (error) throw new Error(`${table} 비우기 실패: ${error.message}`);
}

export async function updateTask(id, patch) {
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`업무 수정 실패: ${error.message}`);
  return data;
}

export async function insertTask(row) {
  const { data, error } = await supabase.from('tasks').insert(row).select().single();
  if (error) throw new Error(`업무 추가 실패: ${error.message}`);
  return data;
}

/** 휴지통으로 보낸다. 하드 삭제하지 않는다. */
export async function trashTask(id) {
  return updateTask(id, { deleted_at: new Date().toISOString() });
}

/** 새 업무 id. 기존 데스크톱 앱과 같은 형식을 쓴다. */
export function newTaskId() {
  const rand = Math.random().toString(36).slice(2, 7);
  return `task-${Date.now()}-${rand}`;
}

// ---------- 출장 ----------

export function newTripId() {
  const rand = Math.random().toString(36).slice(2, 7);
  return `trip-${Date.now()}-${rand}`;
}

export async function insertTrip(row) {
  const { data, error } = await supabase.from('trips').insert(row).select().single();
  if (error) throw new Error(`출장 추가 실패: ${error.message}`);
  return data;
}

export async function updateTrip(id, patch) {
  const { data, error } = await supabase
    .from('trips')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`출장 수정 실패: ${error.message}`);
  return data;
}

/**
 * 출장은 휴지통이 없다 (테이블에 deleted_at 이 없다).
 * 대신 지운 행을 그대로 들고 있다가 되돌리기를 누르면 같은 id 로 다시 넣는다.
 */
export async function deleteTrip(id) {
  const { error } = await supabase.from('trips').delete().eq('id', id);
  if (error) throw new Error(`출장 삭제 실패: ${error.message}`);
}
