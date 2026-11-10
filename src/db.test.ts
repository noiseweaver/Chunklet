import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Block } from './core/model';
import { ChunkletDB, exportBackup, importBackup, putBlocks, runRollover, softDelete, restore } from './db';

let dbs: ChunkletDB[] = [];
const fresh = () => {
  const d = new ChunkletDB(`test-${Math.random()}`);
  dbs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dbs.map((d) => d.delete()));
  dbs = [];
});

const mk = (p: Partial<Block>): Block => ({
  id: Math.random().toString(36).slice(2),
  title: 't',
  date: '2026-11-10',
  durationMin: 25,
  status: 'todo',
  source: 'local',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...p,
});
const NOW = new Date('2026-11-10T08:00:00Z');

describe('db', () => {
  it('rolls unfinished work into today and never drops a block', async () => {
    const d = fresh();
    await putBlocks(d, [
      mk({ id: 'old', date: '2026-11-08', start: '2026-11-08T09:00:00.000Z', end: '2026-11-08T09:25:00.000Z' }),
      mk({ id: 'done', date: '2026-11-08', status: 'done' }),
      mk({ id: 'future', date: '2026-11-12' }),
    ]);
    expect(await runRollover(d, '2026-11-10', NOW)).toBe(1);
    expect(await d.blocks.get('old')).toMatchObject({ date: '2026-11-10', start: undefined, rolledFrom: '2026-11-08' });
    expect(await d.blocks.count()).toBe(3);
    expect((await d.meta.get('lastRollover'))?.value).toBe('2026-11-10');
  });

  it('soft-deletes and restores', async () => {
    const d = fresh();
    await putBlocks(d, [mk({ id: 'a' })]);
    await softDelete(d, 'a', NOW);
    expect((await d.blocks.get('a'))?.deletedAt).toBe(NOW.toISOString());
    await restore(d, 'a', NOW);
    expect((await d.blocks.get('a'))?.deletedAt).toBeUndefined();
  });

  it('backs up and restores, newer edits win', async () => {
    const a = fresh();
    await putBlocks(a, [mk({ id: 'x', title: 'old', updatedAt: '2026-11-01T00:00:00.000Z' }), mk({ id: 'y' })]);
    const backup = JSON.parse(JSON.stringify(await exportBackup(a, NOW)));

    const b = fresh();
    await putBlocks(b, [mk({ id: 'x', title: 'newer', updatedAt: '2026-11-05T00:00:00.000Z' })]);
    expect(await importBackup(b, backup)).toBe(1);
    expect((await b.blocks.get('x'))?.title).toBe('newer');
    expect(await b.blocks.count()).toBe(2);
  });

  it('rejects files that are not backups', async () => {
    await expect(importBackup(fresh(), { hello: 1 })).rejects.toThrow(/not a Chunklet backup/);
  });
});
