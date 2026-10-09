import { describe, expect, it } from 'vitest';
import { zfBoardAreaHeaders, zoneAt } from './boardProfile';

describe('ZF physical board profile', () => {
  it('keeps absence, problem solvers and contacts outside department headers', () => {
    expect(zfBoardAreaHeaders(1500, 1000).map((header) => header.area)).toEqual(['VNA', 'PUTAWAY', 'TRANSPORT', 'OBWF']);
  });

  it('identifies the absence and problem solver zones', () => {
    expect(zoneAt(0.04, 0.04)?.id).toBe('absence');
    expect(zoneAt(0.7, 0.2)?.id).toBe('problem-solvers');
  });
});
