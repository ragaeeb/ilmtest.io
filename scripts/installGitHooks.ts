import { chmod, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const PRE_COMMIT_HOOK = `#!/bin/sh
set -eu

bun run lint
bun run check
`;

const main = async () => {
    const gitDir = join(process.cwd(), '.git');
    const hookPath = join(gitDir, 'hooks', 'pre-commit');

    const hasGitDir = await stat(gitDir)
        .then((entry) => entry.isDirectory())
        .catch(() => false);

    if (!hasGitDir) {
        console.log('Skipping git hook install: .git directory not found');
        return;
    }

    await mkdir(dirname(hookPath), { recursive: true });
    await Bun.write(hookPath, PRE_COMMIT_HOOK);
    await chmod(hookPath, 0o755);
    console.log(`Installed pre-commit hook at ${hookPath}`);
};

await main();
