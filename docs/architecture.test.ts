import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const extractMarkdownLinks = (content: string) => {
    return [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
};

describe('architecture docs', () => {
    it('links to existing ADR and operational docs', async () => {
        const architecturePath = join(process.cwd(), 'docs', 'architecture.md');
        const content = await Bun.file(architecturePath).text();
        const links = extractMarkdownLinks(content).filter((link) =>
            link.startsWith('/Users/rhaq/workspace/ilmtest.io/'),
        );

        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
            expect(existsSync(link)).toBe(true);
        }
    });
});
