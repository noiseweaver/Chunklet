import Dexie, { type Table } from 'dexie';
import type { Block } from './core/model';
import { rollover } from './core/schedule';

export interface Meta {
  key: string;
  value: unknown;
}

export class ChunkletDB extends Dexie {
  blocks!: Table<Block, string>;
  meta!: Table<Meta, string>;

  constructor(name = 'chunklet') {
    super(name);
    this.version(1).stores({
      blocks: 'id, date, status, updatedAt',
      meta: 'key',
    });
  }
}

export const db = new ChunkletDB();

export const newId = () => crypto.randomUUID();

export async function putBlocks(d: ChunkletDB, blocks: Block[]): Promise<void> {
  if (blocks.length) await d.blocks.bulkPut(blocks);
}

export async function softDelete(d: ChunkletDB, id: string, now: Date): Promise<void> {
  const iso = now.toISOString();
  await d.blocks.update(id, { deletedAt: iso, updatedAt: iso });
}

export async function restore(d: ChunkletDB, id: string, now: Date): Promise<void> {
  const b = await d.blocks.get(id);
  if (b) await d.blocks.put({ ...b, deletedAt: undefined, updatedAt: now.toISOString() });
}

/** Run once per day: unfinished and returning deferred blocks move to today's tray. */
export async function runRollover(d: ChunkletDB, today: string, now: Date): Promise<number> {
  return d.transaction('rw', d.blocks, d.meta, async () => {
    const candidates = await d.blocks.where('date').belowOrEqual(today).toArray();
    const changed = rollover(candidates, today, now);
    await putBlocks(d, changed);
    await d.meta.put({ key: 'lastRollover', value: today });
    return changed.length;
  });
}

export interface Backup {
  app: 'chunklet';
  version: 1;
  exportedAt: string;
  blocks: Block[];
}

export async function exportBackup(d: ChunkletDB, now: Date): Promise<Backup> {
  return { app: 'chunklet', version: 1, exportedAt: now.toISOString(), blocks: await d.blocks.toArray() };
}

/** Merge a backup into the store; for the same block the newer `updatedAt` wins. */
export async function importBackup(d: ChunkletDB, data: unknown): Promise<number> {
  const backup = data as Partial<Backup>;
  if (backup?.app !== 'chunklet' || !Array.isArray(backup.blocks)) throw new Error('This is not a Chunklet backup file.');
  const incoming = backup.blocks.filter(
    (b): b is Block => !!b && typeof b.id === 'string' && typeof b.title === 'string' && typeof b.date === 'string',
  );
  return d.transaction('rw', d.blocks, async () => {
    const current = new Map((await d.blocks.bulkGet(incoming.map((b) => b.id))).filter(Boolean).map((b) => [b!.id, b!]));
    const winners = incoming.filter((b) => {
      const mine = current.get(b.id);
      return !mine || mine.updatedAt < b.updatedAt;
    });
    await putBlocks(d, winners);
    return winners.length;
  });
}
