import type { AreaHeader } from '../types';

export type BoardZoneId = 'absence' | 'vna' | 'wide-aisle' | 'transport' | 'problem-solvers' | 'outbound' | 'team-leads' | 'metadata';
export type BoardZone = { id: BoardZoneId; label: string; x: number; y: number; width: number; height: number; area?: AreaHeader['area'] };

export const ZF_BOARD_ZONES: BoardZone[] = [
  { id: 'absence', label: 'Absence', x: 0, y: 0, width: 0.12, height: 0.13 },
  { id: 'vna', label: 'VNA', x: 0, y: 0.13, width: 0.21, height: 0.87, area: 'VNA' },
  { id: 'wide-aisle', label: 'Wide Aisle', x: 0.21, y: 0.13, width: 0.28, height: 0.87, area: 'PUTAWAY' },
  { id: 'transport', label: 'Transport', x: 0.49, y: 0.08, width: 0.17, height: 0.92, area: 'TRANSPORT' },
  { id: 'problem-solvers', label: 'Problem solveři', x: 0.66, y: 0.02, width: 0.15, height: 0.42 },
  { id: 'outbound', label: 'Outbound', x: 0.81, y: 0.13, width: 0.19, height: 0.74, area: 'OBWF' },
  { id: 'team-leads', label: 'Team leadři', x: 0.79, y: 0.87, width: 0.21, height: 0.13 },
  { id: 'metadata', label: 'Datum a směna', x: 0.81, y: 0, width: 0.19, height: 0.13 },
];

export function zfBoardAreaHeaders(width: number, height: number): AreaHeader[] {
  return ZF_BOARD_ZONES.filter((zone): zone is BoardZone & { area: AreaHeader['area'] } => Boolean(zone.area)).map((zone) => ({ area: zone.area, x: Math.round(zone.x * width), y: Math.round(zone.y * height), width: Math.round(zone.width * width), height: Math.round(zone.height * height), centerX: Math.round((zone.x + zone.width / 2) * width) }));
}

export function zoneAt(x: number, y: number): BoardZone | undefined { return ZF_BOARD_ZONES.find((zone) => x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height); }
