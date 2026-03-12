# IlmTest Architecture

This document outlines the high-level system architecture and data flow of IlmTest.

## ADRs

- [ADR 0001: Workers Is The Target Runtime](/Users/rhaq/workspace/ilmtest.io/docs/adr/0001-workers-runtime.md)
- [ADR 0002: Publish Immutable Datasets](/Users/rhaq/workspace/ilmtest.io/docs/adr/0002-immutable-datasets.md)
- [ADR 0003: R2 Manifest And Pointer Select The Active Dataset](/Users/rhaq/workspace/ilmtest.io/docs/adr/0003-r2-manifest-pointer.md)
- [ADR 0004: Pagefind Is The Search MVP](/Users/rhaq/workspace/ilmtest.io/docs/adr/0004-pagefind-search-mvp.md)
- [ADR 0005: D1 Backs Moderated Reports](/Users/rhaq/workspace/ilmtest.io/docs/adr/0005-d1-reports.md)
- [ADR 0006: Inline Mentions Are Deferred](/Users/rhaq/workspace/ilmtest.io/docs/adr/0006-inline-mentions-deferred.md)

## 1. System Context Diagram

High-level view of how users interact with the system and how the system is built.

```mermaid
graph TD
    %% Actors
    User([User / Reader])
    Dev([Developer])

    %% External Systems
    HF[Hugging Face\n(Raw Datasets)]
    
    %% Infrastructure
    subgraph Cloudflare["Cloudflare Platform"]
        Edge[Cloudflare Edge Network]
        Workers[Cloudflare Workers\n(SSR Runtime)]
        Pages[Cloudflare Pages\n(Static Assets)]
        R2[(R2 Storage\nContent Chunks)]
    end

    %% Application Logic
    subgraph "Build Process"
        ETL[Build Pipeline\n(scripts/)]
        Setup[setup.ts\n(Ingest & Transform)]
        Upload[uploadR2.ts\n(Distribute)]
        Astro[Astro Build\n(SSG + Server Adaptor)]
    end

    %% Relationships - Runtime
    User -->|HTTPS Request| Edge
    Edge -->|Cache Hit| User
    Edge -->|Cache Miss| Workers
    Workers -->|Fetch Chunk| R2
    Workers -->|SSR HTML| Edge

    %% Relationships - Build
    Dev -->|git push| Pages
    Pages -->|Trigger| Astro
    Setup -->|Download| HF
    Upload -->|Upload| R2
    Setup -->|Generate JSON| Astro
    ETL --- Setup
    ETL --- Upload
```

## 2. Data Flow: The "54k Page" Architecture

Detailing how raw Islamic texts become optimized, edge-cacheable content.

```mermaid
sequenceDiagram
    participant HF as HuggingFace (Source)
    participant ETL as setup.ts (Local/CI)
    participant R2 as R2 Storage (Cloud)
    participant Edge as Cloudflare Edge
    participant SSR as SSR Worker
    participant User

    Note over ETL: 1. Ingestion Phase
    ETL->>HF: Download Raw JSON/ZIP
    ETL->>ETL: Decompress & Parse
    ETL->>ETL: Handle Identity (Shamela vs Web)
    
    Note over ETL: 2. Transformation Phase
    ETL->>ETL: Compute Heading Ranges
    ETL->>ETL: Chunk Excerpts (Grouping)
    ETL->>ETL: Generate Metadata & Indexes
    
    Note over ETL: 3. Distribution Phase
    ETL->>R2: Upload Content Chunks (uploadR2.ts)
    ETL->>SSR: Embed Indexes (Build Time)
    
    Note over User: 4. Runtime Phase
    User->>Edge: Request /browse/section/123
    host->>Edge: Check Cache
    alt Cache Miss
        Edge->>SSR: Invoke Worker
        SSR->>SSR: Lookup Indexes (In-memory)
        SSR->>R2: Fetch Required Chunk (JSON)
        R2-->>SSR: Return Chunk
        SSR->>SSR: Render HTML
        SSR-->>Edge: HTML + Cache-Control
    end
    Edge-->>User: Final HTML
```

### Key Components

1.  **Build Pipeline (`scripts/`)**:
    *   **`setup.ts`**: The main transformation engine. It handles disparate source types (Shamela-formatted books and Web-scraped content), computing hierarchical heading ranges and backfilling missing data.
    *   **Data Artifacts**: Generates `indexes.json` (O(1) lookups for sections, chunks, and entities), `collections.json` (library metadata), and `translators.json`.
    *   **`uploadR2.ts`**: A high-concurrency distribution script that syncs generated content chunks to Cloudflare R2, supporting resumes and skip-existing checks.

2.  **Hybrid Rendering (Astro)**:
    *   **SSG**: Landing page, About, and static collections.
    *   **SSR**: Dynamic browse/content pages (Excerpts, Sections). This architecture scales to millions of excerpts without exploding build times or file counts.

3.  **Edge Strategy**:
    *   **Caching**: SSR responses include `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`, honored by Cloudflare Edge.
    *   **R2 Integration**: The Worker fetches granular content chunks from R2 on demand, keeping memory pressure low.

## 3. M0-M1 Dataset Control Plane

The current request path still uses bundled `src/data/*.json` plus legacy flat chunk lookups. During `M0-M1`, the repo adds a separate dataset control plane without changing live route behavior:

- `setup.ts` now emits `tmp/dataset-build/metadata.json` as the publishing input contract.
- Immutable datasets publish under `datasets/<datasetVersion>/...`.
- `channels/prod.json` and `channels/preview.json` select the active dataset manifest for the future runtime path.
- Corpus publishing, code deployment, and dataset promotion are now separate release lanes.
