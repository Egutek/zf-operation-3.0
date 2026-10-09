export type OcrSession = { id: string; createdAt: string; expiresAt: string; status: 'processing' | 'reviewed' | 'discarded' };
const KEY = 'zf.v3.ocr-sessions.v1';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function read(): OcrSession[] { try { const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is OcrSession => Boolean(item) && typeof item === 'object' && typeof (item as OcrSession).id === 'string' && typeof (item as OcrSession).expiresAt === 'string') : []; } catch { return []; } }
function write(sessions: OcrSession[]): void { try { localStorage.setItem(KEY, JSON.stringify(sessions)); } catch {} }
export function createOcrSession(now = new Date()): OcrSession { return { id: crypto.randomUUID(), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + RETENTION_MS).toISOString(), status: 'processing' }; }
export function purgeExpiredOcrSessions(now = new Date()): OcrSession[] { const retained = read().filter((session) => Date.parse(session.expiresAt) > now.getTime()); write(retained); return retained; }
export function saveOcrSession(session: OcrSession): void { const sessions = purgeExpiredOcrSessions().filter((item) => item.id !== session.id); write([...sessions, session]); }
export function markOcrSession(id: string, status: OcrSession['status']): void { write(purgeExpiredOcrSessions().map((session) => session.id === id ? { ...session, status } : session)); }
