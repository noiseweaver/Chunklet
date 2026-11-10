import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toIcs } from '../core/calendar';
import { DEFAULT_SETTINGS, type Block } from '../core/model';
import { draftToBlock, type Draft } from '../core/parser';
import { autoPlace, currentBlock, defer, reschedule, unschedule } from '../core/schedule';
import { addDays, toWall } from '../core/time';
import { db, exportBackup, importBackup, newId, putBlocks, restore, runRollover, softDelete } from '../db';
import { ActionBar } from './ActionBar';
import { Capture } from './Capture';
import { download } from './download';
import { Timeline } from './Timeline';
import { Tray } from './Tray';
import { useNow } from './useNow';

const settings = DEFAULT_SETTINGS;
const tz = settings.tz;

interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
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
  const running = viewDate === today ? currentBlock(blocks, now) : undefined;
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

  const menuItem = 'block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800';

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col">
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 dark:border-slate-800">
        <div className="flex items-center">
          <button type="button" aria-label="Previous day" onClick={() => setOffset((o) => o - 1)} className="rounded-lg px-2 py-1 text-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            ‹
          </button>
          <button type="button" onClick={() => setOffset(0)} className="min-w-24 rounded-lg px-1 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
            <h1 className="text-base leading-tight font-semibold">{dayLabel(viewDate, today)}</h1>
            <p className="text-xs leading-tight text-slate-500 dark:text-slate-400">
              {new Date(`${viewDate}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}
            </p>
          </button>
          <button type="button" aria-label="Next day" onClick={() => setOffset((o) => o + 1)} className="rounded-lg px-2 py-1 text-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            ›
          </button>
        </div>

        <div className="min-w-0 flex-1 text-right" aria-live="polite">
          {running && (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-1 text-sm text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100">
              <span className="truncate">{running.block.title}</span>
              <span className="font-semibold tabular-nums">{formatLeft(running.msLeft)}</span>
            </span>
          )}
        </div>

        <details className="relative">
          <summary aria-label="Menu" className="cursor-pointer list-none rounded-lg px-2 py-1 text-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            ☰
          </summary>
          <div className="absolute right-0 z-40 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
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

      <main data-scroll className="flex-1 overflow-y-auto px-3 py-3">
        <div className="grid gap-4 md:grid-cols-[1fr_300px]">
          <div className="md:order-2">
            <div className="md:sticky md:top-0">
              <Tray
                blocks={tray}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onToggle={(b) => void toggle(b)}
                onPlace={(b) => place([b])}
                onPlaceAll={() => place(tray.filter((b) => b.status !== 'done'))}
                canPlace={canPlace}
              />
              <p className="mt-3 hidden px-1 text-xs text-slate-500 md:block dark:text-slate-400">
                Tap a block to complete it, drag to move, drag its bottom edge to resize, swipe sideways to push it to tomorrow. Press <kbd>?</kbd> for shortcuts.
              </p>
            </div>
          </div>
          <div className="md:order-1">
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
        </div>
      </main>

      <footer className="sticky bottom-0 z-30">
        {toast && (
          <div role="status" className="mx-3 mb-2 flex items-center gap-3 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
            <span className="flex-1">{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                className="font-semibold text-indigo-300 dark:text-indigo-700"
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
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 id="help-title" className="mb-2 font-semibold">
              Keyboard shortcuts
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>
                    <kbd className="rounded border border-slate-300 px-1.5 font-mono text-xs dark:border-slate-600">{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <button type="button" className="mt-3 w-full rounded-lg bg-slate-100 py-2 text-sm font-medium dark:bg-slate-800" onClick={() => setHelp(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
