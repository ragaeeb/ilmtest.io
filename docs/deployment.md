# Deploying IlmTest to Cloudflare Pages

This guide outlines the steps to deploy the IlmTest Astro application to Cloudflare Pages.

## Prerequisites

1.  **Cloudflare Account**: You need an active Cloudflare account.
2.  **Git Repository**: The project code must be pushed to a Git provider (GitHub or GitLab).
3.  **IlmTest Domain**: You already own `ilmtest.io` and it should be active in your Cloudflare account.

## Step-by-Step Deployment

### 1. Connect Git Repository to Cloudflare Pages

1.  Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2.  Navigate to **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
3.  Select your Git provider (e.g., GitHub) and authorize Cloudflare if needed.
4.  Select the **ilmtest.io** repository from the list.
5.  Click **Begin setup**.

### 2. Configure Build Settings

Cloudflare should automatically detect the Astro framework, but verify the following settings:

-   **Project Name**: `ilmtest` (or your preferred project name)
-   **Production Branch**: `main` (or `master`)
-   **Framework Preset**: `Astro`
-   **Build Command**: `npm run build`
-   **Build Output Directory**: `dist`
-   **Node.js Version**: Ensure the environment uses a compatible Node.js version. Cloudflare Pages usually defaults to a recent LTS, but you can specify `NODE_VERSION` variable if needed (e.g., `20.x` or higher).

### 3. Environment Variables

If your application requires any environment variables, add them in the **Environment variables** section during setup or later in the project settings.

### 4. Deploy

1.  Click **Save and Deploy**.
2.  Cloudflare will clone your repository, install dependencies, build the site, and deploy it to a `*.pages.dev` subdomain.

### 5. Custom Domain Setup

Once the deployment is successful:

1.  Go to your Pages project settings.
2.  Click on the **Custom domains** tab.
3.  Click **Set up a custom domain**.
4.  Enter `ilmtest.io` (and optionally `www.ilmtest.io`).
5.  Cloudflare will automatically configure the DNS records since the domain is managed by Cloudflare.

## Post-Deployment Verification

1.  Visit `https://ilmtest.io`.
2.  Verify that all pages load correctly (Landing, About, Browse, Excerpts).
3.  Check that the specific font subsets (Arabic) are loading.
4.  Test navigation between pages.

## Updates

Any new commits pushed to the `main` branch will automatically trigger a new deployment. You can monitor build status in the Cloudflare Pages dashboard.
