import { workspaceCalendarHref as productCalendarHref } from '../shared/workspace-calendar-navigation';
import { allowedDemoPath, demoURL, routeURL } from './route';

// Keep every event-updated href inside the static host's document directory.
// React's bubble handlers run after the demo's capture navigation guard.
export function workspaceCalendarHref(companyId: string, view: string, currentHref: string) {
  const href = productCalendarHref(companyId, view, routeURL(currentHref).href);
  const target = new URL(href, window.location.origin);
  return allowedDemoPath(target.pathname) ? demoURL(target).href : href;
}
