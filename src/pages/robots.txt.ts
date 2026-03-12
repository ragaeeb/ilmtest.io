const normalizeSite = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed) {
        return 'https://ilmtest.io';
    }
    if (!/^https?:\/\//i.test(trimmed)) {
        return `https://${trimmed}`;
    }
    return trimmed;
};

const site = normalizeSite(import.meta.env.SITE);
const host = new URL(site).hostname;
const robotsPolicy =
    (import.meta.env.PUBLIC_ROBOTS_POLICY as string | undefined) ??
    (host === 'ilmtest.io' || host === 'www.ilmtest.io' ? 'allow' : 'disallow');
const aiCrawlPolicy = (import.meta.env.PUBLIC_AI_CRAWL_POLICY as string | undefined) ?? robotsPolicy;
const aiCrawlerAgents = ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'CCBot', 'PerplexityBot', 'Bytespider'];

export const GET = () => {
    const bodyLines: string[] = [];

    if (robotsPolicy === 'allow') {
        bodyLines.push('User-agent: *', 'Allow: /', `Sitemap: ${new URL('/sitemap.xml', site).toString()}`, '');
    } else {
        bodyLines.push('User-agent: *', 'Disallow: /', '');
    }

    if (robotsPolicy === 'allow' && aiCrawlPolicy === 'disallow') {
        for (const agent of aiCrawlerAgents) {
            bodyLines.push(`User-agent: ${agent}`, 'Disallow: /', '');
        }
    }

    return new Response(bodyLines.join('\n'), {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
        },
    });
};
