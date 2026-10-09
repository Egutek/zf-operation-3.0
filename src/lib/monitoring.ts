export type MetricEvent = 'screen_opened' | 'ocr_started' | 'ocr_completed' | 'ocr_reviewed' | 'operator_moved' | 'operators_returned' | 'holding_area_used' | 'sync_error';
type Properties = Record<string, string | number | boolean>;
const allowed = new Set<MetricEvent>(['screen_opened', 'ocr_started', 'ocr_completed', 'ocr_reviewed', 'operator_moved', 'operators_returned', 'holding_area_used', 'sync_error']);
let posthog: typeof import('posthog-js').default | null = null;
let sentry: typeof import('@sentry/react') | null = null;

export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (dsn) void import('@sentry/react').then((module) => { sentry = module; module.init({ dsn, beforeSend: (event) => ({ ...event, request: undefined, user: undefined, breadcrumbs: event.breadcrumbs?.map(({ message: _message, data: _data, ...item }) => item) }) }); });
  const key = import.meta.env.VITE_POSTHOG_KEY?.trim();
  if (key) void import('posthog-js').then(({ default: module }) => { posthog = module; module.init(key, { api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com', autocapture: false, capture_pageview: false, persistence: 'memory', disable_session_recording: true }); });
}
export function track(event: MetricEvent, properties: Properties = {}): void { if (allowed.has(event)) posthog?.capture(event, properties); }
export function reportError(error: unknown, context: Properties = {}): void { sentry?.withScope((scope) => { scope.setExtras(context); sentry?.captureException(error); }); }
