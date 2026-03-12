# Cloudflare Security Baseline

This is the `M2` baseline. It is intentionally simple and Cloudflare-first.

## Robots Policy

- Production indexing should be explicit.
- Preview environments should default to `Disallow: /`.
- The app supports `PUBLIC_ROBOTS_POLICY=allow|disallow`.
- AI crawler posture is separate via `PUBLIC_AI_CRAWL_POLICY=allow|disallow`.

If those env vars are unset, the current default is:

- `allow` for `ilmtest.io` and `www.ilmtest.io`
- `disallow` for every other host

## Bot Control Posture

- enable Cloudflare Bot Fight Mode or equivalent managed bot protection on preview and production
- challenge obvious abusive traffic before it reaches Workers
- treat XML, search, and future write endpoints as separate rule targets

## AI Crawl Control Posture

- preview: disallow AI crawlers
- production: explicit choice through `PUBLIC_AI_CRAWL_POLICY`
- document any future allowlist instead of silently opening all bots

## Rate-Limit Templates

Prepare Cloudflare rules for future dynamic endpoints:

- reports submit endpoint: low burst, low sustained rate, Turnstile required
- search endpoint if server-side fallback ever exists: moderate burst, challenge on anomaly
- authentication is out of scope for MVP and should not be preconfigured here

## Minimum Managed Controls

- WAF managed rules enabled
- bot score visible in request logs
- preview and production environments separated
- secrets scoped per environment
- promotion commands restricted to maintainers
