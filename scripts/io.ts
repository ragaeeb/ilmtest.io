import { brotliDecompressSync } from 'node:zlib';

/**
 * Decompresses a Brotli buffer into a UTF-8 string.
 */
export const decompressString = (buf: ArrayBuffer | Uint8Array) => {
    const out = brotliDecompressSync(buf);
    return out.toString('utf8');
};

/**
 * Decompresses a Brotli buffer and parses the JSON payload.
 */
export const decompressJson = <T = unknown>(buf: ArrayBuffer | Uint8Array) => {
    return JSON.parse(decompressString(buf)) as T;
};

/**
 * Reads and decompresses a Brotli-compressed JSON file from disk.
 * Using Bun's native file API (recommended).
 */
export const decompressJsonFile = async <T = unknown>(filePath: string) => {
    const file = Bun.file(filePath);
    const buffer = await file.arrayBuffer(); // or file.bytes() for Uint8Array
    return decompressJson(buffer) as T;
};
