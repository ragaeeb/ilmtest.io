import { isDatasetChannel } from '../src/lib/datasetPointer';
import { getFlagValue } from './cliUtils';
import { validateLocalDataset, validateRemoteDataset } from './datasetControl';
import { getStore } from './storeFactory';

const main = async () => {
    const [mode = 'local', ...args] = process.argv.slice(2);

    if (mode === 'local') {
        const result = await validateLocalDataset(
            getFlagValue(args, '--build-metadata'),
            getFlagValue(args, '--dataset-version'),
        );
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (mode === 'remote') {
        const channelArg = getFlagValue(args, '--channel');
        const datasetVersion = getFlagValue(args, '--dataset-version');
        if (channelArg && !isDatasetChannel(channelArg)) {
            throw new Error('remote validation requires --channel <prod|preview> when channel is provided');
        }
        const channel = channelArg as 'prod' | 'preview' | undefined;
        if (!channel && !datasetVersion) {
            throw new Error('remote validation requires either --channel or --dataset-version');
        }

        const result = await validateRemoteDataset(getStore(), {
            channel,
            datasetVersion,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    throw new Error(`Unknown validation mode: ${mode}`);
};

await main();
