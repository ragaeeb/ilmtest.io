import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { startAstroDevServer } from './devServerHarness';
import { loadLocalRuntimeData } from './runtimeData';

type ProbeSample = {
    collectionId: string;
    slug: string;
    sectionId: string;
    excerptId: string;
    sectionPath: string;
    excerptPath: string;
    shardPath: string;
};

type MissingArtifactProbe =
    | {
          checked: true;
          path: string;
          status: number;
      }
    | {
          checked: false;
          reason: string;
      };

type RuntimeProbeSummary = {
    baseUrl: string;
    sample: Omit<ProbeSample, 'shardPath'>;
    sectionRoute: {
        coldMs: number;
        warmRunsMs: number[];
        warmP95Ms: number;
    };
    excerptRoute: {
        durationMs: number;
        citationRendered: boolean;
    };
    missingArtifact: MissingArtifactProbe;
};

type RuntimeProbeOptions = {
    baseUrl?: string;
    outputPath?: string;
    port?: number;
    rootDir?: string;
    warmIterations?: number;
};

const getFlagValue = (args: string[], flag: string) => {
    const index = args.indexOf(flag);
    if (index === -1) {
        return undefined;
    }
    return args[index + 1];
};

const percentile = (values: number[], fraction: number) => {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return Number(sorted[index].toFixed(2));
};

const collectProbeSample = async (rootDir = '.') => {
    const { collections, indexes, paths } = await loadLocalRuntimeData(rootDir);

    for (const collection of collections) {
        const sectionId = indexes.collectionToSections[collection.id]?.[0];
        const excerptId = sectionId ? indexes.sectionToExcerpts[collection.id]?.[sectionId]?.[0] : null;
        if (!sectionId || !excerptId) {
            continue;
        }

        return {
            collectionId: collection.id,
            slug: collection.slug,
            sectionId,
            excerptId,
            sectionPath: `/browse/${collection.slug}/${sectionId}`,
            excerptPath: `/browse/${collection.slug}/${sectionId}/e/${excerptId}`,
            shardPath: join(paths.runtimeArtifactsDir, 'collections', `${collection.id}.json`),
        } satisfies ProbeSample;
    }

    throw new Error('Unable to find a section/excerpt route sample in the local corpus');
};

const fetchMeasured = async (baseUrl: string, path: string) => {
    const startedAt = performance.now();
    const response = await fetch(new URL(path, baseUrl));
    const body = await response.text();

    return {
        status: response.status,
        body,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
    };
};

const assertOk = (label: string, result: Awaited<ReturnType<typeof fetchMeasured>>) => {
    if (result.status !== 200) {
        throw new Error(`${label} failed with ${result.status}`);
    }
};

const runMissingArtifactProbe = async (sample: ProbeSample, port: number) => {
    const backupPath = `${sample.shardPath}.bak`;
    await rename(sample.shardPath, backupPath);

    try {
        const server = await startAstroDevServer(port);
        try {
            const result = await fetchMeasured(server.baseUrl, sample.sectionPath);
            if (result.status !== 503) {
                throw new Error(`missing-artifact probe expected 503, received ${result.status}`);
            }
            if (!result.body.includes('unavailable')) {
                throw new Error('missing-artifact probe did not render the controlled runtime-unavailable message');
            }

            return {
                checked: true,
                path: sample.sectionPath,
                status: result.status,
            } satisfies MissingArtifactProbe;
        } finally {
            await server.dispose();
        }
    } finally {
        await rename(backupPath, sample.shardPath);
    }
};

export const runRuntimeProbe = async (options: RuntimeProbeOptions = {}): Promise<RuntimeProbeSummary> => {
    const port = options.port ?? 4325;
    const warmIterations = options.warmIterations ?? 5;
    const sample = await collectProbeSample(options.rootDir);
    const server = options.baseUrl ? null : await startAstroDevServer(port);
    const targetBaseUrl = options.baseUrl ?? server?.baseUrl;

    if (!targetBaseUrl) {
        throw new Error('Failed to determine runtime probe base URL');
    }

    try {
        const coldSection = await fetchMeasured(targetBaseUrl, sample.sectionPath);
        assertOk('cold section route', coldSection);

        const warmRuns: number[] = [];
        for (let index = 0; index < warmIterations; index += 1) {
            const warmResult = await fetchMeasured(targetBaseUrl, sample.sectionPath);
            assertOk(`warm section route #${index + 1}`, warmResult);
            warmRuns.push(warmResult.durationMs);
        }

        const excerptRoute = await fetchMeasured(targetBaseUrl, sample.excerptPath);
        assertOk('excerpt route', excerptRoute);

        const summary = {
            baseUrl: targetBaseUrl,
            sample: {
                collectionId: sample.collectionId,
                slug: sample.slug,
                sectionId: sample.sectionId,
                excerptId: sample.excerptId,
                sectionPath: sample.sectionPath,
                excerptPath: sample.excerptPath,
            },
            sectionRoute: {
                coldMs: coldSection.durationMs,
                warmRunsMs: warmRuns,
                warmP95Ms: percentile(warmRuns, 0.95),
            },
            excerptRoute: {
                durationMs: excerptRoute.durationMs,
                citationRendered: excerptRoute.body.includes('Source:'),
            },
            missingArtifact: options.baseUrl
                ? {
                      checked: false,
                      reason: 'missing-artifact probe is only available when the script manages the local dev server',
                  }
                : await runMissingArtifactProbe(sample, port + 1),
        } satisfies RuntimeProbeSummary;

        if (!summary.excerptRoute.citationRendered) {
            throw new Error('excerpt route did not render a citation block');
        }

        if (options.outputPath) {
            await Bun.write(options.outputPath, JSON.stringify(summary, null, 2));
        }

        return summary;
    } finally {
        await server?.dispose();
    }
};

const main = async () => {
    const args = process.argv.slice(2);
    const result = await runRuntimeProbe({
        baseUrl: getFlagValue(args, '--base-url'),
        outputPath: getFlagValue(args, '--output'),
        port: getFlagValue(args, '--port') ? Number(getFlagValue(args, '--port')) : 4325,
        warmIterations: getFlagValue(args, '--warm-iterations') ? Number(getFlagValue(args, '--warm-iterations')) : 5,
    });
    console.log(JSON.stringify(result, null, 2));
};

if (import.meta.main) {
    await main();
}
