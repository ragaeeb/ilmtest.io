import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runBundleCheck = async (cwd: string, scriptPath: string) => {
    const proc = Bun.spawn(['bun', scriptPath], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    });
    const [stdout, stderr] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : '',
        proc.stderr ? new Response(proc.stderr).text() : '',
        proc.exited,
    ]);
    return {
        exitCode: proc.exitCode ?? 0,
        stdout,
        stderr,
    };
};

describe('checkBundle', () => {
    const root = process.cwd();
    const scriptPath = join(root, 'scripts', 'checkBundle.ts');

    it('fails when index signatures appear in bundle output', async () => {
        const tempRoot = await mkdtemp(join(tmpdir(), 'ilmtest-bundle-'));
        try {
            const distDir = join(tempRoot, 'dist', 'functions', 'chunks');
            await mkdir(distDir, { recursive: true });
            await writeFile(join(distDir, 'bad.js'), 'const data = {"sectionToExcerpts":{}};');

            const result = await runBundleCheck(tempRoot, scriptPath);

            expect(result.exitCode).not.toBe(0);
            expect(result.stderr + result.stdout).toContain('indexes');
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

            const result = await runBundleCheck(tempRoot, scriptPath);

            expect(result.exitCode).toBe(0);
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

            const result = await runBundleCheck(tempRoot, scriptPath);

            expect(result.exitCode).not.toBe(0);
            expect(result.stderr + result.stdout).toContain('indexes');
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });
});
