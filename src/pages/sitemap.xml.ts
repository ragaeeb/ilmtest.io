import collectionsData from '@/data/collections.json';
import indexesData from '@/data/indexes.json';
import type { Collection } from '@/types/excerpts';

const site = import.meta.env.SITE ?? 'https://ilmtest.io';

const getCollections = (): Collection[] => {
    if (Array.isArray(collectionsData)) {
        return collectionsData as Collection[];
    }
    return (collectionsData as { collections?: Collection[] }).collections ?? [];
};

const buildUrl = (path: string) => new URL(path, site).toString();

export const GET = () => {
    const indexes = indexesData as Record<string, any>;
    const collections = getCollections();
    const staticPaths = ['/', '/about', '/browse', '/privacy', '/terms'];
    const urls: string[] = staticPaths.map((path) => buildUrl(path));

    for (const collection of collections) {
        urls.push(buildUrl(`/browse/${collection.slug}`));
        const sections = (indexes.collectionToSections?.[collection.id] || []) as string[];
        for (const sectionId of sections) {
            urls.push(buildUrl(`/browse/${collection.slug}/${sectionId}`));
        }
    }

    const now = new Date().toISOString();
    const body = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...urls.map(
            (url) => `  <url><loc>${url}</loc><lastmod>${now}</lastmod></url>`,
        ),
        '</urlset>',
        '',
    ].join('\n');

    return new Response(body, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
        },
    });
};
