import { task } from './fixture';
import { zWorkEntryFinal, type WorkEntryFinal } from '../shared/schema/work-entry';

export const MONTH_SEED_VERSION = 1;
const ORIGINAL_ENTRY_COUNT = 10;
const palette = ['#587da8', '#4f8883', '#75875f', '#b18c58', '#8d7eac'];
type EntryColor = { workEntryId: string; color: string | null; version: number | null };
type MonthSeed = {
  entries: WorkEntryFinal[];
  colors: Record<string, EntryColor>;
  seedVersion: number;
};

/** Fictional records only. The first ten IDs remain compatible with the original demo. */
export function createMonthSeed(): MonthSeed {
  const rows: Array<Pick<WorkEntryFinal, 'title' | 'status'> & {
    day: number;
    lastDay?: number;
    kind?: WorkEntryFinal['kind'];
  }> = [
    { title: '대시보드 화면 설계', day: 1, lastDay: 2, status: 'done' },
    { title: '업무 목록 컴포넌트', day: 1, lastDay: 2, status: 'done' },
    { title: 'API 계약 검토', day: 2, status: 'done' },
    { title: '반응형 달력 점검', day: 5, status: 'done' },
    { title: '접근성 개선', day: 6, lastDay: 8, status: 'todo' },
    { title: '릴리스 문서 작성', day: 7, status: 'todo' },
    { title: '코드 리뷰', day: 7, status: 'todo' },
    { title: '모바일 입력 테스트', day: 8, status: 'todo' },
    { title: '회고 정리', day: 8, status: 'todo' },
    { title: '다음 주 계획', day: 9, status: 'todo' },
    { title: '사용자 흐름 시안', day: 12, lastDay: 14, status: 'done' },
    { title: '검색 조건 설계', day: 12, status: 'done' },
    { title: '상태 배지 구성', day: 13, lastDay: 15, status: 'doing' },
    { title: '가상 사용성 회의', day: 15, kind: 'meeting', status: 'planned' },
    { title: '키보드 탐색 점검', day: 16, status: 'todo' },
    { title: '카드 간격 조정', day: 19, lastDay: 21, status: 'doing' },
    { title: '가상 일정 검토', day: 20, kind: 'meeting', status: 'planned' },
    { title: '빈 화면 문구 작성', day: 21, status: 'todo' },
    { title: '오류 안내 시안', day: 22, lastDay: 23, status: 'todo' },
    { title: '주간 시연 점검', day: 23, status: 'todo' },
    { title: '월말 화면 검수', day: 26, lastDay: 28, status: 'todo' },
    { title: '도움말 예시 정리', day: 27, lastDay: 29, status: 'todo' },
    { title: '가상 결과 발표', day: 29, kind: 'event', status: 'planned' },
    { title: '다음 달 시연 계획', day: 30, status: 'todo' },
  ];
  const date = (day: number) => `2026-10-${String(day).padStart(2, '0')}`;
  const entries = rows.map(({ title, day, lastDay, kind = 'task', status }, index) => task({
    id: `019950d3-b800-7000-8000-${String(900 + index).padStart(12, '0')}`,
    title,
    content: '포트폴리오 시연을 위해 만든 가상 업무입니다.',
    kind,
    plannedDate: date(day),
    endDate: lastDay ? date(lastDay) : null,
    status,
    completedAt: status === 'done' ? Date.parse(`${date(lastDay ?? day)}T08:00:00Z`) : null,
  }));
  const colors = Object.fromEntries(entries.map((entry, index) => [entry.id, {
    workEntryId: entry.id, color: palette[index % palette.length]!, version: 1,
  }]));
  return { entries, colors, seedVersion: MONTH_SEED_VERSION };
}

/** Add this release's new examples once without replacing edits or restoring deleted old ones. */
export function restoreMonthSeed(saved: unknown): MonthSeed & { shouldPersist: boolean } {
  const seed = createMonthSeed();
  if (saved === null) return { ...seed, shouldPersist: true };
  if (!saved || typeof saved !== 'object' || !('entries' in saved) ||
      !Array.isArray(saved.entries) || !saved.entries.every(entry => zWorkEntryFinal.safeParse(entry).success)) {
    // Do not overwrite an unreadable saved payload merely by opening the demo.
    return { ...seed, shouldPersist: false };
  }
  const entries = [...saved.entries] as WorkEntryFinal[];
  const colors = 'colors' in saved && saved.colors && typeof saved.colors === 'object' && !Array.isArray(saved.colors)
    ? { ...saved.colors } as Record<string, EntryColor> : {};
  const seedVersion = 'seedVersion' in saved && typeof saved.seedVersion === 'number' &&
    Number.isSafeInteger(saved.seedVersion) && saved.seedVersion >= MONTH_SEED_VERSION ? saved.seedVersion : 0;
  if (seedVersion) return { entries, colors, seedVersion, shouldPersist: false };

  const presentIds = new Set(entries.map(entry => entry.id));
  for (const entry of seed.entries.slice(ORIGINAL_ENTRY_COUNT)) {
    if (presentIds.has(entry.id)) continue;
    entries.push(entry);
    if (!(entry.id in colors)) colors[entry.id] = seed.colors[entry.id]!;
  }
  return { entries, colors, seedVersion: MONTH_SEED_VERSION, shouldPersist: true };
}
