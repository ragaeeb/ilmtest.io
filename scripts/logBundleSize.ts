import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const main = async () => {
    const baseDir = join(process.cwd(), 'dist', '_worker.js');
    const chunksDir = join(baseDir, 'chunks');

    const chunkFiles = await readdir(chunksDir);
    const sizes = await Promise.all(
        chunkFiles.map(async (name) => {
            const filePath = join(chunksDir, name);
            const info = await stat(filePath);
            return { name, size: info.size };
        }),
    );

    const totalChunksSize = sizes.reduce((sum, item) => sum + item.size, 0);
    const sorted = [...sizes].sort((a, b) => b.size - a.size);
    const top = sorted.slice(0, 5);
    const dataLayer = sizes.find((item) => item.name.startsWith('_astro_data-layer-content'));
    const indexesChunk = sizes.find((item) => item.name.startsWith('indexes_'));

    const baseFiles = await readdir(baseDir);
    const baseSizes = await Promise.all(
        baseFiles.map(async (name) => {
            const filePath = join(baseDir, name);
            const info = await stat(filePath);
            return { name, size: info.size };
        }),
    );

    console.log(
        JSON.stringify(
            {
                chunkCount: sizes.length,
                totalChunksSize,
                dataLayerSize: dataLayer?.size ?? null,
                indexesChunkSize: indexesChunk?.size ?? null,
                top,
                baseFiles: baseSizes,
            },
            null,
            2,
        ),
    );
};

await main();
