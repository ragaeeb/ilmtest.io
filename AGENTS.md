# IlmTest Technical Context for AI Agents

## Project Overview
IlmTest is a digital library for authenticated Islamic texts, built with **Astro** for a hybrid rendering approach. We aim to serve ~54k excerpts efficiently while maintaining high performance and accessibility.

## 🧠 Critical Technical Context for AI Agents

Welcome, Agent. You are working on **IlmTest**, a high-performance digital library. Your code must align with strict architectural and design constraints to handle the scale (54,000+ excerpts) and the scholarly nature of the project.

### 1. The "54k Page" Architecture
We cannot statically generate all pages due to build limits.
-   **Hybrid Strategy**: Collection and section browsing pages are SSR with aggressive edge caching; excerpt pages remain SSR.
-   **Caching**: SSR pages **MUST** include `Cache-Control` headers for Cloudflare Edge.
    -   `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`
-   **Constraint**: Do not propose changing `output: 'static'` (Astro 6 default) to purely static generation for excerpts.

### 1.a Decision Rationale: SSR for Sections + Aggressive Caching
We switched section pages to SSR to avoid multi-hour builds when a collection has tens of آلاف sections (web scraped sites can have ~20k pages). With SSR + edge caching, first-hit cost is paid once per cache window; subsequent requests are served at the edge.

**Pros of SSR sections**:
- Eliminates build-time explosion from `getStaticPaths`.
- Keeps section pages fast after first hit via cache.
- Simplifies adding large scraped collections.

**Cons of SSR sections**:
- Consumes Workers invocations on first hit per cache window.
- Requires strict cache rules and bot protection to stay within free tier.

**Alternatives considered**:
- **Static sections (SSG)**: Zero Worker cost, but build time scales with section count and becomes untenable at 20k+ sections.
- **Static with precomputed section summaries**: Faster than full scans but still generates thousands of pages and grows linearly with data size.

**Why this is the best compromise**:
SSR + cache gives acceptable runtime performance while keeping build times bounded. Combined with Cloudflare cache rules and bot protections, it preserves free-tier viability without sacrificing scalability.

### 2. Data Strategy & Chunking
To avoid loading multi-megabyte JSON files:
-   **Chunks**: Excerpts are split into chunks stored in R2; local builds write to `tmp/excerpt-chunks/`.
-   **Indexes**: We use usage-optimized O(1) lookups generated at build time (`src/data/indexes.json`).
    -   `sectionToExcerpts`: Maps a Section ID to a list of Excerpt IDs.
    -   Always prefer O(1) Lookups over array `.find()` scanning.

### 3. Design System & Accessibility (RTL)
-   **Typography**:
    -   **Content**: `Noto Naskh Arabic` (scaled 1.125x).
    -   **UI**: `IBM Plex Sans Arabic`.
    -   **English**: System fonts.
-   **Bilingual Rules**:
    -   Always use `dir="rtl"` and `lang="ar"` for Arabic text containers.
    -   **NEVER** use italics for Arabic text (it renders poorly).
    -   Use the `BilingualText` component to handle layout direction automatically.
-   **Colors**:
    -   Primary: `#309fd6` (Blue).
    -   Secondary: `#e9692c` (Orange).
    -   **WCAG**: Ensure high contrast. Do not use Brand Green for standard text; use semantic Success Green.

### 4. Citation Logic
Citations are the project's source of truth.
-   **Format**: `[Author, Title #Num](URL)` or `[Author, Title Vol/Page](URL)`.
-   **Data Structure**: Discriminated Union in TS (`CitationMeta`).
    -   `| { type: 'hadith'; num: string }`
    -   `| { type: 'book'; vol: number; page?: number }`
-   **UX**: Citations must be visible, linked, and mostly monospace.

### 5. Do's and Don'ts
-   **DO** use **Preact** or **React** only for isolated interactive islands (Search, Toggle).
-   **DON'T** add heavyweight client-side JS to reading pages.
-   **DO** use Scoped CSS Variables (`var(--color-primary)`) over hardcoded hex values.
-   **DON'T** suggest removing `pyftsubset`; font performance is critical for our mobile users.

### 6. Tone & Voice (Critical)
-   **Neutral**: No opinions, no polemics.
-   **Scholarly**: Precise language. Use "Translation" vs "Original", not "Verses".
-   **Trust**: Emphasize verification.
-   **Format**: Citations are `[Author, Title Vol/Page](URL)`, never hidden in tooltips.

### 7. Scope Boundaries (MVP)
-   ❌ **No User Auth**: Do not suggest login/signup features.
-   ✅ **Search (M5)**: Pagefind-based search is implemented and allowed.
-   ❌ **No Semantic Search**: Defer embeddings/vector dbs.

## ⚙️ The Data Pipeline (`scripts/setup.ts`)

The project uses a custom ETL pipeline to transform raw JSON/HTML data into the optimized chunks used by the Astro app.

### Pipeline Flow

```mermaid
graph TD
    A[Start setup.ts] --> B[Download Raw Data]
    B -->|HuggingFace| C[Raw JSON/Zip]
    C --> D[Load Collections & Excerpts]
    
    subgraph Transformation
    D --> E[Compute Heading Ranges]
    E --> F[Generate Indexes O(1)]
    E --> G[Chunk Excerpts]
    end
    
    subgraph Output
    F --> H[src/data/indexes.json]
    G --> I[tmp/excerpt-chunks/**]
    D --> J[src/data/collections.json]
    end
```

### Key Logic Steps

1.  **Ingestion**:
    -   Downloads compressed JSON datasets from HuggingFace (authenticating with `HF_TOKEN`).
    -   Loads `collection` metadata (authors, titles, source linkage).

2.  **Heading Range Computation**:
    -   Maps hierarchical Tables of Contents (Shamela) to flat lists of Excerpts.
    -   Determines start/end indices for each chapter to enable O(1) access.

3.  **Indexing (O(1) Lookups)**:
    -   `sectionToExcerpts`: Maps Section ID -> List of Excerpt IDs.
    -   `excerptToSection`: Reverse lookup.
    -   `pageToHeading`: Deep linking from physical page numbers.

4.  **Chunking**:
    -   Splits excerpts into JSON files written to `tmp/excerpt-chunks/` and uploaded to R2.
    -   Enables granular SSR loading without parsing massive files.






## Generating Code Packet for Review

To generate a full codebase dump for an AI review session, run the following command from the project root:

```bash
bun run gen-packet
```

**Note**: Use `bun run clean` if you need to remove old generated data, content chunks, or build artifacts before a fresh start or a new packet generation.

### Maintenance Note: Keeping Context High-Signal
As the codebase grows, providing the entire repository to an AI agent becomes counter-productive ("Context Drift"). We must prioritize **Signal over Noise**.

**What to Include (Signal):**
-   **Source Logic**: `src/**/*.ts`, `src/**/*.astro`, `src/**/*.tsx`.
-   **Core Scripts**: Only the logic driving the build/data pipeline (e.g., `setup.ts`, `mapping.ts`).
-   **Config**: `astro.config.mjs`, `package.json`, `tsconfig.json`.

**What to Exclude (Noise):**
-   ❌ **Generated Data**: `src/data/*.json`, `src/content/**/*.json`. (Use Type Definitions instead).
-   ❌ **Assets**: Images, Fonts, Build artifacts (`dist/`).
-   ❌ **Lockfiles**: `bun.lockb`.
-   ❌ **Tests**: `**/*.test.ts` (Unless specifically debugging a test).
-   ❌ **Historical Docs**: Old phase plans or outdated specs.

**To modify the packet instructions**, update the `gen-packet` script in `package.json`.


This will create `code_packet.txt`, which you can attach to the prompt in `docs/AI_AGENT_REVIEW_PROMPT.md`.
