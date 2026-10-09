import type { Unsubscribe } from 'firebase/firestore';
import type { Department } from './departments';
import { ensureAnonymousSession, getFirebaseServices, isFirebaseConfigured } from './firebase';
import type { RosterMember } from './roster';
import type { ShiftState } from './shifts';
import type { ProblemSolver } from '../types';

export type CloudBoard = { version: 1; revision: number; roster: RosterMember[]; departments: Department[]; problemSolvers: ProblemSolver[]; shift: ShiftState | null; updatedAt?: unknown; updatedBy?: string };
export type CloudStatus = 'local' | 'connecting' | 'saving' | 'online' | 'offline' | 'conflict' | 'error';
export class CloudConflictError extends Error { constructor(readonly remoteRevision: number) { super('Směna byla mezitím změněna na jiném zařízení.'); this.name = 'CloudConflictError'; } }
const BOARD_ID = 'current';
export function cloudEnabled(): boolean { return isFirebaseConfigured(); }
export function createCloudBoard(roster: RosterMember[], departments: Department[], problemSolvers: ProblemSolver[], shift: ShiftState | null, revision = 0): CloudBoard { return { version: 1, revision, roster, departments, problemSolvers, shift }; }
export function isCloudBoard(value: unknown): value is CloudBoard { if (!value || typeof value !== 'object') return false; const item = value as Partial<CloudBoard>; return item.version === 1 && Number.isInteger(item.revision) && Array.isArray(item.roster) && Array.isArray(item.departments) && Array.isArray(item.problemSolvers) && (item.shift === null || typeof item.shift === 'object'); }
export async function connectCloudBoard(): Promise<string | null> { return ensureAnonymousSession(); }
export async function subscribeCloudBoard(callback: (board: CloudBoard | null) => void, onError: (error: Error) => void): Promise<Unsubscribe | null> {
  const services = await getFirebaseServices();
  if (!services) return null;
  const { doc, onSnapshot } = await import('firebase/firestore');
  const reference = doc(services.db, 'zf-operativa-v3', BOARD_ID);
  return onSnapshot(reference, (snapshot) => { const data: unknown = snapshot.data(); callback(snapshot.exists() && isCloudBoard(data) ? data : null); }, onError);
}
export async function saveCloudBoard(board: CloudBoard, expectedRevision: number): Promise<number | null> {
  const services = await getFirebaseServices();
  const uid = await ensureAnonymousSession();
  if (!services || !uid) return null;
  const { doc, runTransaction, serverTimestamp } = await import('firebase/firestore');
  const reference = doc(services.db, 'zf-operativa-v3', BOARD_ID);
  return runTransaction(services.db, async (transaction) => {
    const current = await transaction.get(reference);
    const currentBoard = current.exists() && isCloudBoard(current.data()) ? current.data() : null;
    const currentRevision = currentBoard?.revision ?? 0;
    if (currentRevision !== expectedRevision) throw new CloudConflictError(currentRevision);
    const next = currentRevision + 1;
    transaction.set(reference, { ...board, revision: next, updatedBy: uid, updatedAt: serverTimestamp() });
    return next;
  });
}
