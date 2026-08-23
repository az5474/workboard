-- ============================================================
-- 일회성 데이터 정리 (2026-08-23)
--   1) 기한이 지난 미완료 업무의 마감일을 2026-08-24 로 옮긴다
--   2) 모든 업무의 이월 횟수를 0 으로 초기화한다
--   3) 미완료 업무를 오늘 할 일로 올린다
--
-- Supabase SQL Editor 에 붙여넣고 Run.
-- SQL Editor 는 관리자 권한으로 실행되므로 RLS 와 무관하게 적용된다.
-- ============================================================

-- 실행 전 상태 확인
select
  count(*) filter (where not completed and due_date < '2026-08-24') as "기한지난_미완료",
  count(*) filter (where carried_count > 0)                          as "이월기록_있음",
  max(carried_count)                                                 as "최대이월"
from public.tasks
where deleted_at is null;

-- ------------------------------------------------------------
-- 1) 기한이 지난 미완료 업무 → 2026-08-24 로
-- ------------------------------------------------------------
update public.tasks
set due_date = '2026-08-24'
where deleted_at is null
  and not completed
  and due_date is not null
  and due_date < '2026-08-24';

-- ------------------------------------------------------------
-- 2) 이월 횟수 초기화 (완료된 것 포함 전체)
--    lastRolledDate 도 비워 오늘부터 다시 세도록 한다.
-- ------------------------------------------------------------
update public.tasks
set carried_count = 0,
    last_rolled_date = null
where deleted_at is null;

-- ------------------------------------------------------------
-- 3) 미완료 업무를 오늘(2026-08-23) 할 일로 올린다
--    이월 기능이 내일부터 자연스럽게 이어받는다.
-- ------------------------------------------------------------
update public.tasks
set work_date = '2026-08-23'
where deleted_at is null
  and not completed;

-- 실행 후 확인
select
  count(*)                                          as "전체_미완료",
  count(*) filter (where work_date = '2026-08-23')  as "오늘_할일",
  count(*) filter (where due_date = '2026-08-24')   as "내일_마감",
  count(*) filter (where carried_count > 0)         as "이월기록_남음"
from public.tasks
where deleted_at is null and not completed;
