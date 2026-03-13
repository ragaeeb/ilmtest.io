import { env } from 'cloudflare:workers';
import {
    resolveDefaultRobotsPolicy,
    resolvePublicOrigin,
    resolveRequestOrigin,
    resolveRuntimeChannel,
} from '@/lib/runtimeEnvironment';

export const prerender = false;

const aiCrawlerAgents = ['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'CCBot', 'PerplexityBot', 'Bytespider'];

export const GET = ({ request }: { request: Request }) => {
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
    const robotsPolicy =
        (import.meta.env.PUBLIC_ROBOTS_POLICY as string | undefined) ?? resolveDefaultRobotsPolicy(channel);
    const aiCrawlPolicy = (import.meta.env.PUBLIC_AI_CRAWL_POLICY as string | undefined) ?? robotsPolicy;
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
