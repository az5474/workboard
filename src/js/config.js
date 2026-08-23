// Supabase 접속 정보
//
// 여기 있는 publishable key 는 공개돼도 되는 값이다.
// 브라우저로 내려가는 값이라 애초에 숨길 수 없고,
// RLS(Row Level Security) 정책이 "로그인한 본인 행만" 접근을 막아준다.
//
// secret key 는 절대 여기에 넣지 않는다. RLS 를 무시하고 DB 전체가 열린다.

export const SUPABASE_URL = 'https://vfxspwjzvjlqqklzudnm.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mKd_FikL_LBXcsV0ZVcvHA_MIjdpbrl';

export const APP_NAME = '업무보드';
