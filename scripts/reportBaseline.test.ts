import { afterAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeFixture } from './fixtures';
import { generateBaselineReport } from './reportBaseline';

const tempDirs: string[] = [];

afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('reportBaseline', () => {
    it('generates the expected report shape from fixture data without credentials', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'ilmtest-baseline-'));
        tempDirs.push(rootDir);

        await materializeFixture('tiny', {
            rootDir,
            generatedAt: '2026-03-12T18:42:10.000Z',
            gitCommit: 'fixture3',
        });

        await mkdir(join(rootDir, 'dist', 'functions'), { recursive: true });
        await Bun.write(join(rootDir, 'dist', 'index.html'), '<!doctype html><title>Fixture</title>');
        await Bun.write(join(rootDir, 'dist', 'functions', 'index.mjs'), 'export default {}');

        const report = await generateBaselineReport({
            rootDir,
            runCommands: false,
            commandStatuses: [{ label: 'noop', ok: true, exitCode: 0, durationMs: 0 }],
        });

        expect(report.collections).toBe(2);
        expect(report.translators).toBeGreaterThan(0);
        expect(report.srcData.files).toBeGreaterThanOrEqual(4);
        expect(report.excerptChunks.files).toBeGreaterThan(0);
        expect(report.serverBundle.files).toBeGreaterThan(0);
        expect(report.routeReadFanOut.collectionRoute.pageSize).toBe(100);
        expect(report.commands).toHaveLength(1);
        expect(report.deployCoupling.usesPagesDeploy).toBe(false);
        expect(report.deployCoupling.usesLegacyUploadR2).toBe(false);
        expect(report.deployCoupling.publishDatasetScript).toBeNull();
    });
});
