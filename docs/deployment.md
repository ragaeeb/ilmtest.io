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
