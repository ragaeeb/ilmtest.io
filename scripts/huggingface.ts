type DownloadOptions = {
    authToken: string;
    revision?: string;
};

export const downloadDataSet = async (dataset: string, filePath: string, options: DownloadOptions) => {
    const url = `https://huggingface.co/datasets/${dataset}/resolve/${options.revision || 'main'}/${filePath}`;
    console.debug('Download from', url);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${options.authToken}` } });

    if (!response.ok) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();

    return buffer;
};
