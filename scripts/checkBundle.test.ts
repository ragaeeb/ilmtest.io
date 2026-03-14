import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBundle } from './checkBundle';

describe('checkBundle', () => {
    it('fails when index signatures appear in bundle output', async () => {
        const tempRoot = await mkdtemp(join(tmpdir(), 'ilmtest-bundle-'));
        try {
            const distDir = join(tempRoot, 'dist', 'functions', 'chunks');
            await mkdir(distDir, { recursive: true });
            await writeFile(join(distDir, 'bad.js'), 'const data = {"sectionToExcerpts":{}};');

            let error: unknown;
            try {
                await checkBundle(tempRoot);
            } catch (caught) {
                error = caught;
            }
            expect(error).toBeInstanceOf(Error);
            const output = error instanceof Error ? error.message : String(error);
            expect(output).toContain('indexes');
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('passes when bundle output is clean', async () => {
        const tempRoot = await mkdtemp(join(tmpdir(), 'ilmtest-bundle-'));
        try {
            const distDir = join(tempRoot, 'dist', 'functions', 'chunks');
            await mkdir(distDir, { recursive: true });
            await writeFile(join(distDir, 'ok.js'), 'console.log("ok");');

            await checkBundle(tempRoot);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('scans worker bundle files when dist/_worker.js is a file', async () => {
        const tempRoot = await mkdtemp(join(tmpdir(), 'ilmtest-bundle-'));
        try {
            const distDir = join(tempRoot, 'dist');
            await mkdir(distDir, { recursive: true });
            await writeFile(join(distDir, '_worker.js'), 'const data = {"pageToHeading":{}};');

            let error: unknown;
            try {
                await checkBundle(tempRoot);
            } catch (caught) {
                error = caught;
            }
            expect(error).toBeInstanceOf(Error);
            const output = error instanceof Error ? error.message : String(error);
            expect(output).toContain('indexes');
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });
});
