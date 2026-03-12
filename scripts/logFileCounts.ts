import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const walk = async (dir: string): Promise<number> => {
    let count = 0;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            count += await walk(fullPath);
        } else {
            const info = await stat(fullPath);
            if (info.isFile()) {
                count += 1;
            }
        }
    }
    return count;
};

const main = async () => {
    const distDir = join(process.cwd(), 'dist');
    const publicChunks = join(process.cwd(), 'tmp', 'excerpt-chunks');

    let distCount = 0;
    let chunkCount = 0;
    try {
        distCount = await walk(distDir);
    } catch {
        distCount = -1;
    }
    try {
        chunkCount = await walk(publicChunks);
    } catch {
        chunkCount = -1;
    }

    console.log(
        JSON.stringify(
            {
                distCount,
                chunkCount,
                total: distCount + chunkCount,
            },
            null,
            2,
        ),
    );
};

await main();
