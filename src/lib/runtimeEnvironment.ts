import type { DatasetChannel } from './datasetPointer';

const DEFAULT_SITE = 'https://ilmtest.io';

const normalizeTrimmedValue = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

const normalizeHostname = (value: string) => {
    try {
        return new URL(`http://${value}`).hostname;
    } catch {
        return value.split(':')[0] ?? value;
    }
};

export const isDatasetChannel = (value?: string | null): value is DatasetChannel =>
    value === 'prod' || value === 'preview';

export const isProductionHost = (hostname: string) => hostname === 'ilmtest.io' || hostname === 'www.ilmtest.io';

export const normalizeSiteUrl = (value?: string | null) => {
    const trimmed = normalizeTrimmedValue(value);
    if (!trimmed) {
        return DEFAULT_SITE;
    }

    if (!/^https?:\/\//i.test(trimmed)) {
        return `https://${trimmed}`;
    }

    return trimmed;
};

export const resolveRuntimeChannel = ({
    requestUrl,
    requestHost,
    configuredChannel,
    isDev = false,
}: {
    requestUrl?: string;
    requestHost?: string | null;
    configuredChannel?: string | null;
    isDev?: boolean;
}): DatasetChannel => {
    if (isDev) {
        return 'preview';
    }

    if (isDatasetChannel(configuredChannel)) {
        return configuredChannel;
    }

    const normalizedRequestHost = normalizeTrimmedValue(requestHost);
    if (normalizedRequestHost) {
        return isProductionHost(normalizeHostname(normalizedRequestHost)) ? 'prod' : 'preview';
    }

    if (!requestUrl) {
        return 'prod';
    }

    try {
        const url = new URL(requestUrl, DEFAULT_SITE);
        return isProductionHost(url.hostname) ? 'prod' : 'preview';
    } catch {
        return 'prod';
    }
};

export const resolveDatasetVersionOverride = ({
    datasetVersionOverride,
    channel,
    isDev = false,
}: {
    datasetVersionOverride?: string | null;
    channel: DatasetChannel;
    isDev?: boolean;
}) => {
    const trimmed = normalizeTrimmedValue(datasetVersionOverride);
    if (!trimmed) {
        return undefined;
    }

    return isDev || channel === 'preview' ? trimmed : undefined;
};

export const resolvePublicOrigin = ({
    requestUrl,
    requestOrigin,
    configuredSite,
    channel,
}: {
    requestUrl?: string;
    requestOrigin?: string | null;
    configuredSite?: string | null;
    channel: DatasetChannel;
}) => {
    if (channel === 'prod') {
        return normalizeSiteUrl(configuredSite);
    }

    const normalizedRequestOrigin = normalizeTrimmedValue(requestOrigin);
    if (normalizedRequestOrigin) {
        return normalizedRequestOrigin;
    }

    if (!requestUrl) {
        return normalizeSiteUrl(configuredSite);
    }

    try {
        return new URL(requestUrl).origin;
    } catch {
        return normalizeSiteUrl(configuredSite);
    }
};

export const resolveDefaultRobotsPolicy = (channel: DatasetChannel) => (channel === 'prod' ? 'allow' : 'disallow');

export const resolveRequestOrigin = (request: Request) => {
    const forwardedHost = normalizeTrimmedValue(request.headers.get('x-forwarded-host'));
    const host = forwardedHost ?? normalizeTrimmedValue(request.headers.get('host'));
    if (host) {
        const protocol =
            normalizeTrimmedValue(request.headers.get('x-forwarded-proto')) ??
            (() => {
                try {
                    return new URL(request.url).protocol.replace(/:$/, '');
                } catch {
                    return 'https';
                }
            })();
        return `${protocol}://${host}`;
    }

    try {
        return new URL(request.url).origin;
    } catch {
        return normalizeSiteUrl();
    }
};
