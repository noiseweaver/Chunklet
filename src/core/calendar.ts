import type { Block } from './model';

const compactUtc = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Outlook on the web (Microsoft 365) "new event" page, pre-filled. Nothing is saved until you click Save. */
export function outlookComposeUrl(b: Block, base = 'https://outlook.office.com'): string | undefined {
  if (!b.start || !b.end) return undefined;
  const q = new URLSearchParams({ subject: b.title, startdt: b.start, enddt: b.end, body: 'Planned in Chunklet' });
  return `${base}/calendar/deeplink/compose?${q.toString().replace(/\+/g, '%20')}`;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + n > limit) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** An .ics calendar with one event per scheduled block. */
export function toIcs(blocks: Block[], now: Date): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chunklet//Day planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const b of blocks) {
    if (!b.start || !b.end || b.deletedAt) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${b.id}@chunklet`,
      `DTSTAMP:${compactUtc(now.toISOString())}`,
      `DTSTART:${compactUtc(b.start)}`,
      `DTEND:${compactUtc(b.end)}`,
      `SUMMARY:${escapeText(b.title)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
