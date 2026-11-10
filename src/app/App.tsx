import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toIcs } from '../core/calendar';
import { DEFAULT_SETTINGS, type Block } from '../core/model';
import { draftToBlock, type Draft } from '../core/parser';
import { autoPlace, defer, reschedule, unschedule } from '../core/schedule';
import { addDays, toWall } from '../core/time';
import { db, exportBackup, importBackup, newId, putBlocks, restore, runRollover, softDelete } from '../db';
import { ActionBar } from './ActionBar';
import { Capture } from './Capture';
import { download } from './download';
import { Timeline } from './Timeline';
import { Agenda, TrayList } from './Agenda';
import { Hero } from './Hero';
import { useNow } from './useNow';

const settings = DEFAULT_SETTINGS;
const tz = settings.tz;

interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
}

const SHORTCUTS: [string, string][] = [
  ['n', 'New: jump to the capture box'],
  ['j / k', 'Next / previous block'],
  ['space', 'Complete or reopen'],
  ['d', 'Defer to tomorrow'],
  ['u / p', 'To tray / auto-place'],
  ['o', 'Add to Outlook'],
  ['x', 'Delete (with undo)'],
  ['[ / ] / t', 'Previous day / next day / today'],
  ['v', 'Switch between list and timeline'],
  ['esc', 'Clear selection'],
];

export function App() {
  const now = useNow(1000);
  const today = toWall(now, tz).date;
  const [offset, setOffset] = useState(0);
  const viewDate = addDays(today, offset);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [help, setHelp] = useState(false);
  const [view, setViewState] = useState<'list' | 'timeline'>(() => {
    try {
      return localStorage.getItem('chunklet.view') === 'timeline' ? 'timeline' : 'list';
    } catch {
      return 'list';
    }
  });
  const setView = (v: 'list' | 'timeline') => {
    setViewState(v);
    try {
      localStorage.setItem('chunklet.view', v);
    } catch {
      /* private mode: keep it for this visit only */
    }
  };
  const captureRef = useRef<HTMLTextAreaElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  // Unfinished work never vanishes: once per day it moves to today's tray.
  useEffect(() => {
    void runRollover(db, today, new Date());
  }, [today]);

  const raw = useLiveQuery(
    () => db.blocks.where('date').between(addDays(viewDate, -1), viewDate, true, true).toArray(),
    [viewDate],
  );
  const blocks = useMemo(() => (raw ?? []).filter((b) => !b.deletedAt), [raw]);
  const scheduled = useMemo(() => blocks.filter((b) => b.start && b.end), [blocks]);
  const tray = useMemo(
    () =>
      blocks
        .filter((b) => b.date === viewDate && !b.start)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.updatedAt.localeCompare(b.updatedAt)),
    [blocks, viewDate],
  );
  const ordered = useMemo(
    () => [...scheduled.filter((b) => b.date === viewDate).sort((a, b) => a.start!.localeCompare(b.start!)), ...tray],
    [scheduled, tray, viewDate],
  );
  const selected = blocks.find((b) => b.id === selectedId) ?? null;
  const canPlace = viewDate >= today;

  const notify = useCallback((message: string, undo?: () => void) => setToast({ id: Date.now(), message, undo }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const save = (b: Block) => putBlocks(db, [b]);
  const stamp = () => new Date().toISOString();

  const toggle = (b: Block) => save({ ...b, status: b.status === 'done' ? 'todo' : 'done', updatedAt: stamp() });

  const deferBlock = (b: Block) => {
    void save(defer(b, new Date(), tz));
    if (selectedId === b.id) setSelectedId(null);
    notify(`"${b.title}" moved to tomorrow`, () => void save({ ...b, updatedAt: stamp() }));
  };

  const remove = (b: Block) => {
    void softDelete(db, b.id, new Date());
    if (selectedId === b.id) setSelectedId(null);
    notify(`Deleted "${b.title}"`, () => void restore(db, b.id, new Date()));
  };

  const place = (items: Block[]) => {
    const placed = autoPlace(items, scheduled, {
      date: viewDate,
      tz,
      now: new Date(),
      dayStartMin: settings.dayStartMin,
      dayEndMin: settings.dayEndMin,
      snapMin: settings.snapMin,
    });
    void putBlocks(db, placed);
    const left = items.length - placed.length;
    if (left > 0) notify(left === items.length ? 'No free gap left today' : `${left} item${left > 1 ? 's' : ''} did not fit today`);
    else if (view === 'list' && placed.length) notify(`Placed ${placed.length} block${placed.length > 1 ? 's' : ''}`);
  };

  const commit = (drafts: Draft[]) => {
    const t = new Date();
    const made = drafts.map((d, i) => ({ ...draftToBlock(d, tz, t, newId()), order: t.getTime() + i }));
    void putBlocks(db, made);
    const elsewhere = made.find((b) => b.date !== viewDate);
    if (elsewhere) notify(`Added to ${dayLabel(elsewhere.date, today).toLowerCase()}`);
  };

  const downloadIcs = (items: Block[], name: string) => {
    const withTimes = items.filter((b) => b.start && b.status !== 'deferred');
    if (!withTimes.length) return notify('Nothing scheduled to export');
    download(`${name}.ics`, toIcs(withTimes, new Date()), 'text/calendar');
  };

  const backup = async () => {
    const data = await exportBackup(db, new Date());
    download(`chunklet-backup-${today}.json`, JSON.stringify(data, null, 2), 'application/json');
  };

  const onRestoreFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const n = await importBackup(db, JSON.parse(await file.text()));
      notify(`Restored ${n} block${n === 1 ? '' : 's'}`);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not read that file');
    }
  };

  // Keyboard first on desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const sel = ordered.find((b) => b.id === selectedId);
      const go = (dir: 1 | -1) => {
        if (!ordered.length) return;
        const i = ordered.findIndex((b) => b.id === selectedId);
        const next = ordered[i < 0 ? (dir > 0 ? 0 : ordered.length - 1) : (i + dir + ordered.length) % ordered.length]!;
        setSelectedId(next.id);
        document.querySelector(`[data-block-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      const handled = () => e.preventDefault();
      switch (e.key) {
        case 'n':
          handled();
          captureRef.current?.focus();
          break;
        case 'j':
          handled();
          go(1);
          break;
        case 'k':
          handled();
          go(-1);
          break;
        case ' ':
          if (sel) {
            handled();
            void toggle(sel);
          }
          break;
        case 'd':
          if (sel) deferBlock(sel);
          break;
        case 'x':
        case 'Delete':
        case 'Backspace':
          if (sel) {
            handled();
            remove(sel);
          }
          break;
        case 'u':
          if (sel?.start) void save(unschedule(sel, new Date()));
          break;
        case 'p':
          if (sel && !sel.start && canPlace) place([sel]);
          break;
        case 'o': {
          const link = sel && document.querySelector<HTMLAnchorElement>('[role="toolbar"] a[href*="outlook"]');
          link?.click();
          break;
        }
        case '[':
          setOffset((o) => o - 1);
          break;
        case ']':
          setOffset((o) => o + 1);
          break;
        case 't':
          setOffset(0);
          break;
        case 'v':
          setView(view === 'list' ? 'timeline' : 'list');
          break;
        case '?':
          setHelp((h) => !h);
          break;
        case 'Escape':
          setSelectedId(null);
          setHelp(false);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const menuItem = 'block w-full rounded-xl px-3 py-2.5 text-left text-sm hover:bg-raised';
  const iconBtn = 'flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-raised hover:text-ink';
  const dateCaps = new Date(`${viewDate}T12:00:00Z`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .toUpperCase();
  const segment = (v: 'list' | 'timeline', label: string) => (
    <button
      type="button"
      aria-pressed={view === v}
      onClick={() => setView(v)}
      className={`h-9 rounded-full px-3 text-sm font-medium ${view === v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      <header className="flex items-center gap-1 px-2 pt-[max(0.75rem,env(safe-area-inset-top))] pb-1">
        <button type="button" aria-label="Previous day" onClick={() => setOffset((o) => o - 1)} className={iconBtn}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button type="button" onClick={() => setOffset(0)} className="flex min-h-11 flex-col items-start justify-center rounded-xl px-1.5" aria-label={`${dayLabel(viewDate, today)}, go to today`}>
          <span className="font-display text-[15px] leading-tight font-semibold tracking-wide whitespace-nowrap">{dateCaps}</span>
          <span className="text-xs leading-tight text-muted">{dayLabel(viewDate, today)}</span>
        </button>
        <button type="button" aria-label="Next day" onClick={() => setOffset((o) => o + 1)} className={iconBtn}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        <div className="ml-auto flex items-center gap-1 rounded-full bg-raised p-1" role="group" aria-label="View">
          {segment('list', 'List')}
          {segment('timeline', 'Timeline')}
        </div>

        <details className="relative">
          <summary aria-label="Menu" className={`${iconBtn} cursor-pointer list-none`}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </summary>
          <div className="absolute right-0 z-40 mt-1 w-64 rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
            <button type="button" className={menuItem} onClick={() => downloadIcs(scheduled.filter((b) => b.date === viewDate), `chunklet-${viewDate}`)}>
              Add whole day to calendar (.ics)
            </button>
            <button type="button" className={menuItem} onClick={() => void backup()}>
              Back up all data
            </button>
            <button type="button" className={menuItem} onClick={() => restoreRef.current?.click()}>
              Restore from backup…
            </button>
            <button type="button" className={menuItem} onClick={() => setHelp(true)}>
              Keyboard shortcuts
            </button>
          </div>
        </details>
        <input
          ref={restoreRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void onRestoreFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </header>

      <main data-scroll className="flex-1 overflow-y-auto px-4 pb-4">
        {viewDate === today && (
          <Hero blocks={blocks} now={now} tz={tz} onDone={(b) => void toggle(b)} onDefer={deferBlock} />
        )}
        <div className={`flex flex-col gap-3 ${viewDate === today ? '' : 'pt-3'}`}>
          {view === 'list' ? (
            <Agenda
              date={viewDate}
              tz={tz}
              now={now}
              scheduled={scheduled}
              tray={tray}
              selectedId={selectedId}
              canPlace={canPlace}
              isToday={viewDate === today}
              onSelect={setSelectedId}
              onToggle={(b) => void toggle(b)}
              onDefer={deferBlock}
              onPlace={place}
            />
          ) : (
            <div className="rounded-2xl bg-surface px-1 pt-4 pb-1">
              <Timeline
                date={viewDate}
                tz={tz}
                blocks={scheduled}
                now={now}
                dayStartMin={settings.dayStartMin}
                dayEndMin={settings.dayEndMin}
                snapMin={settings.snapMin}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onToggle={(b) => void toggle(b)}
                onDefer={deferBlock}
                onReschedule={(b, start, dur) => void save(reschedule(b, viewDate, start, dur, tz, new Date()))}
              />
            </div>
          )}
          <TrayList
            tray={tray}
            selectedId={selectedId}
            canPlace={canPlace}
            onSelect={setSelectedId}
            onToggle={(b) => void toggle(b)}
            onDefer={deferBlock}
            onPlace={place}
          />
          <p className="hidden px-2 text-xs text-muted md:block">
            Tap to complete, swipe sideways to push to tomorrow. In the timeline, drag to move and drag the bottom edge to resize. Press <kbd>?</kbd> for shortcuts.
          </p>
        </div>
      </main>

      <footer className="z-30">
        {toast && (
          <div role="status" className="mx-4 mb-2 flex items-center gap-3 rounded-2xl bg-ink px-4 py-2.5 text-sm text-ground shadow-lg">
            <span className="flex-1">{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                className="min-h-8 font-semibold text-accent"
                onClick={() => {
                  toast.undo?.();
                  setToast(null);
                }}
              >
                Undo
              </button>
            )}
          </div>
        )}
        {selected && (
          <ActionBar
            block={selected}
            onClose={() => setSelectedId(null)}
            onIcs={(b) => downloadIcs([b], `chunklet-${b.title.replace(/[^\w-]+/g, '-').slice(0, 40)}`)}
            onUnschedule={(b) => void save(unschedule(b, new Date()))}
            onPlace={(b) => place([b])}
            onDefer={deferBlock}
            onDelete={remove}
          />
        )}
        <Capture
          ref={captureRef}
          now={now}
          tz={tz}
          date={viewDate}
          existing={blocks}
          defaultDurationMin={settings.defaultDurationMin}
          snapMin={settings.snapMin}
          onCommit={commit}
        />
      </footer>

      {help && (
        <div role="dialog" aria-modal="true" aria-labelledby="help-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 id="help-title" className="mb-3 font-display text-lg font-semibold">
              Keyboard shortcuts
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>
                    <kbd className="rounded border border-line px-1.5 font-mono text-xs">{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <button type="button" className="mt-4 h-11 w-full rounded-full bg-raised text-sm font-medium" onClick={() => setHelp(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
