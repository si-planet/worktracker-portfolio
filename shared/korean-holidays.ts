import { dayCalendar } from './day-calendar';

/** Explicit published dates only; other years are intentionally unknown. */
export const KR_HOLIDAY_YEARS = [2026, 2027] as const;
export const KR_HOLIDAY_VERIFIED_ON = '2026-10-23';
export const KR_HOLIDAY_SOURCES = [
  {
    title: '우주항공청 2026년 월력요항 (2025-06-30)',
    url: 'https://www.kasa.go.kr/bbs/BBSMSTR_000000000010/view.do?nttId=B000000001860Pe2zT3',
  },
  {
    title: '인사혁신처 노동절·제헌절 공휴일 지정 (2026-04-29)',
    url: 'https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&category=&cntId=4250&mode=view&pageIdx=',
  },
  {
    title: '관세청 2026년 대한민국 공휴일 (선거일 포함)',
    url: 'https://www.customs.go.kr/engportal/cm/cntnts/cntntsView.do?cntntsId=7401&mi=13284',
  },
  {
    title: '우주항공청 2027년 월력요항 발표 (2026-06-29)',
    url: 'https://www.kasa.go.kr/prog/plcyBrf/brief/kor/sub01_01_04/view.do?plcyBrfNo=431',
  },
  {
    title: '전자관보 제21268호 우주항공청공고 제2026-0078호 (PDF 4쪽 공휴일 표)',
    url: 'https://www.gwanbo.go.kr/ezpdf/customLayout.jsp?contentId=I0000000000000001782374733940000&tocId=I0000000000000001782199865342000&isTocOrder=N',
  },
] as const;

// Ordinary Sundays are represented by dayCalendar().isWeekend, not duplicated here.
// Includes the 2026 amendments and the published 2027 table; no date extrapolation is used.
const HOLIDAYS: Readonly<Record<string, string>> = {
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절',
  '2026-03-02': '삼일절 대체공휴일',
  '2026-05-01': '노동절',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '부처님오신날 대체공휴일',
  '2026-06-03': '전국동시지방선거',
  '2026-06-06': '현충일',
  '2026-07-17': '제헌절',
  '2026-08-15': '광복절',
  '2026-08-17': '광복절 대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-05': '개천절 대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  // 2027: gazette notice 2026-0078, PDF page 4; 24 dates, including 7 substitutes.
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-02-09': '설날 대체공휴일',
  '2027-03-01': '삼일절',
  '2027-05-01': '노동절',
  '2027-05-03': '노동절 대체공휴일',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-07-17': '제헌절',
  '2027-07-19': '제헌절 대체공휴일',
  '2027-08-15': '광복절',
  '2027-08-16': '광복절 대체공휴일',
  '2027-09-14': '추석 연휴',
  '2027-09-15': '추석',
  '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절',
  '2027-10-04': '개천절 대체공휴일',
  '2027-10-09': '한글날',
  '2027-10-11': '한글날 대체공휴일',
  '2027-12-25': '성탄절',
  '2027-12-27': '성탄절 대체공휴일',
};

export type KoreanHoliday = {
  status: 'verified' | 'unsupported';
  name: string | null;
};

/** Accepts the existing YYYY-MM-DD domain and never uses the host timezone. */
export function getKoreanHoliday(date: string): KoreanHoliday {
  dayCalendar(date);
  if (!KR_HOLIDAY_YEARS.some((year) => year === Number(date.slice(0, 4))))
    return { status: 'unsupported', name: null };
  return { status: 'verified', name: HOLIDAYS[date] ?? null };
}

/** A display default only: callers retain records and explicit date selections. */
export function isDefaultNonWorkingDay(date: string): boolean {
  return dayCalendar(date).isWeekend || getKoreanHoliday(date).name !== null;
}
