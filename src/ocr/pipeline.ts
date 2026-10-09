import { createShift } from '../lib/shifts';
import { readBoard } from '../lib/ocr';
import { preprocess, UnusableImageError } from '../lib/image';
import { duplicates, validate } from '../lib/validation';
import type { Area, AreaHeader, AssignedOperator, BoardAnalysisResult, Detection, Rect, ReviewIssue, ReviewResult, ShiftState } from '../types';
import { DEFAULT_MAGNET_OCR_CONFIG, type MagnetOCRConfig } from '../lib/magnetOcr';
import { runMagnetOCR } from './magnetOcr';
import { combineConfidences } from '../lib/confidence';
import { renderAnalysisOverlay } from './overlay';
import { isAutomaticallyConfirmed, isReviewRequired } from '../lib/board';

export const DEFAULT_AREA_HEADERS: AreaHeader[] = [
  { area: 'TRANSPORT', x: 0, y: 0, width: 120, height: 100, centerX: 60 },
  { area: 'OUTBOUND', x: 120, y: 0, width: 120, height: 100, centerX: 180 },
  { area: 'HOVS/ML', x: 240, y: 0, width: 120, height: 100, centerX: 300 },
  { area: 'VNA', x: 360, y: 0, width: 120, height: 100, centerX: 420 },
  { area: 'VNAS', x: 480, y: 0, width: 120, height: 100, centerX: 540 },
  { area: 'VNAC', x: 600, y: 0, width: 120, height: 100, centerX: 660 },
  { area: 'PUTAWAY', x: 720, y: 0, width: 120, height: 100, centerX: 780 },
  { area: 'VAS', x: 840, y: 0, width: 120, height: 100, centerX: 900 },
  { area: 'OBWI', x: 960, y: 0, width: 120, height: 100, centerX: 1020 },
  { area: 'HAZMAT', x: 1080, y: 0, width: 120, height: 100, centerX: 1140 },
  { area: 'OBWF', x: 1200, y: 0, width: 120, height: 100, centerX: 1260 },
];

export function assignOperatorToArea(magnetRect: Rect, areaHeaders: AreaHeader[]): Area {
  return assignOperatorToAreaWithConfidence(magnetRect, areaHeaders).area;
}

export function assignOperatorToAreaWithConfidence(
  magnetRect: Rect,
  areaHeaders: AreaHeader[]
): { area: Area; confidence: number } {
  if (!areaHeaders?.length) return { area: 'UNKNOWN', confidence: 0 };

  const centerX = magnetRect.x + magnetRect.width / 2;
  let nearest = areaHeaders[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const header of areaHeaders) {
    const distance = Math.abs(centerX - header.centerX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = header;
    }
  }

  const halfWidth = Math.max(1, nearest.width / 2);
  const confidence = Math.max(0, Math.min(1, 1 - nearestDistance / halfWidth));
  return { area: nearest.area, confidence };
}

export function buildReviewResult(rows: Detection[], duplicateNames: string[] = []): ReviewResult {
  const duplicateSet = new Set(duplicateNames);
  const confirmed = rows.filter((row) => row.matched && !isReviewRequired(row, duplicateSet)).length;
  const questionable = rows.filter((row) => isReviewRequired(row, duplicateSet)).length;
  const lowConfidence = rows.filter((row) => row.confidence < 0.8 || row.warning === 'low').length;
  const unknownEmployees = rows.filter((row) => !row.matched).length;
  const unknownAreas = rows.filter((row) => row.area === 'UNKNOWN').length;
  const uniqueDuplicateNames = Array.from(new Set(duplicateNames));

  const blockingIssues: ReviewIssue[] = [];

  if (lowConfidence > 0) {
    blockingIssues.push({ type: 'low-confidence', message: 'Low-confidence OCR results', count: lowConfidence });
  }

  if (unknownEmployees > 0) {
    blockingIssues.push({ type: 'unknown-employee', message: 'Unknown employee matches', count: unknownEmployees });
  }

  if (unknownAreas > 0) {
    blockingIssues.push({ type: 'unknown-area', message: 'Unknown workplace assignments', count: unknownAreas });
  }

  if (uniqueDuplicateNames.length > 0) {
    blockingIssues.push({ type: 'duplicate', message: 'Duplicate employee detections', count: uniqueDuplicateNames.length });
  }

  const hasBlockingIssues = blockingIssues.length > 0;

  return {
    confirmed,
    questionable,
    blockingIssues,
    hasBlockingIssues,
    lowConfidence,
    unknownEmployees,
    unknownAreas,
    duplicates: uniqueDuplicateNames,
  };
}

export function buildBoardAnalysis(input: { assignedOperators: AssignedOperator[]; review: ReviewResult }): BoardAnalysisResult {
  const confirmedOperators = input.assignedOperators.filter((operator) => isAutomaticallyConfirmed(operator, input.review.duplicates));
  const shift = confirmedOperators.length > 0
    ? createShift(confirmedOperators.map((operator) => ({ name: operator.name, area: operator.area })))
    : undefined;

  return {
    assignedOperators: input.assignedOperators,
    review: input.review,
    shift,
  };
}

export function buildAreaHeadersFromBoard(width: number, height: number): AreaHeader[] {
  const columns = DEFAULT_AREA_HEADERS.map((header, index) => ({
    ...header,
    x: (width * index) / DEFAULT_AREA_HEADERS.length,
    width: width / DEFAULT_AREA_HEADERS.length,
    centerX: (width * (index + 0.5)) / DEFAULT_AREA_HEADERS.length,
    y: 0,
    height,
  }));

  return columns.filter((header) => header.area !== 'UNKNOWN');
}

export async function analyzeBoardPhoto(
  file: File,
  roster: string[],
  config: MagnetOCRConfig = DEFAULT_MAGNET_OCR_CONFIG,
  areaHeaders: AreaHeader[] = [],
  progress?: (current: number, total: number) => void
): Promise<BoardAnalysisResult> {
  const startedAt = performance.now();
  const preprocessStartedAt = performance.now();
  const prep = await preprocess(file);
  const preprocessMs = performance.now() - preprocessStartedAt;
  if (!prep.quality.usable) throw new UnusableImageError(prep.quality, prep.url, prep.overlayUrl);

  const canvas = prep.canvas;
  const normalizedHeaders = areaHeaders.length > 0 ? areaHeaders : buildAreaHeadersFromBoard(canvas.width, canvas.height);
  const ocrStartedAt = performance.now();
  const magnetResults = prep.magnets.length > 0 ? await runMagnetOCR(canvas, prep.magnets, config, progress) : [];
  const ocrMs = performance.now() - ocrStartedAt;

  const detectionRows: Detection[] = [];
  const assignedOperators: AssignedOperator[] = [];

  for (const result of magnetResults) {
    const magnetRect: Rect = { ...result.rect, score: result.confidence };
    const areaAssignment = assignOperatorToAreaWithConfidence(magnetRect, normalizedHeaders);
    const row = validate(result.rawText || '', roster, result.confidence, areaAssignment.area);
    row.areaConfidence = areaAssignment.confidence;
    row.rect = result.rect;
    row.passCount = result.passCount;
    row.elapsedMs = result.elapsedMs;
    row.confidence = combineConfidences(row.confidence, areaAssignment.confidence);
    if (result.warning) row.warning = [row.warning, result.warning].filter(Boolean).join('; ');

    const reviewStatus = row.warning || row.confidence < 0.8 || areaAssignment.area === 'UNKNOWN' ? 'questionable' : 'confirmed';

    detectionRows.push(row);

    if (row.matched) {
      assignedOperators.push({
        name: row.matched,
        area: row.area,
        raw: row.raw,
        confidence: row.confidence,
        matched: row.matched,
        reviewStatus,
        rect: result.rect,
        ocrConfidence: row.ocrConfidence,
        matchConfidence: row.matchConfidence,
        areaConfidence: row.areaConfidence,
      });
    }
  }

  if (prep.magnets.length === 0 && prep.boardDetected) {
    const boardRows = await readBoard(prep.url, roster, () => undefined);
    for (const row of boardRows) {
      detectionRows.push(row);
      if (row.matched) {
        assignedOperators.push({
          name: row.matched,
          area: row.area,
          raw: row.raw,
          confidence: row.confidence,
          matched: row.matched,
          reviewStatus: row.warning || row.confidence < 0.8 ? 'questionable' : 'confirmed',
        });
      }
    }
  }

  const review = buildReviewResult(detectionRows, duplicates(detectionRows));
  const result = buildBoardAnalysis({ assignedOperators, review });
  const overlayUrl = renderAnalysisOverlay(canvas, normalizedHeaders, detectionRows, prep.boardDetected);

  return {
    ...result,
    detections: detectionRows,
    imageQuality: prep.quality,
    boardDetected: prep.boardDetected,
    imageUrl: prep.url,
    overlayUrl,
    timingsMs: {
      preprocess: preprocessMs,
      ocr: ocrMs,
      analysis: performance.now() - startedAt,
    },
  };
}

export type AnalyzeBoardPhotoFn = typeof analyzeBoardPhoto;
export type { AssignedOperator, AreaHeader, BoardAnalysisResult, Detection, Rect, ReviewResult, ShiftState, Area } from '../types';
