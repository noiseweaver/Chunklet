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
  'flex h-10 items-center rounded-full px-3 text-sm font-medium hover:bg-raised';

export function ActionBar({ block: b, ...p }: Props) {
  const outlook = outlookComposeUrl(b);
  return (
    <div role="toolbar" aria-label={`Actions for ${b.title}`} className="mx-4 mb-2 flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-surface px-2 py-1.5 shadow-lg">
      <span className="mr-auto truncate px-1 text-sm font-semibold">{b.title}</span>
      {outlook && (
        <a href={outlook} target="_blank" rel="noopener noreferrer" className={`${btn} text-accent-strong font-semibold`}>
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
      <button type="button" className={`${btn} text-danger`} onClick={() => p.onDelete(b)}>
        Delete
      </button>
      <button type="button" aria-label="Close actions" className={btn} onClick={p.onClose}>
        ✕
      </button>
    </div>
  );
}
