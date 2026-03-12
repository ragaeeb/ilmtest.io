import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIntegrityChecks } from './checkIntegrity';
import { materializeFixture } from './fixtures';

const tempDirs: string[] = [];

afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('fixtures', () => {
    it('materializes the tiny fixture corpus into local runtime paths', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'ilmtest-fixture-'));
        tempDirs.push(rootDir);

        const result = await materializeFixture('tiny', {
            rootDir,
            generatedAt: '2026-03-12T18:42:10.000Z',
            gitCommit: 'fixture1',
        });

        expect(result.collections).toBe(2);
        expect(result.sections).toBe(7);
        expect(result.excerpts).toBe(32);
        expect(result.chunks).toBeGreaterThan(result.sections);
        expect(await Bun.file(join(rootDir, 'src', 'data', 'collections.json')).exists()).toBe(true);
        expect(await Bun.file(join(rootDir, 'tmp', 'dataset-build', 'metadata.json')).exists()).toBe(true);
    });

    it('passes integrity checks on the medium fixture corpus', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'ilmtest-fixture-'));
        tempDirs.push(rootDir);

        await materializeFixture('medium', {
            rootDir,
            generatedAt: '2026-03-12T18:42:10.000Z',
            gitCommit: 'fixture2',
        });

        const result = await runIntegrityChecks(rootDir);
        expect(result.collections).toBe(2);
        expect(result.sections).toBe(200);
        expect(result.excerpts).toBe(900);
        expect(result.generatedRoutes).toBeGreaterThan(result.sections);
    });
});
