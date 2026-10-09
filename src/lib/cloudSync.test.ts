import { describe, expect, it } from 'vitest';
import { createCloudBoard, isCloudBoard, CloudConflictError } from './cloudSync';

describe('cloud board contract', () => {
  it('keeps all V3 state in an isolated board payload', () => {
    const board = createCloudBoard([], [], [], null);
    expect(isCloudBoard(board)).toBe(true);
    expect(board.version).toBe(1);
  });

  it('exposes a distinct conflict error for concurrent updates', () => {
    expect(new CloudConflictError(4)).toMatchObject({ name: 'CloudConflictError', remoteRevision: 4 });
  });
});
