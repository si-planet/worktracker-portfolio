import type { WorkspaceCompany } from './schema/workspace';
import { kstDate } from './work-entry-rules';

export const COMPANY_MANAGEMENT_PATH = '/settings/companies';

/** The explicit employment flag is authoritative; an absent end date is not approval. */
export function currentCompanyWeek(companies: readonly WorkspaceCompany[], now = Date.now()) {
  const current = companies.filter((company) => company.isCurrent);
  if (current.length !== 1) return '/';
  const date = kstDate(now);
  return `/c/${current[0]!.id}/week?${new URLSearchParams({ year: date.slice(0, 4), date })}`;
}

/** Caller supplies the existing sanitized return URL. Root means normal post-login landing. */
export async function postLoginLanding(
  sanitizedReturnTo: string | null,
  defaultLanding: () => Promise<string>,
) {
  return sanitizedReturnTo && sanitizedReturnTo !== '/' ? sanitizedReturnTo : defaultLanding();
}
