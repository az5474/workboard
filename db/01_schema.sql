-- ============================================================
-- 업무보드 스키마 v1
-- Supabase SQL Editor 에 통째로 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다 (create if not exists / drop policy if exists).
-- ============================================================

-- 데스크톱 앱(dashboard.json)의 구조를 그대로 옮긴다.
-- id 는 기존 값("p3", "task-1786518879031-4nslf")을 그대로 쓰기 위해 text 로 둔다.
-- 그래야 업무-사업 연결이 이관 과정에서 흐트러지지 않는다.

-- ------------------------------------------------------------
-- 사업
-- ------------------------------------------------------------
create table if not exists public.projects (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default '',
  color       text not null default '#2a9d8f',
  archived    boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 업무
--   priority : normal | high | urgent
--   status   : todo | doing | internal_wait | external_wait | done
--   값을 CHECK 로 묶지 않는다. 앱에서 상태를 늘릴 때 마이그레이션이 걸리지 않도록.
--   deleted_at 이 채워지면 휴지통에 있는 것으로 본다(하드 삭제하지 않음).
-- ------------------------------------------------------------
create table if not exists public.tasks (
  id                text primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  project_id        text not null references public.projects(id) on delete cascade,
  title             text not null default '',
  priority          text not null default 'normal',
  status            text not null default 'todo',
  completed         boolean not null default false,
  due_date          date,
  note              text not null default '',
  link              text not null default '',
  work_date         date,            -- '오늘의 업무'로 올린 날짜
  last_rolled_date  date,            -- 마지막으로 이월된 날짜
  carried_count     integer not null default 0,   -- 며칠째 이월됐는지
  pinned            boolean not null default false, -- 오늘의 핵심 3
  sort_order        integer not null default 0,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 출장
-- ------------------------------------------------------------
create table if not exists public.trips (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default '',
  start_date  date,
  end_date    date,
  location    text not null default '',
  project_id  text references public.projects(id) on delete set null,
  color       text not null default '#7459e8',
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 인덱스 (화면에서 자주 거는 조건들)
-- ------------------------------------------------------------
create index if not exists idx_projects_user      on public.projects (user_id, sort_order);
create index if not exists idx_tasks_user_project on public.tasks (user_id, project_id);
create index if not exists idx_tasks_user_work    on public.tasks (user_id, work_date);
create index if not exists idx_tasks_user_due     on public.tasks (user_id, due_date);
create index if not exists idx_tasks_user_live    on public.tasks (user_id) where deleted_at is null;
create index if not exists idx_trips_user_start   on public.trips (user_id, start_date);

-- ------------------------------------------------------------
-- updated_at 자동 갱신
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_tasks_touch on public.tasks;
create trigger trg_tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_trips_touch on public.trips;
create trigger trg_trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- user_id 자동 채우기
--   앱에서 매번 user_id 를 실어 보내지 않아도 되도록 서버가 채운다.
-- ------------------------------------------------------------
create or replace function public.set_user_id()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is null then
    new.user_id = auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_user on public.projects;
create trigger trg_projects_user before insert on public.projects
  for each row execute function public.set_user_id();

drop trigger if exists trg_tasks_user on public.tasks;
create trigger trg_tasks_user before insert on public.tasks
  for each row execute function public.set_user_id();

drop trigger if exists trg_trips_user on public.trips;
create trigger trg_trips_user before insert on public.trips
  for each row execute function public.set_user_id();

-- ------------------------------------------------------------
-- RLS (Row Level Security)
--   Publishable key 가 공개돼도 안전한 이유가 바로 이것이다.
--   로그인한 본인의 행만 읽고 쓸 수 있다.
-- ------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.tasks    enable row level security;
alter table public.trips    enable row level security;

drop policy if exists "own_projects" on public.projects;
create policy "own_projects" on public.projects
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own_tasks" on public.tasks;
create policy "own_tasks" on public.tasks
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own_trips" on public.trips;
create policy "own_trips" on public.trips
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 확인용
-- ------------------------------------------------------------
select
  tablename,
  rowsecurity as "RLS 켜짐"
from pg_tables
where schemaname = 'public'
  and tablename in ('projects','tasks','trips')
order by tablename;
