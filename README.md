# IlmTest

![Astro](https://img.shields.io/badge/Astro-BC52EE?style=flat&logo=astro&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?style=flat&logo=cloudflare&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-000000?style=flat&logo=bun&logoColor=white)
[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/259f7be9-9cf1-4d32-9cfa-c17c9ae69a1a.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/259f7be9-9cf1-4d32-9cfa-c17c9ae69a1a)
[![codecov](https://codecov.io/gh/ragaeeb/ilmtest.io/graph/badge.svg?token=BAEZ6JJPHO)](https://codecov.io/gh/ragaeeb/ilmtest.io)

**Authentic Islamic content with verification and scholarly sources.**


IlmTest is a digital research tool designed to make classical Islamic texts accessible, searchable, and verifiable. It prioritizes academic rigor, providing side-by-side Arabic and English texts with precise citations linked to original sources.

## 🌟 Project Vision

IlmTest is a **digital research desk** for authentic Islamic texts. It solves the problem of unverifiable online translations by providing a rigorous, scholarly interface for comparing classical Arabic texts with their English translations.

### Core Philosophy
1.  **Trust & Verification**: Every excerpt is linked to a specific volume, page, and hadith number. "Verified" badges are strictly reserved for content with direct lineage to reputable digital libraries (e.g., Shamela).
2.  **Scholarly UX**: The interface is designed for **careful reading**, not scrolling. It minimizes distraction and treats the text with the reverence of a physical archive.
3.  **Accessibility**: We serve a global audience, including regions with limited bandwidth. Performance is an accessibility feature.

## 🏗️ Technical Architecture

We chose a **Hybrid Rendering** approach to solve the "54k Page Problem". Statically generating 54k+ excerpts exceeds practical build and deployment limits.

-   **Static Generators (SSG)**: Landing and other fixed informational pages.
-   **Server-Side Rendering (SSR)**: Browse, section, excerpt, profile, and sitemap surfaces are rendered on-demand at the edge.
-   **Edge Caching**: SSR responses are cached (stale-while-revalidate) to ensure near-static performance after the first hit.

### The Stack
-   **Framework**: [Astro 6.0](https://astro.build) (Static + SSR)
-   **Runtime**: [Cloudflare Workers](https://workers.cloudflare.com) + R2
-   **Language**: TypeScript (Strict Mode)
-   **Styling**: [Tailwind CSS 4.0](https://tailwindcss.com) + Scoped CSS Variables
-   **Package Manager**: [Bun](https://bun.sh)
-   **Performance**:
    -   font subsetting (`pyftsubset`) for Noto Naskh Arabic (~150KB -> ~45KB).
    -   Responsive font loading (Arabic content at 1.125x scale).

## ✨ Key Features

-   **Bilingual Side-by-Side**: Intelligent RTL/LTR layout that respects the directional flow of both languages.
-   **Precision Citations**: Standardized referencing format (Author, Title, Vol/Page) with deep links.
-   **Performance First**: Sub-2s First Contentful Paint (FCP) target on mobile 4G.
-   **Lightweight UI**: Preact/React islands used only for interactivity (Motion, Theme Toggle); reading views are pure HTML/CSS.


## 🧞 Commands

All commands are run from the root of the project:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `bun install`             | Installs dependencies                            |
| `bun dev`                 | Starts local dev server at `localhost:4321`      |
| `bun build`               | Build your production site to `./dist/`          |
| `bun run setup`           | Runs the ETL pipeline to generate content/data   |
| `bun run setup-fixture`   | Materialize the tiny or medium fixture corpus    |
| `bun run clean`           | Removes generated content, data, and build files |
| `bun run smoke-routes`    | Verify core routes, robots, sitemap, and 404s   |
| `bun run runtime-probe`   | Measure route timings and failure behavior       |
| `bun run create-r2-bucket`| Creates the R2 bucket (uses `R2_BUCKET`)         |
| `bun run upload-r2`       | Uploads chunks to R2                             |
| `bun run deploy`          | Build + deploy the production Worker             |
| `bun run deploy:preview`  | Build + deploy the shared preview Worker         |
| `bun run deploy-check`    | Dry-run the Worker deploy contract               |
| `bun run deploy-check:preview` | Dry-run the preview Worker deploy contract  |
| `bun run resume`          | Resume upload with skip-existing                 |

## 🔐 Environment Variables

Place these in `.env` so Bun picks them up. See `docs/deployment.md` for the full list and R2 resume options.

## 🛠️ Troubleshooting

- **Browse shows `0 excerpts`**  
  The `EXCERPT_BUCKET` binding is missing or pointing at the wrong R2 bucket.

- **Worker deploy fails**  
  Run `bun run deploy-check` after `bun run build` to verify the generated Worker bundle, asset binding, and Wrangler config before a real deploy.

- **403 Forbidden uploading to R2**  
  Ensure R2 is enabled in Cloudflare and your API token includes **Account → R2 Storage → Edit** for the correct account.

- **`wrangler r2 bucket list` fails with code 10042**  
  R2 is not enabled on the account yet. Enable it in the Cloudflare dashboard first.

## 📚 Documentation

-   [Deployment Guide](docs/deployment.md)
-   [Project Context & Agents](AGENTS.md)
