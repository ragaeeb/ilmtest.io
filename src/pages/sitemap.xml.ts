import { env } from 'cloudflare:workers';
import { loadSitemapCollectionData } from '@/lib/data';
import { resolvePublicOrigin, resolveRequestOrigin, resolveRuntimeChannel } from '@/lib/runtimeEnvironment';
import { isRuntimeDataError } from '@/lib/runtimeErrors';

export const prerender = false;

export const GET = async ({ request }: { request: Request }) => {
    try {
        const channel = resolveRuntimeChannel({
            requestUrl: request.url,
            requestHost: request.headers.get('host'),
            configuredChannel: env.ILMTEST_RUNTIME_CHANNEL,
            isDev: import.meta.env.DEV,
        });
        const site = resolvePublicOrigin({
            requestUrl: request.url,
            requestOrigin: resolveRequestOrigin(request),
            configuredSite: import.meta.env.SITE,
            channel,
        });
        const buildUrl = (path: string) => new URL(path, site).toString();
        const collections = await loadSitemapCollectionData(request.url);
        const staticPaths = ['/', '/about', '/browse', '/privacy', '/terms'];
        const urls: string[] = staticPaths.map((path) => buildUrl(path));

        for (const item of collections) {
            urls.push(buildUrl(`/browse/${item.collection.slug}`));
            for (const sectionId of item.sectionIds) {
                urls.push(buildUrl(`/browse/${item.collection.slug}/${sectionId}`));
            }
        }

        const now = new Date().toISOString();
        const body = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            ...urls.map((url) => `  <url><loc>${url}</loc><lastmod>${now}</lastmod></url>`),
            '</urlset>',
            '',
        ].join('\n');

        return new Response(body, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
                'CDN-Cache-Control': 'max-age=3600',
            },
        });
    } catch (error) {
        if (!isRuntimeDataError(error)) {
            throw error;
        }

        return new Response('Service temporarily unavailable', {
            status: error.statusCode,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-store',
                'CDN-Cache-Control': 'no-store',
            },
        });
    }
};
