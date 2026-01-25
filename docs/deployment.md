# Deploying IlmTest to Cloudflare Pages

This guide outlines the steps to deploy the IlmTest Astro application to Cloudflare Pages.

## Prerequisites

1.  **Cloudflare Account**: You need an active Cloudflare account.
2.  **Domain**: You already own `ilmtest.io` and it should be active in your Cloudflare account.
3.  **Runtime**:
    - **Bun**: `>=1.3.6`
    - **Node**: `>=25.0.0`
4.  **Repository (for CI deploys)**: The project code must be pushed to a Git provider (GitHub or GitLab).

## Build output

- **Build command**: `bun run build`
- **Build output directory**: `dist`
- **Helper scripts**:
  - `bun run upload-r2` (bulk upload chunks to R2)
  - `bun run resume` (resume upload with skip-existing)
  - `bun run deploy` (build → upload chunks → deploy Pages)
  - `bun run create-r2-bucket` (creates R2 bucket)

## Option A: Deploy from your machine (Direct Upload)

This path uploads the built `dist` folder directly from your local machine using Wrangler.

### 1. Install Wrangler (local)

```bash
bun add -g wrangler
```

### 2. Authenticate

```bash
wrangler login
```

### 3. Build locally

```bash
bun install

# If you need to regenerate data first:
# bun run setup 1118 2576

bun run build
```

### 4. Create a Pages project (once)

```bash
wrangler pages project create ilmtest
```

### 5. Deploy

```bash
wrangler pages deploy dist --project-name ilmtest
```

> Tip: If you are using R2, you can use `bun run deploy` once `R2_BUCKET` and `PAGES_PROJECT` are set.

> **Note:** Direct Upload projects cannot be converted to Git-based deployments later. If you want CI, prefer Option B.

## Option B: Deploy via CI (Git Integration)

### 1. Connect Git Repository to Cloudflare Pages

1.  Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2.  Navigate to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3.  Select your Git provider (e.g., GitHub) and authorize Cloudflare if needed.
4.  Select the **ilmtest.io** repository from the list.
5.  Click **Begin setup**.

### 2. Configure Build Settings

Cloudflare should detect Astro, but set the following explicitly:

- **Project Name**: `ilmtest` (or your preferred project name)
- **Production Branch**: `main` (or your default branch)
- **Framework Preset**: `Astro`
- **Build Command**: `bun run build`
- **Build Output Directory**: `dist`
- **Node.js Version**: set `NODE_VERSION=25.0.0` (or higher)

### 3. Environment Variables

Add any required environment variables in **Project Settings → Environment Variables**.

### 4. Deploy

1.  Click **Save and Deploy**.
2.  Cloudflare will clone your repository, install dependencies, build the site, and deploy it to a `*.pages.dev` subdomain.

## Custom Domain Setup

Once the deployment is successful:

1.  Go to your Pages project settings.
2.  Click on the **Custom domains** tab.
3.  Click **Set up a custom domain**.
4.  Enter `ilmtest.io` (and optionally `www.ilmtest.io`).
5.  Cloudflare will automatically configure the DNS records since the domain is managed by Cloudflare.

## Cache Rules (Required for SSR Browse Pages)

To keep Worker usage low on the free tier, add a Cache Rule that **caches HTML** for `/browse/*`:

1.  Cloudflare Dashboard → **Rules** → **Cache Rules** → **Create rule**.
2.  **If**: `URI Path` **starts with** `/browse/`.
3.  **Then**: **Cache eligibility** → **Cache everything**.
4.  **Cache TTL**: **Respect existing headers**.

This ensures the `Cache-Control` headers set by SSR routes are honored at the edge.

### Cache Verification Checklist

After deployment, confirm caching is working:

1.  Cloudflare Dashboard → **Analytics** → **Caching**.
2.  Filter by `/browse/` paths and confirm cache **HIT** rates are rising.
3.  Use DevTools on a `/browse/...` page and verify response headers include:
    - `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`
    - `CF-Cache-Status: HIT` (after the first request)

## Bot Protection (Recommended)

To prevent crawlers from exhausting the free tier:

1.  Cloudflare Dashboard → **Security** → **Bots**.
2.  Enable **Bot Fight Mode** (or **Super Bot Fight Mode** if available).
3.  Add **WAF/Rate limiting** rule for `/browse/*` (e.g., limit requests per minute per IP).
4.  Optionally block known AI crawlers via **User-Agent** rules if needed.

## Long-term: R2 Migration Path (Recommended for Scale)

When file counts exceed Pages limits, move `excerpt-chunks` to R2:

1.  **Create an R2 bucket** in Cloudflare.
2.  **Upload chunks to R2** (from `tmp/excerpt-chunks/`).
    - `R2_BUCKET=<bucket-name> bun run upload-r2`
    - To resume after an interruption: `bun run resume`
3.  **Create the bucket** (if not already created):
    - `R2_BUCKET=<bucket-name> bun run create-r2-bucket`
4.  **Configure R2 binding** in Pages project settings:
    - Binding name: `EXCERPT_BUCKET`
5.  **Update runtime fetches** to read chunk JSON from R2 instead of local files.
4.  **Keep cache headers** on SSR routes so `/browse/*` and excerpt pages stay cached.
5.  **Purge cache only when needed** (e.g., if a collection changes).

This removes the Pages 20,000-file limit and lets the library scale without redeploy pressure.

## Data Size Optimizations

To reduce storage and transfer costs:

1.  **Minify chunk JSON** (remove whitespace) when writing chunk files.
2.  **Increase chunk size** (fewer files, fewer metadata lookups).
3.  **Rely on Cloudflare compression** (Brotli/Gzip for responses).
4.  **Optional**: Precompress `.json.br` and serve with `Content-Encoding: br` if needed.
5.  **Optional**: Compact JSON schemas (arrays instead of objects) for larger gains.

## DNS Cutover from Vercel

If the domain is currently pointed to Vercel, update DNS in Cloudflare:

1.  Remove or replace existing Vercel records (commonly `A`/`CNAME` pointing to Vercel).
2.  Ensure the Pages-generated records exist:
    - Apex (`ilmtest.io`) uses Cloudflare CNAME flattening.
    - `www` (optional) should be a CNAME to your `*.pages.dev` URL.
3.  Wait for DNS propagation and verify `https://ilmtest.io` serves the Pages deployment.

## Post-Deployment Verification

1.  Visit `https://ilmtest.io`.
2.  Verify that all pages load correctly (Landing, About, Browse, Excerpts).
3.  Check that the specific font subsets (Arabic) are loading.
4.  Test navigation between pages.

## Updates

Any new commits pushed to the `main` branch will automatically trigger a new deployment when using Git integration. You can monitor build status in the Cloudflare Pages dashboard.

## R2 Upload Helpers

The upload script supports resume, dry runs, and sanity checks to avoid re-uploading chunks.

### Common commands

- `bun run upload-r2` — upload all chunks
- `bun run resume` — resume upload with skip-existing and `R2_REMOTE=1`

### Dry run and confirmation

Use these when you want to validate configuration before uploading:

```bash
# Print sanity check and exit
R2_DRY_RUN=1 bun run resume

# Require confirmation before uploading
R2_REQUIRE_CONFIRM=1 R2_CONFIRM=1 bun run resume
```

### Environment variables (local uploads)

Place these in `.env` for local runs:

- `CLOUDFLARE_API_TOKEN` — API token with R2 edit permission
- `R2_BUCKET` — R2 bucket name (e.g., `ilmtest-excerpts`)
- `R2_CONCURRENCY` — Upload parallelism (default: `8`)
- `PAGES_PROJECT` — Pages project name (e.g., `ilmtest`)

### Optional R2 list config (skip-existing)

Skip-existing uses Bun’s S3 list API. Provide either:

- `R2_ENDPOINT` **or** `R2_ACCOUNT_ID`/`CF_ACCOUNT_ID`

If you prefer explicit S3 credentials, set:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

### Retry behavior

- `R2_RETRY_429` — number of retries when a `429`/`TooManyRequests` is detected (default: `3`)
- `R2_PROGRESS_EVERY` — progress log interval in processed items (default: `50`)
