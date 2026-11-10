import type { Block } from '../core/model';
import { outlookComposeUrl } from '../core/calendar';

interface Props {
  block: Block;
  onClose: () => void;
  onIcs: (b: Block) => void;
  onUnschedule: (b: Block) => void;
  onPlace: (b: Block) => void;
  onDefer: (b: Block) => void;
  onDelete: (b: Block) => void;
}

const btn =
  'rounded-lg px-2.5 py-1.5 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800';

export function ActionBar({ block: b, ...p }: Props) {
  const outlook = outlookComposeUrl(b);
  return (
    <div role="toolbar" aria-label={`Actions for ${b.title}`} className="flex flex-wrap items-center gap-1 border-t border-slate-200 bg-white px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900">
      <span className="mr-auto truncate px-1 text-sm font-semibold">{b.title}</span>
      {outlook && (
        <a href={outlook} target="_blank" rel="noopener noreferrer" className={`${btn} text-indigo-700 dark:text-indigo-300`}>
          Add to Outlook
        </a>
      )}
      {outlook && (
        <button type="button" className={btn} onClick={() => p.onIcs(b)}>
          .ics
        </button>
      )}
      {b.start ? (
        <button type="button" className={btn} onClick={() => p.onUnschedule(b)}>
          To tray
        </button>
      ) : (
        <button type="button" className={btn} onClick={() => p.onPlace(b)}>
          Place
        </button>
      )}
      <button type="button" className={btn} onClick={() => p.onDefer(b)}>
        Tomorrow
      </button>
      <button type="button" className={`${btn} text-rose-700 dark:text-rose-300`} onClick={() => p.onDelete(b)}>
        Delete
      </button>
      <button type="button" aria-label="Close actions" className={btn} onClick={p.onClose}>
        ✕
      </button>
    </div>
  );
}
