import { isDatasetChannel } from '../src/lib/datasetPointer';
import { getFlagValue } from './cliUtils';
import { promoteDataset, pruneDatasets, publishDataset, rollbackDataset } from './datasetControl';
import { getStore } from './storeFactory';

const parseMaxConcurrency = (args: string[]) => {
    const raw = getFlagValue(args, '--max-concurrency');
    if (!raw) {
        return undefined;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--max-concurrency must be a positive integer');
    }

    return parsed;
};

const main = async () => {
    const [command, ...args] = process.argv.slice(2);
    if (!command) {
        throw new Error('Usage: bun scripts/publishDataset.ts <publish|promote|rollback|prune> [options]');
    }

    const store = getStore();

    switch (command) {
        case 'publish': {
            const result = await publishDataset(store, {
                datasetVersion: getFlagValue(args, '--dataset-version'),
                buildMetadataPath: getFlagValue(args, '--build-metadata'),
                stateDir: getFlagValue(args, '--state-dir'),
                maxConcurrency: parseMaxConcurrency(args),
            });
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        case 'promote':
        case 'rollback': {
            const channel = getFlagValue(args, '--channel');
            const datasetVersion = getFlagValue(args, '--dataset-version');
            if (!channel || !isDatasetChannel(channel)) {
                throw new Error('promote/rollback requires --channel <prod|preview>');
            }
            if (!datasetVersion) {
                throw new Error('promote/rollback requires --dataset-version <value>');
            }

            const payload = {
                channel,
                datasetVersion,
                notes: getFlagValue(args, '--notes'),
            };
            const result =
                command === 'promote' ? await promoteDataset(store, payload) : await rollbackDataset(store, payload);
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        case 'prune': {
            const result = await pruneDatasets(store);
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        default:
            throw new Error(`Unknown command: ${command}`);
    }
};

await main();
