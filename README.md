# Chunklet

A local-first planner for the work day. Type what you need to do in plain
language, check the preview, and it lands as blocks on today's timeline.
Everything is stored in your browser (IndexedDB); there is no server and no
account.

## Using it

Type into the box at the bottom, for example:

| You type | You get |
| --- | --- |
| `review PR 30m at 10` | "review PR", 10:00 to 10:30 |
| `9 standup, then 2h schematic work, lunch 12:30, emails 20m` | standup 09:00, schematic work 09:25 to 11:25, lunch 12:30, emails in the tray |
| `call supplier after lunch` | 25 min starting when your lunch block ends |
| `gym tomorrow 18:00 1h` | tomorrow 18:00 to 19:00 |

- Things without a time go to the **Unscheduled** tray. **Auto-place** puts
  them in the next free gaps from now.
- A preview shows what will be added; you can fix the title, time or length
  before pressing **Add** (or Enter). If a time is unclear, such as "at 7"
  in the evening, the preview asks which one you meant.
- Tap a block to complete it, drag it to move it, drag its bottom edge to
  resize it, swipe it sideways to push it to tomorrow.
- Unfinished blocks move to the next day's tray automatically, marked with the
  day they came from.
- **⋯** on a block → **Add to Outlook** opens Outlook on the web
  (Microsoft 365, which is what Teams uses) with the event filled in; you click
  Save. **.ics** downloads a calendar file instead. The menu (☰) has
  **Add whole day to calendar (.ics)**.
- Your data lives only in this browser. Use **☰ → Back up all data** now and
  then; **Restore from backup** merges a backup back in.

### Keyboard

`n` new · `j`/`k` next/previous block · `space` complete · `d` defer to
tomorrow · `u` to tray · `p` place · `o` add to Outlook · `x` delete (with
undo) · `[`/`]`/`t` previous day/next day/today · `?` all shortcuts.

### Parsing rules

- Items are split on new lines, commas, semicolons and "then".
- Durations: `30m`, `20 min`, `2h`, `1h30`, `1.5h`, `90 minutes`,
  "half an hour", "an hour". No duration means 25 minutes.
- Times: `10`, `at 10`, `12:30`, `14.30`, `18:00`, `7pm`, `7:30 am`, plus
  `tomorrow` and weekday names. A bare hour is read as a working-day time
  (7 to 11 morning, 12 noon, 1 to 6 afternoon). If that time has already
  passed today, the preview asks instead of guessing.
- "then X" starts when the previous item ends. "after X" / "before X" attach to
  a block whose title contains X on the same day.
- All times are Europe/Amsterdam and snap to 5 minutes.

## Development

Requires Node 22 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: parser, time, scheduling, calendar, storage
npm run build      # type-check and build to dist/
```

Code layout:

```
src/core/          pure logic, no DOM: model, time zone helpers, parser,
                   auto-place / rollover, Outlook link and .ics writer
src/db.ts          Dexie (IndexedDB) store, rollover, backup and restore
src/app/           React UI: timeline, tray, capture box with preview
```
