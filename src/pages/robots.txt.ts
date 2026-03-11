const site = import.meta.env.SITE ?? 'https://ilmtest.io';

export const GET = () => {
    const body = ['User-agent: *', 'Allow: /', `Sitemap: ${new URL('/sitemap.xml', site).toString()}`, ''].join('\n');

    return new Response(body, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
        },
    });
};
