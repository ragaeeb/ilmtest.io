import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const optimizeDeps = {
    entries: [],
    exclude: ['audit', 'xray'],
    include: [],
    noDiscovery: true,
};

const disableServerDepScanPlugin = {
    name: 'ilmtest:disable-server-dep-scan',
    enforce: 'post',
    configEnvironment(environmentName) {
        if (!['astro', 'ssr', 'prerender'].includes(environmentName)) {
            return;
        }

        return {
            optimizeDeps,
        };
    },
};

export default defineConfig({
    // Static by default; use `export const prerender = false` on specific routes for SSR
    output: 'static',

    adapter: cloudflare({
        imageService: 'passthrough',
        inspectorPort: false,
    }),

    integrations: [
        // React for interactive islands (Motion animations, theme toggle, share button)
        react(),
    ],

    site: 'https://ilmtest.io',

    vite: {
        environments: {
            astro: {
                optimizeDeps,
            },
            ssr: {
                optimizeDeps,
            },
            prerender: {
                optimizeDeps,
            },
        },
        optimizeDeps,
        plugins: [tailwindcss(), disableServerDepScanPlugin],
        build: {
            rollupOptions: {
                external: ['/pagefind/pagefind.js'],
            },
        },
    },

    build: {
        client: './client',
        format: 'file',
        server: './functions',
    },

    experimental: {
        // Enable if needed for content collections
    },
});
