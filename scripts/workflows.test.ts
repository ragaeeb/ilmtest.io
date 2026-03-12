import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

const readWorkflow = async (fileName: string) => {
    return Bun.file(join(process.cwd(), '.github', 'workflows', fileName)).text();
};

describe('workflow contracts', () => {
    it('keeps the contributor lane on the tiny-fixture validation path', async () => {
        const workflow = await readWorkflow('build.yml');

        expect(workflow).toContain('bun run setup-fixture -- tiny');
        expect(workflow).toContain('bun run lint');
        expect(workflow).toContain('bun run check');
        expect(workflow).toContain('bun test');
        expect(workflow).toContain('bun run integrity');
        expect(workflow).toContain('bun run build');
        expect(workflow).toContain('bun run bundle-check');
        expect(workflow).toContain('bun run smoke-routes');
    });

    it('requires runtime probing in the maintainer and release lanes', async () => {
        const maintainer = await readWorkflow('maintainer-fixture.yml');
        const release = await readWorkflow('release-corpus.yml');

        expect(maintainer).toContain('bun run runtime-probe');
        expect(release).toContain('bun run runtime-probe');
    });
});
