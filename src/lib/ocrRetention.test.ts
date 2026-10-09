import { beforeEach, describe, expect, it } from 'vitest';
import { createOcrSession, markOcrSession, purgeExpiredOcrSessions, saveOcrSession } from './ocrRetention';

describe('OCR retention', () => {
  beforeEach(() => localStorage.clear());
  it('sets the expiry exactly seven days after creation', () => {
    const created = new Date('2026-10-09T00:00:00.000Z');
    expect(createOcrSession(created).expiresAt).toBe('2026-10-16T00:00:00.000Z');
  });
  it('purges expired sessions and retains current review state', () => {
    const now = new Date('2026-10-09T00:00:00.000Z');
    const current = createOcrSession(now);
    saveOcrSession(current);
    markOcrSession(current.id, 'reviewed');
    expect(purgeExpiredOcrSessions(new Date('2026-10-15T23:59:59.000Z'))).toEqual([{ ...current, status: 'reviewed' }]);
    expect(purgeExpiredOcrSessions(new Date('2026-10-16T00:00:00.000Z'))).toEqual([]);
  });
});
