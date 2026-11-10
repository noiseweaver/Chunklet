import type { Block } from '../core/model';

interface Props {
  blocks: Block[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onToggle: (b: Block) => void;
  onPlace: (b: Block) => void;
  onPlaceAll: () => void;
  canPlace: boolean;
}

const shortDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function Tray(p: Props) {
  const open = p.blocks.filter((b) => b.status !== 'done');
  return (
    <section aria-labelledby="tray-heading" className="rounded-xl border border-dashed border-slate-300 p-2 dark:border-slate-700">
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <h2 id="tray-heading" className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Unscheduled <span className="font-normal text-slate-500">({open.length})</span>
        </h2>
        {p.canPlace && open.length > 0 && (
          <button
            type="button"
            onClick={p.onPlaceAll}
            className="rounded-lg px-2 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950"
          >
            Auto-place
          </button>
        )}
      </div>
      {p.blocks.length === 0 ? (
        <p className="px-1 pb-1 text-sm text-slate-500 dark:text-slate-400">Things without a time land here.</p>
      ) : (
        <ul className="space-y-1">
          {p.blocks.map((b) => {
            const done = b.status === 'done';
            const selected = p.selectedId === b.id;
            return (
              <li
                key={b.id}
                data-block-id={b.id}
                className={`flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-sm shadow-sm dark:bg-slate-900 ${
                  selected ? 'ring-2 ring-amber-500' : ''
                }`}
              >
                <button
                  type="button"
                  aria-pressed={done}
                  aria-label={`${b.title}, ${b.durationMin} minutes. ${done ? 'Reopen' : 'Complete'}.`}
                  onClick={() => p.onToggle(b)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    aria-hidden
                    className={`h-4 w-4 shrink-0 rounded-full border ${done ? 'border-emerald-500 bg-emerald-500' : 'border-slate-400'}`}
                  />
                  <span className={`truncate ${done ? 'text-slate-400 line-through' : ''}`}>{b.title}</span>
                  <span className="shrink-0 text-xs text-slate-500 tabular-nums dark:text-slate-400">{b.durationMin}m</span>
                  {b.rolledFrom && (
                    <span className="shrink-0 rounded bg-amber-100 px-1 text-xs text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                      from {shortDay(b.rolledFrom)}
                    </span>
                  )}
                  {b.status === 'deferred' && (
                    <span className="shrink-0 rounded bg-slate-200 px-1 text-xs dark:bg-slate-800">deferred</span>
                  )}
                </button>
                {p.canPlace && !done && (
                  <button
                    type="button"
                    onClick={() => p.onPlace(b)}
                    className="rounded px-1.5 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950"
                  >
                    Place
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`More actions for ${b.title}`}
                  onClick={() => p.onSelect(selected ? null : b.id)}
                  className="rounded px-1.5 text-base leading-5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  ⋯
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
