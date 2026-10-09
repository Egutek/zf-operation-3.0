import { useEffect, useState } from 'react';
import { addOperatorToShift, createShift, moveOperator, moveOperators, movedOnly, returnOperatorsToStart, returnToStart, type ShiftState } from './lib/shifts';
import { exportShift, loadProblemSolvers, loadShift, saveProblemSolvers, saveShift } from './lib/storage';
import { filterOperators } from './lib/search';
import { type Area, type BoardAnalysisResult, type Detection, type ImageQuality, type ProblemSolver } from './types';
import { analyzeBoardPhoto } from './ocr/pipeline';
import { buildBoardDiagnostics, exportDiagnosticsJson } from './ocr/diagnostics';
import { DebugPanel } from './ocr/debug';
import { duplicates, normalizeName, parseRoster, sanitizeEmployeeCandidate } from './lib/validation';
import { UnusableImageError } from './lib/image';
import { isAutomaticallyConfirmed, isReviewRequired } from './lib/board';
import { loadRoster, saveRoster, type PermanentTeam, type RosterMember, type ShiftCode } from './lib/roster';
import { addDepartment, DEFAULT_DEPARTMENTS, loadDepartments, renameDepartment, saveDepartments, UNASSIGNED, type Department } from './lib/departments';
import { resetPilotStorage } from './lib/pilotStorage';
import './style.css';

const DEFAULT_ROSTER: RosterMember[] = [{ name: 'NOVAK JAN', team: 'TRANSPORT', shift: 'A' }, { name: 'SVOBODA PETR', team: 'TRANSPORT', shift: 'A' }, { name: 'DVORAK MARTIN', team: 'VNA', shift: 'A' }];

type ReviewDraft = { name: string; area: Exclude<Area, 'UNKNOWN'> | '' };
type AppPage = 'board' | 'roster' | 'import';
type BoardView = 'departments' | 'pocket' | 'list';
type DepartmentDialog = { type: 'rename' | 'remove'; name: string; value: string };

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [rosterMembers, setRosterMembers] = useState<RosterMember[]>(() => loadRoster(DEFAULT_ROSTER));
  const [departments, setDepartments] = useState<Department[]>(loadDepartments);
  const [departmentEntry, setDepartmentEntry] = useState('');
  const [departmentDialog, setDepartmentDialog] = useState<DepartmentDialog | null>(null);
  const [resetDialog, setResetDialog] = useState(false);
  const [rosterEntry, setRosterEntry] = useState('');
  const [rosterTeam, setRosterTeam] = useState<PermanentTeam>('TRANSPORT');
  const [rosterShift, setRosterShift] = useState<ShiftCode>('A');
  const [problemSolverEntry, setProblemSolverEntry] = useState('');
  const [problemSolverArea, setProblemSolverArea] = useState<ProblemSolver['area']>('TRANSPORT');
  const [analysis, setAnalysis] = useState<BoardAnalysisResult | null>(null);
  const [shift, setShift] = useState<ShiftState | null>(loadShift);
  const [quality, setQuality] = useState<ImageQuality | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [overlayUrl, setOverlayUrl] = useState('');
  const [showOverlay, setShowOverlay] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('Připraveno');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [transportOnly, setTransportOnly] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>('board');
  const [boardView, setBoardView] = useState<BoardView>('departments');
  const [manualName, setManualName] = useState('');
  const [manualArea, setManualArea] = useState<Area>('TRANSPORT');
  const [selectedOperators, setSelectedOperators] = useState<Set<string>>(() => new Set());
  const [bulkArea, setBulkArea] = useState<Area>('TRANSPORT');
  const [draggedOperator, setDraggedOperator] = useState('');
  const [lastShiftBeforeAction, setLastShiftBeforeAction] = useState<ShiftState | null>(null);
  const [confirmBulkAction, setConfirmBulkAction] = useState<'move' | 'return' | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<number, ReviewDraft>>({});
  const [resolvedRows, setResolvedRows] = useState<Set<number>>(() => new Set());
  const [reviewNotice, setReviewNotice] = useState('');
  const [reviewApproved, setReviewApproved] = useState(false);
  const [problemSolverNames, setProblemSolverNames] = useState<string[]>(() => loadProblemSolvers().map((solver) => solver.name));
  const [problemSolverAreas, setProblemSolverAreas] = useState<ProblemSolver['area'][]>(() => loadProblemSolvers().map((solver) => solver.area));

  useEffect(() => {
    saveShift(shift);
  }, [shift]);

  useEffect(() => { saveRoster(rosterMembers); }, [rosterMembers]);
  useEffect(() => { saveDepartments(departments); }, [departments]);
  useEffect(() => { saveProblemSolvers(getProblemSolvers()); }, [problemSolverNames, problemSolverAreas]);

  const visibleAreas = departments.filter((department) => !department.hidden).map((department) => department.name);
  const occupiedHiddenAreas = [...new Set(shift?.operators.map((operator) => operator.current).filter((area) => !visibleAreas.includes(area)) ?? [])];
  const areas = [...visibleAreas, ...occupiedHiddenAreas];

  const rows = analysis?.detections ?? [];
  const duplicateNames = duplicates(rows);
  const confirmedOperators = (analysis?.assignedOperators ?? []).filter((operator) => isAutomaticallyConfirmed(operator, duplicateNames));
  const reviewRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => isReviewRequired(row, duplicateNames) && !resolvedRows.has(index));
  const shiftRoster = rosterMembers.filter((member) => member.shift === rosterShift);
  const roster = shiftRoster.map((member) => member.name).join('\n');
  const rosterNames = shiftRoster.map((member) => member.name);
  const problemSolvers = shift?.problemSolvers ?? [];
  const problemSolverCounts = problemSolvers.reduce((counts, solver) => ({ ...counts, [solver.area]: (counts[solver.area] ?? 0) + 1 }), { TRANSPORT: 0, 'HOVS/ML': 0 } as Record<ProblemSolver['area'], number>);
  const operatorCounts = shift
    ? areas.map((area) => [area, shift.operators.filter((operator) => operator.current === area).length] as const)
      .filter(([, count]) => count > 0)
    : [];
  const diagnostics = analysis
    ? buildBoardDiagnostics(
      [...new Set(rows.map((row) => row.area).filter((area) => area !== 'UNKNOWN'))],
      rows,
      analysis.assignedOperators,
      analysis.review,
      analysis.boardDetected
    )
    : null;

  const fleetLoad = shift ? Math.min(100, Math.round((shift.operators.length / Math.max(1, areas.length)) * 100)) : 0;
  const transportCount = analysis?.assignedOperators.filter((operator) => operator.area === 'TRANSPORT').length ?? 0;
  const reviewQueueSize = analysis?.review.blockingIssues.reduce((sum, issue) => sum + issue.count, 0) ?? 0;
  const riskLevel = reviewQueueSize === 0 ? 'Bezpečně' : reviewQueueSize <= 2 ? 'Střední' : 'Vysoké';

  function getProblemSolvers(): ProblemSolver[] {
    return problemSolverNames.map((name, index) => ({ name, area: problemSolverAreas[index] ?? 'TRANSPORT' }));
  }

  function addRosterEntry(): void {
    const name = sanitizeEmployeeCandidate(rosterEntry);
    if (!name || rosterMembers.some((member) => normalizeName(member.name) === normalizeName(name))) return;
    setRosterMembers((members) => [...members, { name, team: rosterTeam, shift: rosterShift }]);
    setRosterEntry('');
  }

  function removeRosterEntry(name: string): void {
    setRosterMembers((members) => members.filter((member) => normalizeName(member.name) !== normalizeName(name)));
  }

  function setRosterText(value: string): void {
    const current = new Map(shiftRoster.map((member) => [normalizeName(member.name), member.team]));
    setRosterMembers((members) => [...members.filter((member) => member.shift !== rosterShift), ...parseRoster(value).names.map((name) => ({ name, team: current.get(normalizeName(name)) ?? 'TRANSPORT', shift: rosterShift }))]);
  }

  function addProblemSolver(): void {
    const name = sanitizeEmployeeCandidate(problemSolverEntry);
    if (!name || problemSolverNames.some((item) => normalizeName(item) === normalizeName(name)) || rosterMembers.some((member) => normalizeName(member.name) === normalizeName(name))) return;
    setProblemSolverNames((names) => [...names, name]);
    setProblemSolverAreas((areas) => [...areas, problemSolverArea]);
    setProblemSolverEntry('');
  }

  function removeProblemSolver(index: number): void {
    setProblemSolverNames((names) => names.filter((_, itemIndex) => itemIndex !== index));
    setProblemSolverAreas((areas) => areas.filter((_, itemIndex) => itemIndex !== index));
  }

  function addDepartmentEntry(): void {
    const next = addDepartment(departments, departmentEntry);
    if (next === departments) return;
    setDepartments(next);
    setDepartmentEntry('');
  }

  function toggleDepartment(name: string): void { setDepartments((items) => items.map((item) => item.name === name ? { ...item, hidden: !item.hidden } : item)); }

  function confirmDepartmentRename(): void {
    if (!departmentDialog || departmentDialog.type !== 'rename') return;
    const { name, value } = departmentDialog;
    const next = renameDepartment(departments, name, value);
    const renamed = next.find((item) => item.name !== name && !departments.some((current) => current.name === item.name));
    if (next === departments || !renamed) return;
    setDepartments(next);
    setShift((current) => current ? {
      ...current,
      operators: current.operators.map((operator) => ({ ...operator, home: operator.home === name ? renamed.name : operator.home, start: operator.start === name ? renamed.name : operator.start, current: operator.current === name ? renamed.name : operator.current })),
      movements: current.movements.map((movement) => ({ ...movement, from: movement.from === name ? renamed.name : movement.from, to: movement.to === name ? renamed.name : movement.to })),
    } : current);
    setDepartmentDialog(null);
  }

  function confirmDepartmentRemoval(): void {
    if (!departmentDialog || departmentDialog.type !== 'remove') return;
    const { name } = departmentDialog;
    const department = departments.find((item) => item.name === name);
    if (!department || department.protected) return;
    if (shift) {
      setLastShiftBeforeAction(shift);
      const moved = moveOperators(shift, shift.operators.filter((operator) => operator.current === name).map((operator) => operator.name), UNASSIGNED);
      setShift({ ...moved, operators: moved.operators.map((operator) => ({ ...operator, home: operator.home === name ? UNASSIGNED : operator.home, start: operator.start === name ? UNASSIGNED : operator.start })) });
    }
    setDepartments((items) => items.filter((item) => item.name !== name));
    setDepartmentDialog(null);
  }

  function moveDepartment(name: string, direction: -1 | 1): void {
    setDepartments((items) => { const index = items.findIndex((item) => item.name === name); const target = index + direction; if (index < 0 || target < 0 || target >= items.length) return items; const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  }

  function toggleOperator(name: string): void {
    setSelectedOperators((selected) => {
      const next = new Set(selected);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleAreaSelection(area: Exclude<Area, 'UNKNOWN'>): void {
    if (!shift) return;
    const areaNames = shift.operators.filter((operator) => operator.current === area).map((operator) => operator.name);
    setSelectedOperators((selected) => areaNames.every((name) => selected.has(name)) ? new Set([...selected].filter((name) => !areaNames.includes(name))) : new Set([...selected, ...areaNames]));
  }

  function moveSelectedOperators(): void {
    if (!shift || selectedOperators.size === 0) return;
    setLastShiftBeforeAction(shift);
    setShift(moveOperators(shift, [...selectedOperators], bulkArea));
    setSelectedOperators(new Set());
    setConfirmBulkAction(null);
  }

  function dropOperator(area: Exclude<Area, 'UNKNOWN'>): void {
    if (!shift || !draggedOperator) return;
    const names = selectedOperators.has(draggedOperator) ? [...selectedOperators] : [draggedOperator];
    setLastShiftBeforeAction(shift);
    setShift(moveOperators(shift, names, area));
    setSelectedOperators(new Set());
    setDraggedOperator('');
  }

  function returnSelectedOperators(): void {
    if (!shift || selectedOperators.size === 0) return;
    setLastShiftBeforeAction(shift);
    setShift(returnOperatorsToStart(shift, [...selectedOperators]));
    setSelectedOperators(new Set());
    setConfirmBulkAction(null);
  }

  function undoLastAction(): void {
    if (!lastShiftBeforeAction) return;
    setShift(lastShiftBeforeAction);
    setLastShiftBeforeAction(null);
  }

  async function loadPhoto(file: File): Promise<void> {
    setBusy(true);
    setProgress('Připravuji fotografii');
    setError('');
    setAnalysis(null);
    setQuality(null);
    setPreviewUrl('');
    setOverlayUrl('');
    setReviewDrafts({});
    setResolvedRows(new Set());
    setReviewNotice('');
    setReviewApproved(false);

    try {
      const result = await analyzeBoardPhoto(
        file,
        rosterNames,
        undefined,
        [],
        (current, total) => setProgress(`OCR ${Math.min(current + 1, total)} / ${total}`)
      );
      setAnalysis(result);
      setQuality(result.imageQuality ?? null);
      setPreviewUrl(result.imageUrl ?? '');
      setOverlayUrl(result.overlayUrl ?? '');
      setProgress('Analýza dokončena');
    } catch (caught) {
      if (caught instanceof UnusableImageError) {
        setQuality(caught.quality);
        setPreviewUrl(caught.previewUrl ?? '');
        setOverlayUrl(caught.overlayUrl ?? '');
        setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : 'Analýza fotografie selhala.');
      }
      setProgress('Analýza zastavena');
    } finally {
      setBusy(false);
    }
  }

  function startShift(): void {
    if (confirmedOperators.length === 0) return;
    setShift(createShift(confirmedOperators.map(({ name, area }) => ({ name, area })), getProblemSolvers()));
  }

  function startEmptyShift(): void {
    setShift(createShift([], getProblemSolvers()));
    setActivePage('board');
  }

  function addManualOperator(): void {
    if (!manualName) return;
    setShift((current) => current ? addOperatorToShift(current, manualName, manualArea) : current);
    setManualName('');
  }

  function updateReviewDraft(index: number, row: Detection, change: Partial<ReviewDraft>): void {
    const current = reviewDrafts[index] ?? {
      name: row.matched ?? '',
      area: row.area === 'UNKNOWN' ? '' : row.area,
    };
    setReviewDrafts((drafts) => ({ ...drafts, [index]: { ...current, ...change } }));
  }

  function resolveReview(index: number, row: Detection, include: boolean): void {
    if (include) {
      const draft = reviewDrafts[index] ?? {
        name: row.matched ?? '',
        area: row.area === 'UNKNOWN' ? '' : row.area,
      };
      if (!draft.name || !draft.area) {
        setReviewNotice('Vyberte zaměstnance i pracoviště.');
        return;
      }
      const selectedArea = draft.area;
      if (shift?.operators.some((operator) => operator.name === draft.name)) {
        setReviewNotice(`${draft.name} už ve směně je. Duplicitní nález můžete vyřadit.`);
        return;
      }
      setShift((current) => current ? addOperatorToShift(current, draft.name, selectedArea) : current);
    }

    setResolvedRows((resolved) => new Set(resolved).add(index));
    setReviewNotice(include ? 'Případ byl zkontrolován a přiřazen.' : 'Nález byl vyřazen ze směny.');
    setReviewApproved(false);
  }

  function approveReview(): void {
    if (reviewRows.length === 0) {
      setReviewApproved(true);
      setReviewNotice('Kontrola potvrzena. Další upozornění se pro tento snímek nezobrazí.');
    }
  }

  function endShift(): void {
    setShift(null);
    setAnalysis(null);
    setReviewDrafts({});
    setResolvedRows(new Set());
    setReviewApproved(false);
  }

  function resetPilot(): void {
    resetPilotStorage();
    setShift(null);
    setRosterMembers(DEFAULT_ROSTER);
    setDepartments(DEFAULT_DEPARTMENTS);
    setProblemSolverNames([]);
    setProblemSolverAreas([]);
    setSelectedOperators(new Set());
    setLastShiftBeforeAction(null);
    setAnalysis(null);
    setActivePage('board');
    setResetDialog(false);
  }

  const reviewQueue = shift && analysis && (
    <section aria-labelledby="review-heading" className="panel">
      <div className="section-heading">
        <h2 id="review-heading">Případy ke kontrole</h2>
        <strong>{reviewRows.length}</strong>
      </div>
      {reviewRows.length === 0 ? <div className="review-approved"><p className="muted">Všechny zachycené případy jsou vyřešené.</p><button type="button" className={reviewApproved ? 'secondary' : ''} onClick={approveReview}>{reviewApproved ? 'Kontrola potvrzena' : 'Vše je v pořádku'}</button></div> : (
        <div className="review-list">
          {reviewRows.map(({ row, index }) => {
            const draft = reviewDrafts[index] ?? {
              name: row.matched ?? '',
              area: row.area === 'UNKNOWN' ? areas[0] : row.area,
            };
            return (
              <article className="review-row" key={index}>
                <div className="review-source">
                  <strong>{row.raw || 'Bez čitelného textu'}</strong>
                  <span>{row.warning ?? `${Math.round(row.confidence * 100)}% confidence`}</span>
                </div>
                <label>
                  Zaměstnanec
                  <select value={draft.name} onChange={(event) => updateReviewDraft(index, row, { name: event.target.value })}>
                    <option value="">Vyberte jméno</option>
                    {rosterNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
                <label>
                  Pracoviště
                  <select value={draft.area} onChange={(event) => updateReviewDraft(index, row, { area: event.target.value as ReviewDraft['area'] })}>
                    <option value="">Vyberte pracoviště</option>
                    {areas.map((area) => <option key={area} value={area}>{area}</option>)}
                  </select>
                </label>
                <div className="review-actions">
                  <button type="button" onClick={() => resolveReview(index, row, true)}>Potvrdit</button>
                  <button type="button" className="secondary" onClick={() => resolveReview(index, row, false)}>Vyřadit</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {reviewNotice && !reviewApproved && <p role="status" className="muted">{reviewNotice}</p>}
    </section>
  );

  const rosterPanel = <section className="panel roster-workspace">
    <div className="section-heading"><div><span className="eyebrow accent">Stálý stav</span><h2>Trvalé týmy · směna {rosterShift}</h2></div><span className="pill">{shiftRoster.length}</span></div>
    <div className="shift-tabs" aria-label="Výběr směny">{(['A', 'B', 'C'] as ShiftCode[]).map((code) => <button type="button" key={code} className={rosterShift === code ? '' : 'secondary'} onClick={() => setRosterShift(code)}>Směna {code}</button>)}</div>
    <div className="entry-row">
      <input aria-label="Přidat zaměstnance do kmene" placeholder="Jméno a příjmení" value={rosterEntry} onChange={(event) => setRosterEntry(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addRosterEntry(); } }} />
      <select aria-label="Trvalý tým" value={rosterTeam} onChange={(event) => setRosterTeam(event.target.value as PermanentTeam)}><option value="TRANSPORT">Transport</option><option value="VNA">VNA</option></select>
      <button type="button" onClick={addRosterEntry}>Přidat</button>
    </div>
    <div className="team-roster-grid">
      {(['TRANSPORT', 'VNA'] as PermanentTeam[]).map((team) => <article className="team-roster" key={team}><header><span>{team}</span><b>{shiftRoster.filter((member) => member.team === team).length}</b></header><div>{shiftRoster.filter((member) => member.team === team).map((member) => <span className="name-chip" key={normalizeName(member.name)}>{member.name}<button type="button" className="chip-remove" onClick={() => removeRosterEntry(member.name)} aria-label={`Odebrat ${member.name}`}>×</button></span>)}</div></article>)}
    </div>
    <details className="advanced-roster"><summary>Problem solveři ({problemSolverNames.length})</summary><small>Nejsou na oddělení ani v upozorněních; započtou se jen do celku Transportu nebo HOVS/ML.</small><div className="entry-row"><input aria-label="Přidat problem solvera" placeholder="Jméno problem solvera" value={problemSolverEntry} onChange={(event) => setProblemSolverEntry(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addProblemSolver(); } }} /><select aria-label="Souhrnná oblast problem solvera" value={problemSolverArea} onChange={(event) => setProblemSolverArea(event.target.value as ProblemSolver['area'])}><option value="TRANSPORT">Transport</option><option value="HOVS/ML">HOVS/ML</option></select><button type="button" onClick={addProblemSolver}>Přidat</button></div><div className="name-list">{problemSolverNames.map((name, index) => <span className="name-chip" key={normalizeName(name)}>{name} · {problemSolverAreas[index]}<button type="button" className="chip-remove" onClick={() => removeProblemSolver(index)} aria-label={`Odebrat ${name}`}>×</button></span>)}</div></details>
    <details className="advanced-roster"><summary>Oddělení ({departments.length})</summary><small>Transport a HOVS/ML jsou chráněné. Při odebrání budou OP převedeni do Nezařazení.</small><div className="entry-row"><input aria-label="Přidat oddělení" placeholder="Název oddělení" value={departmentEntry} onChange={(event) => setDepartmentEntry(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDepartmentEntry(); } }} /><button type="button" onClick={addDepartmentEntry}>Přidat</button></div><div className="department-settings">{departments.map((department) => <div className="department-setting" key={department.name}><b>{department.name}</b><span>{department.hidden ? 'Skryté' : 'Viditelné'}</span><button type="button" className="secondary tiny" onClick={() => moveDepartment(department.name, -1)}>↑</button><button type="button" className="secondary tiny" onClick={() => moveDepartment(department.name, 1)}>↓</button><button type="button" className="secondary tiny" onClick={() => setDepartmentDialog({ type: 'rename', name: department.name, value: department.name })}>Přejmenovat</button><button type="button" className="secondary tiny" onClick={() => toggleDepartment(department.name)}>{department.hidden ? 'Zobrazit' : 'Skrýt'}</button>{!department.protected && <button type="button" className="secondary danger tiny" onClick={() => setDepartmentDialog({ type: 'remove', name: department.name, value: '' })}>Odebrat</button>}</div>)}</div></details>
    <details className="advanced-roster"><summary>Hromadná úprava kmene</summary><textarea aria-label="Seznam zaměstnanců" value={roster} onChange={(event) => setRosterText(event.target.value)} /> </details>
    <details className="advanced-roster"><summary>Pilotní data</summary><small>Vymaže pouze lokální data V2 v tomto prohlížeči. Firebase ani původní aplikace se nezmění.</small><button type="button" className="secondary danger" onClick={() => setResetDialog(true)}>Vymazat data pilotu</button></details>
  </section>;

  return (
    <main className="zf-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">ZF</div>
          <div>
            <span className="eyebrow">ZF Ostrov · Oddělení PICK</span>
            <h3>Operativa směny</h3>
          </div>
        </div>
        <nav className="main-nav" aria-label="Hlavní navigace">
          {([['board', 'Směna'], ['roster', 'Stálý stav'], ['import', 'Import']] as [AppPage, string][]).map(([page, label]) => <button type="button" key={page} className={activePage === page ? 'nav-active' : 'secondary'} onClick={() => setActivePage(page)}>{label}</button>)}
        </nav>
        <div className="status-wrap">
          <span className="status-pill">{analysis ? 'Live OCR' : 'Ready'}</span>
          <i aria-live="polite">{progress}</i>
        </div>
      </header>

      {!shift && activePage === 'board' ? (
        <>
          <section className="hero panel">
            <div className="hero-copy">
              <span className="eyebrow accent">Operation control</span>
              <h1>Řízení směny bez zbytečností</h1>
              <p>Začněte čistou směnou. Import z fotografie zůstává připravený jako doplněk.</p>
            </div>
            <div className="hero-actions">
              <button type="button" onClick={startEmptyShift}>Nová směna</button>
              <button type="button" className="secondary" onClick={() => setActivePage('roster')}>Upravit stálý stav</button>
              <button type="button" className="secondary" onClick={() => setActivePage('import')}>Import z fotky</button>
            </div>
          </section>
        </>
      ) : activePage === 'roster' ? rosterPanel : activePage === 'import' ? <>
          <section className="page-heading panel">
            <div><span className="eyebrow accent">Import</span><h1>Načíst směnu z fotografie</h1><p>Fotografie je pomocný vstup. Před spuštěním směny zkontrolujte rozpoznaná jména.</p></div>
            <label className="upload">{busy ? progress : 'Vybrat fotografii'}<input type="file" accept="image/*" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadPhoto(file); }} /></label>
          </section>
          <section className="ocr-stepper" aria-label="Postup importu">
            {([['01', 'Nahrát', 'Vyberte fotografii tabule'], ['02', 'Zkontrolovat', 'Prověřte nejisté nálezy'], ['03', 'Potvrdit', 'Založte směnu z ověřených OP']] as const).map(([number, title, detail], index) => <div className={`ocr-step${(analysis && index > 0) || (reviewApproved && index === 2) ? ' done' : ''}`} key={number}><b>{number}</b><span><strong>{title}</strong><small>{detail}</small></span></div>)}
          </section>
          <section className="summary-strip">
            <article className="summary-tile">
              <span>Detekce tabule</span>
              <strong>{analysis ? (analysis.boardDetected ? 'Ano' : 'Ne') : '—'}</strong>
            </article>
            <article className="summary-tile">
              <span>Transport</span>
              <strong>{transportCount}</strong>
            </article>
            <article className="summary-tile">
              <span>Případy ke kontrole</span>
              <strong>{reviewQueueSize}</strong>
            </article>
            <article className="summary-tile">
              <span>Riziko</span>
              <strong>{riskLevel}</strong>
            </article>
          </section>

          <div className="board-layout">
            <section className="panel">
              <div className="section-heading">
                <h2>Náhled tabule</h2>
                {previewUrl && <label className="toggle"><input type="checkbox" checked={showOverlay} onChange={(event) => setShowOverlay(event.target.checked)} /> Diagnostický overlay</label>}
              </div>
              {previewUrl ? <img className="board-image" src={showOverlay && overlayUrl ? overlayUrl : previewUrl} alt="Zpracovaný snímek směnové tabule" /> : <div className="empty">Zatím žádná fotografie</div>}
              {quality && <div className="quality-grid" aria-label="Kvalita fotografie">
                <span>Ostrost <b>{quality.blurScore.toFixed(2)}</b></span>
                <span>Kontrast <b>{quality.contrastScore.toFixed(2)}</b></span>
                <span>Jas <b>{quality.brightnessScore.toFixed(2)}</b></span>
                <strong className={quality.usable ? 'ok' : 'warn'}>{quality.usable ? 'Použitelný snímek' : 'OCR zastaveno'}</strong>
              </div>}
            </section>

          </div>

          {error && <p className="error" role="alert">{error}</p>}

          {analysis && <>
            <section className="panel">
              <div className="section-heading"><h2>Výsledek OCR</h2><span>{rows.length} nálezů · {reviewRows.length} ke kontrole · {confirmedOperators.length} potvrzených</span></div>
              <div className="stats">
                <span>Preprocessing <b>{analysis.timingsMs?.preprocess.toFixed(0) ?? '–'} ms</b></span>
                <span>OCR <b>{analysis.timingsMs?.ocr.toFixed(0) ?? '–'} ms</b></span>
                <span>Celkem <b>{analysis.timingsMs?.analysis.toFixed(0) ?? '–'} ms</b></span>
              </div>
              <div className="results">
                {rows.map((row, index) => {
                  const uncertain = isReviewRequired(row, duplicateNames);
                  return <article className="result-row" key={index}>
                    <strong>{row.area}</strong>
                    <span>{row.matched ?? row.raw}</span>
                    <span className={uncertain ? 'warn' : 'ok'}>{uncertain ? row.warning ?? 'Vyžaduje kontrolu' : 'Potvrzeno'}</span>
                    <small>{Math.round(row.confidence * 100)}% · OCR {Math.round((row.ocrConfidence ?? 0) * 100)}% · shoda {Math.round((row.matchConfidence ?? 0) * 100)}% · oblast {Math.round((row.areaConfidence ?? 0) * 100)}%</small>
                  </article>;
                })}
              </div>
              <button type="button" disabled={confirmedOperators.length === 0 || busy} onClick={startShift}>
                Spustit směnu s {confirmedOperators.length} potvrzenými
              </button>
              {confirmedOperators.length === 0 && <p className="warn">Směnu nelze založit bez alespoň jednoho bezpečně potvrzeného zaměstnance.</p>}
            </section>
            <section className="debug-controls panel">
              <label className="toggle"><input type="checkbox" checked={showDiagnostics} onChange={(event) => setShowDiagnostics(event.target.checked)} /> Diagnostické údaje</label>
              {diagnostics && <button type="button" className="secondary" onClick={() => downloadBlob(exportDiagnosticsJson(diagnostics), 'ocr-diagnostics.json')}>Export diagnostiky JSON</button>}
              {showDiagnostics && <DebugPanel data={diagnostics} />}
            </section>
          </>}
        </> : shift ? (
        <>
          <section className="command-bar panel">
            <div><span className="eyebrow accent">Živá směna</span><h1>Směnová tabule · {rosterShift}</h1><div className="shift-tabs compact">{(['A', 'B', 'C'] as ShiftCode[]).map((code) => <button type="button" key={code} className={rosterShift === code ? '' : 'secondary'} onClick={() => setRosterShift(code)}>{code}</button>)}</div></div>
            <div className="command-actions"><button type="button" className="secondary" onClick={() => setActivePage('roster')}>Stálý stav</button><button type="button" className="secondary" onClick={() => setActivePage('import')}>Import z fotky</button><button type="button" onClick={() => document.querySelector('.board-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Přidat OP</button><button type="button" className="secondary" onClick={() => exportShift(shift)}>Export</button><button type="button" className="secondary" onClick={endShift}>Ukončit směnu</button></div>
          </section>

          <section className="overview-strip" aria-label="Souhrn směny">
            <span className="overview-total">Celkem <b>{shift.operators.length}</b></span>
            <span className="overview-total">Transport <b>{(operatorCounts.find(([area]) => area === 'TRANSPORT')?.[1] ?? 0) + problemSolverCounts.TRANSPORT}</b></span>
            <span className="overview-total">HOVS/ML <b>{(operatorCounts.find(([area]) => area === 'HOVS/ML')?.[1] ?? 0) + problemSolverCounts['HOVS/ML']}</b></span>
            {operatorCounts.map(([area, count]) => <button type="button" className="overview-chip" key={area} onClick={() => setQuery(area)}>{area} <b>{count}</b></button>)}
          </section>

          <section className="quick-move" aria-label="Rychlé filtry oddělení">
            <span className="quick-label">Rychlý přehled</span>
            <button type="button" className={!query ? 'quick-active' : 'secondary'} onClick={() => setQuery('')}>Všichni <b>{shift.operators.length}</b></button>
            {areas.map((area) => <button type="button" key={area} className={query === area ? 'quick-active' : 'secondary'} onClick={() => setQuery(area)}>{area} <b>{shift.operators.filter((operator) => operator.current === area).length}</b></button>)}
          </section>

          {reviewQueue}

          <section className="panel board-toolbar">
            <input aria-label="Hledat zaměstnance" placeholder="Hledat člověka nebo oddělení" value={query} onChange={(event) => setQuery(event.target.value)} />
            <label><input type="checkbox" checked={transportOnly} onChange={(event) => setTransportOnly(event.target.checked)} /> Jen Transport</label>
            <div className="view-switch" aria-label="Režim zobrazení">{([['departments', 'Oddělení'], ['pocket', 'Kapesní mistr'], ['list', 'Seznam']] as [BoardView, string][]).map(([view, label]) => <button type="button" key={view} className={boardView === view ? 'view-active' : 'secondary'} onClick={() => setBoardView(view)}>{label}</button>)}</div>
            <select aria-label="Vybrat člověka do směny" value={manualName} onChange={(event) => setManualName(event.target.value)}><option value="">Přidat člověka…</option>{rosterNames.filter((name) => !shift.operators.some((operator) => normalizeName(operator.name) === normalizeName(name))).map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select aria-label="Výchozí oddělení" value={manualArea} onChange={(event) => setManualArea(event.target.value)}>{areas.map((area) => <option key={area} value={area}>{area}</option>)}</select>
            <button type="button" onClick={addManualOperator} disabled={!manualName}>Přidat</button>
          </section>

          <section className={`panel bulk-toolbar${selectedOperators.size ? ' bulk-active' : ''}`}>
            <strong>{selectedOperators.size ? `Vybráno ${selectedOperators.size} OP` : 'Hromadná správa OP'}</strong>
            <span className="muted">Označte lidi kartou nebo je přetáhněte mezi odděleními.</span>
            <select aria-label="Cílové oddělení pro vybrané OP" value={bulkArea} onChange={(event) => setBulkArea(event.target.value)}>{areas.map((area) => <option key={area} value={area}>{area}</option>)}</select>
            <button type="button" disabled={selectedOperators.size === 0} onClick={() => setConfirmBulkAction('move')}>Přesunout vybrané</button>
            <button type="button" className="secondary" disabled={selectedOperators.size === 0} onClick={() => setConfirmBulkAction('return')}>Vrátit na start</button>
            {selectedOperators.size > 0 && <button type="button" className="secondary" onClick={() => setSelectedOperators(new Set())}>Zrušit výběr</button>}
            {lastShiftBeforeAction && <button type="button" className="secondary" onClick={undoLastAction}>Zpět poslední akci</button>}
            {confirmBulkAction && <div className="bulk-confirm"><span>{confirmBulkAction === 'move' ? `Přesunout ${selectedOperators.size} OP do ${bulkArea}?` : `Vrátit ${selectedOperators.size} OP na startovní pozici?`}</span><button type="button" onClick={confirmBulkAction === 'move' ? moveSelectedOperators : returnSelectedOperators}>Potvrdit</button><button type="button" className="secondary" onClick={() => setConfirmBulkAction(null)}>Zrušit</button></div>}
          </section>

          <section className={`department-grid board-view-${boardView}`} aria-label="Oddělení směny">
            {areas.map((area) => {
              const operators = filterOperators(shift.operators, query, transportOnly).filter((operator) => operator.current === area);
              const areaClass = area.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              return <article className={`department-card area-${areaClass}${draggedOperator ? ' drop-ready' : ''}`} key={area} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOperator(area)}>
                <header><div><span>{area}</span><b>{shift.operators.filter((operator) => operator.current === area).length}</b></div><div className="department-tools"><small>{operators.length ? `${operators.length} zobrazeno` : 'Bez obsazení'}</small>{shift.operators.some((operator) => operator.current === area) && <button type="button" className="header-action" onClick={() => toggleAreaSelection(area)}>{shift.operators.filter((operator) => operator.current === area).every((operator) => selectedOperators.has(operator.name)) ? 'Zrušit' : 'Vybrat vše'}</button>}</div></header>
                <div className="operator-list">{operators.length ? operators.map((operator) => <article className={`operator-card${selectedOperators.has(operator.name) ? ' selected' : ''}`} key={operator.name} draggable onDragStart={() => setDraggedOperator(operator.name)} onDragEnd={() => setDraggedOperator('')}><label className="operator-select"><input type="checkbox" checked={selectedOperators.has(operator.name)} onChange={() => toggleOperator(operator.name)} /><span><strong>{operator.name}</strong><small>{operator.home !== operator.current ? `${operator.home} → ${operator.current}` : operator.home}</small></span></label><select aria-label={`Pracoviště ${operator.name}`} value={operator.current} onChange={(event) => setShift((current) => current ? moveOperator(current, operator.name, event.target.value) : current)}>{areas.map((target) => <option key={target} value={target}>{target}</option>)}</select>{operator.current !== operator.start && <button type="button" className="tiny" onClick={() => setShift((current) => current ? returnToStart(current, operator.name) : current)}>Vrátit</button>}</article>) : <p className="empty-department">Přidejte člověka nebo jej sem přesuňte.</p>}</div>
              </article>;
            })}
          </section>

        </>
      ) : <section className="panel empty-page"><h1>Nejdřív založte směnu</h1><button type="button" onClick={() => setActivePage('board')}>Zpět na přehled</button></section>}

      {departmentDialog && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDepartmentDialog(null); }}>
        <section className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="department-dialog-title">
          <span className={`dialog-icon ${departmentDialog.type === 'remove' ? 'danger' : ''}`}>{departmentDialog.type === 'remove' ? '!' : '✎'}</span>
          <div>
            <span className="eyebrow">Správa oddělení</span>
            <h2 id="department-dialog-title">{departmentDialog.type === 'remove' ? `Odebrat ${departmentDialog.name}?` : `Přejmenovat ${departmentDialog.name}`}</h2>
          </div>
          {departmentDialog.type === 'rename' ? <label>Nový název<input autoFocus value={departmentDialog.value} onChange={(event) => setDepartmentDialog({ ...departmentDialog, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') confirmDepartmentRename(); if (event.key === 'Escape') setDepartmentDialog(null); }} /></label> : <p>Všichni OP z tohoto oddělení budou převedeni do <strong>{UNASSIGNED}</strong>. Změnu můžete jednou vrátit na směnové tabuli.</p>}
          <div className="dialog-actions"><button type="button" className="secondary" onClick={() => setDepartmentDialog(null)}>Zrušit</button><button type="button" className={departmentDialog.type === 'remove' ? 'danger' : ''} onClick={departmentDialog.type === 'remove' ? confirmDepartmentRemoval : confirmDepartmentRename}>{departmentDialog.type === 'remove' ? 'Odebrat oddělení' : 'Uložit název'}</button></div>
        </section>
      </div>}

      {resetDialog && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetDialog(false); }}>
        <section className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-dialog-title">
          <span className="dialog-icon danger">!</span><div><span className="eyebrow">Lokální pilot</span><h2 id="reset-dialog-title">Vymazat data pilotu?</h2></div>
          <p>Odstraní se pouze směna, kmen, oddělení a problem solveři uložené v této V2 aplikaci. Původní aplikace a Firebase data zůstanou beze změny.</p>
          <div className="dialog-actions"><button type="button" className="secondary" onClick={() => setResetDialog(false)}>Zrušit</button><button type="button" className="danger" onClick={resetPilot}>Vymazat data</button></div>
        </section>
      </div>}

      <nav className="mobile-nav" aria-label="Mobilní navigace">
        {([['board', 'Směna'], ['roster', 'Stav'], ['import', 'Import']] as [AppPage, string][]).map(([page, label]) => <button type="button" key={page} className={activePage === page ? 'nav-active' : 'secondary'} onClick={() => setActivePage(page)}>{label}</button>)}
      </nav>

    </main>
  );
}
