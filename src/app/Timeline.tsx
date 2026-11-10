import { useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '../core/model';
import { blockInterval, type Interval } from '../core/schedule';
import { formatHM, snap, toWall } from '../core/time';

export const PX_PER_MIN = 1.4;
const SWIPE_PX = 90;

interface Props {
  date: string;
  tz: string;
  blocks: Block[];
  now: Date;
  dayStartMin: number;
  dayEndMin: number;
  snapMin: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (b: Block) => void;
  onDefer: (b: Block) => void;
  onReschedule: (b: Block, startMin: number, durationMin: number) => void;
}

interface Gesture {
  id: string;
  mode: 'pending' | 'move' | 'resize' | 'swipe';
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

interface Laid {
  b: Block;
  iv: Interval;
  lane: number;
  lanes: number;
}

/** Side-by-side lanes for blocks that overlap. */
function layout(items: { b: Block; iv: Interval }[]): Laid[] {
  const sorted = [...items].sort((a, c) => a.iv.startMin - c.iv.startMin || c.iv.endMin - a.iv.endMin);
  const out: Laid[] = [];
  let cluster: Laid[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((l) => l.lane + 1));
    cluster.forEach((l) => (l.lanes = lanes));
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (it.iv.startMin >= clusterEnd && cluster.length) flush();
    const laneEnds: number[] = [];
    cluster.forEach((l) => (laneEnds[l.lane] = Math.max(laneEnds[l.lane] ?? 0, l.iv.endMin)));
    let lane = laneEnds.findIndex((e) => e <= it.iv.startMin);
    if (lane < 0) lane = laneEnds.length;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.iv.endMin);
  }
  if (cluster.length) flush();
  return out;
}

export function Timeline(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [g, setG] = useState<Gesture | null>(null);
  const gRef = useRef<Gesture | null>(null);

  const items = useMemo(
    () =>
      layout(
        p.blocks
          .map((b) => ({ b, iv: blockInterval(b, p.date, p.tz) }))
          .filter((x): x is { b: Block; iv: Interval } => !!x.iv),
      ),
    [p.blocks, p.date, p.tz],
  );

  const startMin = Math.max(0, Math.min(p.dayStartMin, ...items.map((i) => Math.floor(i.iv.startMin / 60) * 60)));
  const endMin = Math.min(1440, Math.max(p.dayEndMin, ...items.map((i) => Math.ceil(i.iv.endMin / 60) * 60)));
  const y = (min: number) => (min - startMin) * PX_PER_MIN;

  const nowWall = toWall(p.now, p.tz);
  const showNow = nowWall.date === p.date && nowWall.minutes >= startMin && nowWall.minutes <= endMin;

  // Scroll so "now" (or the start of the day) is in view when the day changes.
  useEffect(() => {
    const el = scroller.current?.closest('[data-scroll]') as HTMLElement | null;
    if (!el) return;
    const target = showNow ? y(nowWall.minutes) - 160 : 0;
    el.scrollTo({ top: Math.max(0, target) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.date]);

  const hours: number[] = [];
  for (let m = Math.ceil(startMin / 60) * 60; m <= endMin; m += 60) hours.push(m);

  const live = (l: Laid) => {
    if (!g || g.id !== l.b.id) return { start: l.iv.startMin, dur: l.iv.endMin - l.iv.startMin, dx: 0 };
    const dMin = g.dy / PX_PER_MIN;
    if (g.mode === 'move') return { start: snap(l.iv.startMin + dMin, p.snapMin), dur: l.iv.endMin - l.iv.startMin, dx: 0 };
    if (g.mode === 'resize')
      return { start: l.iv.startMin, dur: Math.max(p.snapMin, snap(l.iv.endMin - l.iv.startMin + dMin, p.snapMin)), dx: 0 };
    if (g.mode === 'swipe') return { start: l.iv.startMin, dur: l.iv.endMin - l.iv.startMin, dx: g.dx };
    return { start: l.iv.startMin, dur: l.iv.endMin - l.iv.startMin, dx: 0 };
  };

  const down = (e: React.PointerEvent, b: Block, mode: Gesture['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const next: Gesture = { id: b.id, mode, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
    gRef.current = next;
    setG(next);
  };

  const move = (e: React.PointerEvent) => {
    const cur = gRef.current;
    if (!cur) return;
    const dx = e.clientX - cur.x0;
    const dy = e.clientY - cur.y0;
    let mode = cur.mode;
    if (mode === 'pending') {
      if (Math.abs(dy) > 6 && Math.abs(dy) >= Math.abs(dx)) mode = 'move';
      else if (Math.abs(dx) > 12) mode = 'swipe';
    }
    const next = { ...cur, mode, dx, dy };
    gRef.current = next;
    setG(next);
  };

  const up = (l: Laid) => {
    const cur = gRef.current;
    gRef.current = null;
    setG(null);
    if (!cur) return;
    const v = live(l);
    if (cur.mode === 'pending') p.onToggle(l.b);
    else if (cur.mode === 'swipe' && Math.abs(cur.dx) > SWIPE_PX) p.onDefer(l.b);
    else if ((cur.mode === 'move' || cur.mode === 'resize') && (v.start !== l.iv.startMin || v.dur !== l.iv.endMin - l.iv.startMin))
      p.onReschedule(l.b, Math.max(0, v.start), v.dur);
  };

  return (
    <div ref={scroller} className="relative select-none" style={{ height: y(endMin) + 16 }} onClick={() => p.onSelect(null)}>
      {hours.map((m) => (
        <div key={m} className="absolute inset-x-0 flex items-start" style={{ top: y(m) }} aria-hidden>
          <span className="w-12 -translate-y-2 pr-2 text-right text-xs tabular-nums text-muted">
            {formatHM(m)}
          </span>
          <span className="flex-1 border-t border-line" />
        </div>
      ))}

      {showNow && (
        <div className="pointer-events-none absolute right-0 left-10 z-20 flex items-center" style={{ top: y(nowWall.minutes) }} aria-hidden>
          <span className="h-2.5 w-2.5 -translate-x-1 rounded-full bg-now" />
          <span className="h-0.5 flex-1 bg-now" />
        </div>
      )}

      <ol aria-label="Timeline" className="absolute top-0 right-2 bottom-0 left-14">
        {items.map((l) => {
          const v = live(l);
          const isNow = showNow && l.b.status === 'todo' && l.iv.startMin <= nowWall.minutes && nowWall.minutes < l.iv.endMin;
          const done = l.b.status === 'done';
          const selected = p.selectedId === l.b.id;
          const height = Math.max(v.dur * PX_PER_MIN, 18);
          const short = v.dur < 35;
          const dragging = g?.id === l.b.id && g.mode !== 'pending';
          return (
            <li
              key={l.b.id}
              className="absolute pr-1"
              style={{
                top: y(v.start),
                height,
                left: `${(l.lane / l.lanes) * 100}%`,
                width: `${100 / l.lanes}%`,
                zIndex: dragging ? 30 : 10,
              }}
            >
              <div
                role="button"
                tabIndex={-1}
                data-block-id={l.b.id}
                aria-label={`${l.b.title}, ${formatHM(l.iv.startMin)} to ${formatHM(l.iv.endMin)}${done ? ', done' : ''}. Tap to ${done ? 'reopen' : 'complete'}.`}
                aria-pressed={done}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => down(e, l.b, 'pending')}
                onPointerMove={move}
                onPointerUp={() => up(l)}
                onPointerCancel={() => setG(null)}
                className={[
                  'group relative flex h-full cursor-grab touch-none overflow-hidden rounded-xl border px-2.5 text-sm transition-[box-shadow,opacity]',
                  short ? 'items-center gap-2' : 'flex-col py-1',
                  done
                    ? 'border-line bg-raised text-muted'
                    : isNow
                      ? 'border-accent-strong bg-accent-soft text-ink'
                      : 'border-line bg-surface text-ink',
                  selected ? 'ring-2 ring-accent-strong ring-offset-1 ring-offset-ground' : '',
                  dragging ? 'cursor-grabbing shadow-lg' : '',
                ].join(' ')}
                style={{ transform: v.dx ? `translateX(${v.dx}px)` : undefined, opacity: Math.abs(v.dx) > SWIPE_PX ? 0.5 : undefined }}
              >
                <span className={`truncate font-medium ${done ? 'line-through' : ''}`}>{l.b.title}</span>
                <span className="shrink-0 text-xs tabular-nums opacity-70">
                  {formatHM(v.start)}–{formatHM(v.start + v.dur)}
                </span>
                {Math.abs(v.dx) > 12 && (
                  <span className="absolute inset-y-0 right-2 flex items-center text-xs font-medium">
                    {Math.abs(v.dx) > SWIPE_PX ? 'Release: tomorrow' : 'Defer →'}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`More actions for ${l.b.title}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onSelect(selected ? null : l.b.id);
                  }}
                  className="absolute top-0.5 right-0.5 rounded px-1.5 text-base leading-5 opacity-60 hover:bg-raised hover:opacity-100 focus-visible:opacity-100"
                >
                  ⋯
                </button>
                <span
                  aria-hidden
                  onPointerDown={(e) => down(e, l.b, 'resize')}
                  onPointerMove={(e) => {
                    e.stopPropagation();
                    move(e);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    up(l);
                  }}
                  className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
