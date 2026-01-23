import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
    // Static by default; use `export const prerender = false` on specific routes for SSR
    output: 'static',

    adapter: cloudflare({
        imageService: 'passthrough',
    }),

    integrations: [
        // React for interactive islands (Motion animations, theme toggle, share button)
        react(),
        tailwindcss({
            applyBaseStyles: false,
        }),
    ],

    site: 'https://ilmtest.io',

    vite: {
        // Vite 7 compatibility
    },

    build: {
        format: 'file',
    },

    experimental: {
        // Enable if needed for content collections
    },
});
