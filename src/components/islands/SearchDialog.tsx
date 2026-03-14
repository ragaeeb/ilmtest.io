/**
 * SearchDialog — lazily loaded React island for Pagefind search.
 *
 * Design constraints (from revised-plan.md M5):
 *   - Must NOT ship JS or index bootstrap on ordinary reading routes
 *   - Cold search UI bootstrap target: <= 250 KB compressed
 *   - Cold first-query payload target: <= 1 MB compressed
 *   - First result target: <= 1.5s on throttled mobile 4G for gold queries
 *   - Supports: site-wide, collection filter, section filter
 *   - Defers: backend search, semantic search, advanced query syntax
 */
// biome-ignore lint/style/noRestrictedImports: React island performance requires memoization for debounced functions
import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PagefindResult = {
    id: string;
    data: () => Promise<PagefindResultData>;
};

type PagefindResultData = {
    url: string;
    excerpt: string;
    meta: {
        title?: string;
        collectionTitle?: string;
        collectionSlug?: string;
        sectionTitle?: string;
        authorName?: string;
    };
    filters: Record<string, string[]>;
};

type PagefindSearchResponse = {
    results: PagefindResult[];
    filters?: Record<string, Record<string, number>>;
};

type PagefindAPI = {
    init: () => Promise<void>;
    search: (
        query: string,
        options?: { filters?: Record<string, string | string[]> },
    ) => Promise<PagefindSearchResponse>;
    filters: () => Promise<Record<string, Record<string, number>>>;
    debouncedSearch: (
        query: string,
        options?: { filters?: Record<string, string | string[]> },
        debounceMs?: number,
    ) => Promise<PagefindSearchResponse | null>;
    options: (opts: Record<string, unknown>) => Promise<void>;
    destroy: () => Promise<void>;
};

type LoadedResult = PagefindResultData & { id: string };

type SearchState = {
    query: string;
    results: LoadedResult[];
    resultCount: number;
    isLoading: boolean;
    isInitialized: boolean;
    error: string | null;
    availableFilters: Record<string, Record<string, number>>;
    activeCollectionFilter: string | null;
    activeSectionFilter: string | null;
};

// ---------------------------------------------------------------------------
// Styles (inline to keep the island self-contained)
// ---------------------------------------------------------------------------

const styles = {
    overlay: {
        position: 'fixed' as const,
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '10vh',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
    },
    dialog: {
        width: '100%',
        maxWidth: 640,
        maxHeight: '70vh',
        margin: '0 16px',
        backgroundColor: 'var(--color-background, #fff)',
        borderRadius: 12,
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'hidden',
        border: '1px solid var(--color-border, #e5e7eb)',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '16px 20px',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
    },
    searchIcon: {
        flexShrink: 0,
        color: 'var(--color-text-secondary, #6b7280)',
    },
    input: {
        flex: 1,
        border: 'none',
        outline: 'none',
        fontSize: 16,
        backgroundColor: 'transparent',
        color: 'var(--color-text-primary, #111827)',
        fontFamily: 'inherit',
    },
    closeButton: {
        flexShrink: 0,
        padding: '4px 8px',
        border: 'none',
        borderRadius: 6,
        backgroundColor: 'var(--color-surface, #f3f4f6)',
        color: 'var(--color-text-secondary, #6b7280)',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'monospace',
    },
    filters: {
        display: 'flex',
        gap: 6,
        padding: '8px 20px',
        overflowX: 'auto' as const,
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
        flexShrink: 0,
    },
    filterChip: (active: boolean) => ({
        padding: '4px 12px',
        border: `1px solid ${active ? 'var(--color-primary, #309fd6)' : 'var(--color-border, #e5e7eb)'}`,
        borderRadius: 16,
        backgroundColor: active ? 'var(--color-primary, #309fd6)' : 'transparent',
        color: active ? '#fff' : 'var(--color-text-secondary, #6b7280)',
        cursor: 'pointer',
        fontSize: 13,
        whiteSpace: 'nowrap' as const,
        transition: 'all 150ms ease',
    }),
    sectionFilterRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 20px 12px',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
    },
    sectionFilterLabel: {
        fontSize: 12,
        color: 'var(--color-text-secondary, #6b7280)',
        whiteSpace: 'nowrap' as const,
    },
    sectionSelect: {
        flex: 1,
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--color-border, #e5e7eb)',
        backgroundColor: 'var(--color-surface, #f3f4f6)',
        color: 'var(--color-text-primary, #111827)',
        fontSize: 13,
        fontFamily: 'inherit',
    },
    resultsList: {
        flex: 1,
        overflowY: 'auto' as const,
        padding: '8px 0',
    },
    resultItem: {
        display: 'block',
        padding: '12px 20px',
        textDecoration: 'none',
        color: 'inherit',
        borderBottom: '1px solid var(--color-border, #e5e7eb)',
        transition: 'background-color 150ms ease',
        cursor: 'pointer',
    },
    resultTitle: {
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--color-text-primary, #111827)',
        marginBottom: 4,
        lineHeight: 1.3,
    },
    resultMeta: {
        fontSize: 12,
        color: 'var(--color-primary, #309fd6)',
        marginBottom: 6,
    },
    resultExcerpt: {
        fontSize: 13,
        color: 'var(--color-text-secondary, #6b7280)',
        lineHeight: 1.5,
        display: '-webkit-box' as const,
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical' as const,
        overflow: 'hidden',
    },
    footer: {
        padding: '10px 20px',
        borderTop: '1px solid var(--color-border, #e5e7eb)',
        fontSize: 12,
        color: 'var(--color-text-secondary, #6b7280)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    emptyState: {
        padding: '48px 20px',
        textAlign: 'center' as const,
        color: 'var(--color-text-secondary, #6b7280)',
    },
    emptyIcon: {
        fontSize: 48,
        marginBottom: 12,
    },
    emptyTitle: {
        fontSize: 16,
        fontWeight: 600,
        color: 'var(--color-text-primary, #111827)',
        marginBottom: 4,
    },
    emptyDesc: {
        fontSize: 14,
    },
    loadingState: {
        padding: '48px 20px',
        textAlign: 'center' as const,
        color: 'var(--color-text-secondary, #6b7280)',
    },
    spinner: {
        display: 'inline-block',
        width: 24,
        height: 24,
        border: '3px solid var(--color-border, #e5e7eb)',
        borderTopColor: 'var(--color-primary, #309fd6)',
        borderRadius: '50%',
        animation: 'searchSpin 600ms linear infinite',
        marginBottom: 12,
    },
    kbd: {
        padding: '2px 6px',
        borderRadius: 4,
        backgroundColor: 'var(--color-surface, #f3f4f6)',
        border: '1px solid var(--color-border, #e5e7eb)',
        fontSize: 11,
        fontFamily: 'monospace',
    },
} as const;

const SECTION_FILTER_SEPARATOR = '::';

const parseSectionFilterValue = (value: string) => {
    const parts = value.split(SECTION_FILTER_SEPARATOR).map((segment) => {
        try {
            return decodeURIComponent(segment);
        } catch {
            return segment;
        }
    });

    const [collectionSlug, sectionId, sectionTitle] = parts;

    return {
        collectionSlug: collectionSlug ?? '',
        sectionId: sectionId ?? value,
        sectionTitle: sectionTitle ?? sectionId ?? value,
    };
};

// ---------------------------------------------------------------------------
// Search icon SVG
// ---------------------------------------------------------------------------

function SearchIcon({ size = 20 }: { size?: number }) {
    return (
        <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
        </svg>
    );
}

// ---------------------------------------------------------------------------
// Results per page
// ---------------------------------------------------------------------------

const RESULTS_PER_PAGE = 8;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: search island packs UI + handlers in one component
export function SearchDialog() {
    const [isOpen, setIsOpen] = useState(false);
    const [state, setState] = useState<SearchState>({
        query: '',
        results: [],
        resultCount: 0,
        isLoading: false,
        isInitialized: false,
        error: null,
        availableFilters: {},
        activeCollectionFilter: null,
        activeSectionFilter: null,
    });

    const pagefindRef = useRef<PagefindAPI | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const queuedQueryRef = useRef<{
        query: string;
        collectionFilter: string | null;
        sectionFilter: string | null;
    } | null>(null);
    const requestIdRef = useRef(0);
    const initTokenRef = useRef(0);

    const buildFilters = useCallback((collectionFilter: string | null, sectionFilter: string | null) => {
        const filters: Record<string, string | string[]> = {};
        if (collectionFilter) {
            filters.collection = collectionFilter;
        }
        if (sectionFilter) {
            filters.section = sectionFilter;
        }
        return Object.keys(filters).length > 0 ? filters : undefined;
    }, []);

    const loadSearchResults = useCallback(async (search: PagefindSearchResponse) => {
        return await Promise.all(
            search.results.slice(0, RESULTS_PER_PAGE).map(async (result) => {
                const data = await result.data();
                return { ...data, id: result.id };
            }),
        );
    }, []);

    const clearResults = useCallback(() => {
        setState((prev) => ({
            ...prev,
            results: [],
            resultCount: 0,
            isLoading: false,
        }));
    }, []);

    const performSearch = useCallback(
        async (query: string, collectionFilter: string | null, sectionFilter: string | null) => {
            const requestId = ++requestIdRef.current;
            const pagefind = pagefindRef.current;

            if (!pagefind) {
                queuedQueryRef.current = { query, collectionFilter, sectionFilter };
                return;
            }

            const trimmed = query.trim();
            if (!trimmed) {
                clearResults();
                return;
            }

            setState((prev) => ({ ...prev, isLoading: true, error: null }));

            try {
                const filters = buildFilters(collectionFilter, sectionFilter);
                const search = await pagefind.search(trimmed, { filters });
                const loaded = await loadSearchResults(search);

                if (requestId !== requestIdRef.current) {
                    return;
                }

                setState((prev) => ({
                    ...prev,
                    results: loaded,
                    resultCount: search.results.length,
                    isLoading: false,
                }));
            } catch (error) {
                if (requestId !== requestIdRef.current) {
                    return;
                }
                console.error('[search] Query failed:', error);
                setState((prev) => ({
                    ...prev,
                    isLoading: false,
                    error: 'Search failed. Please try again.',
                }));
            }
        },
        [buildFilters, clearResults, loadSearchResults],
    );

    const scheduleSearch = useCallback(
        (query: string, collectionFilter: string | null, sectionFilter: string | null) => {
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
            }

            debounceTimer.current = setTimeout(() => {
                performSearch(query, collectionFilter, sectionFilter);
            }, 200);
        },
        [performSearch],
    );

    // Initialize Pagefind lazily on first open
    const initPagefind = useCallback(async () => {
        if (pagefindRef.current) {
            return;
        }

        try {
            const initToken = ++initTokenRef.current;
            // Use a dynamic template string to completely hide the module path from Vite/Rollup static analysis
            const scriptUrl = `${window.location.origin}/pagefind/pagefind.js`;
            const pf = (await import(
                /* @vite-ignore */
                scriptUrl
            )) as unknown as PagefindAPI;

            await pf.options({
                baseUrl: '/',
                bundlePath: '/pagefind/',
                exactDiacritics: false,
                ranking: {
                    diacriticSimilarity: 0.0,
                },
            });

            if (initToken !== initTokenRef.current) {
                if (typeof pf.destroy === 'function') {
                    await pf.destroy();
                }
                return;
            }

            pagefindRef.current = pf;

            // Pre-load the filter index
            const filters = await pf.filters();

            setState((prev) => ({
                ...prev,
                isInitialized: true,
                availableFilters: filters,
            }));

            const queued = queuedQueryRef.current;
            if (queued) {
                queuedQueryRef.current = null;
                scheduleSearch(queued.query, queued.collectionFilter, queued.sectionFilter);
            }
        } catch (error) {
            console.error('[search] Failed to initialize Pagefind:', error);
            setState((prev) => ({
                ...prev,
                error: 'Search is not available. The search index may not have been built yet.',
            }));
        }
    }, [scheduleSearch]);

    // Open the dialog
    const open = useCallback(() => {
        setIsOpen(true);
    }, []);

    // Close the dialog
    const close = useCallback(() => {
        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
            debounceTimer.current = null;
        }
        queuedQueryRef.current = null;
        pagefindRef.current = null;
        requestIdRef.current += 1;
        initTokenRef.current += 1;
        setIsOpen(false);
        setState((prev) => ({
            ...prev,
            query: '',
            results: [],
            resultCount: 0,
            error: null,
            activeSectionFilter: null,
        }));
    }, []);

    // Focus input when dialog opens
    useEffect(() => {
        if (isOpen) {
            initPagefind();
            // Delay focus slightly for transition
            const timer = setTimeout(() => inputRef.current?.focus(), 100);
            return () => clearTimeout(timer);
        }
    }, [isOpen, initPagefind]);

    useEffect(() => {
        return () => {
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
                debounceTimer.current = null;
            }
            queuedQueryRef.current = null;
            pagefindRef.current = null;
            requestIdRef.current += 1;
            initTokenRef.current += 1;
        };
    }, []);

    // Global keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Cmd/Ctrl+K to toggle search
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen((prev) => !prev);
            }

            // Escape to close
            if (e.key === 'Escape' && isOpen) {
                e.preventDefault();
                close();
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, close]);

    // Prevent body scroll when open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }

        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    // Input change handler with debounce
    const onQueryChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const query = e.target.value;
            setState((prev) => ({ ...prev, query }));

            scheduleSearch(query, state.activeCollectionFilter, state.activeSectionFilter);
        },
        [scheduleSearch, state.activeCollectionFilter, state.activeSectionFilter],
    );

    // Collection filter toggle
    const toggleCollectionFilter = useCallback(
        (slug: string) => {
            const newFilter = state.activeCollectionFilter === slug ? null : slug;
            setState((prev) => ({
                ...prev,
                activeCollectionFilter: newFilter,
                activeSectionFilter: null,
            }));

            if (state.query.trim()) {
                scheduleSearch(state.query, newFilter, null);
            }
        },
        [state.activeCollectionFilter, state.query, scheduleSearch],
    );

    const onSectionFilterChange = useCallback(
        (nextValue: string) => {
            const nextFilter = nextValue || null;
            setState((prev) => ({ ...prev, activeSectionFilter: nextFilter }));

            if (state.query.trim()) {
                scheduleSearch(state.query, state.activeCollectionFilter, nextFilter);
            }
        },
        [scheduleSearch, state.activeCollectionFilter, state.query],
    );

    // Click on overlay to close
    const onOverlayClick = useCallback(
        (e: React.MouseEvent) => {
            if (e.target === e.currentTarget) {
                close();
            }
        },
        [close],
    );

    // Navigate to result
    const navigateToResult = useCallback(
        (url: string) => {
            close();
            window.location.href = url;
        },
        [close],
    );

    // Available collection filters
    const collectionFilters = state.availableFilters.collection ?? {};
    const sectionFilters = state.availableFilters.section ?? {};
    const sectionOptions =
        state.activeCollectionFilter && Object.keys(sectionFilters).length > 0
            ? Object.entries(sectionFilters)
                  .map(([value, count]) => {
                      const parsed = parseSectionFilterValue(value);
                      return {
                          value,
                          count,
                          collectionSlug: parsed.collectionSlug,
                          sectionTitle: parsed.sectionTitle,
                      };
                  })
                  .filter((entry) => entry.collectionSlug === state.activeCollectionFilter)
                  .sort((left, right) => left.sectionTitle.localeCompare(right.sectionTitle))
            : [];

    // ---------------------------------------------------------------------------
    // Render the trigger button (always rendered)
    // ---------------------------------------------------------------------------

    if (!isOpen) {
        return (
            <button
                type="button"
                onClick={open}
                className="search-trigger"
                aria-label="Search (⌘K)"
                title="Search (⌘K)"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 40,
                    height: 40,
                    padding: 0,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    color: 'var(--color-text-secondary, #6b7280)',
                    cursor: 'pointer',
                    transition: 'color 150ms ease-out, background-color 150ms ease-out',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-surface, #f3f4f6)';
                    e.currentTarget.style.color = 'var(--color-text-primary, #111827)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--color-text-secondary, #6b7280)';
                }}
            >
                <SearchIcon />
            </button>
        );
    }

    // ---------------------------------------------------------------------------
    // Render the search dialog
    // ---------------------------------------------------------------------------

    return (
        <>
            {/* Inject spinner animation */}
            <style>{`@keyframes searchSpin { to { transform: rotate(360deg); } }`}</style>

            {/* Overlay */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Modal backdrop */}
            <div style={styles.overlay} onClick={onOverlayClick} onKeyDown={undefined} role="presentation">
                {/* Dialog */}
                <div style={styles.dialog} role="dialog" aria-label="Search" aria-modal="true">
                    {/* Header / Input */}
                    <div style={styles.header}>
                        <span style={styles.searchIcon}>
                            <SearchIcon />
                        </span>
                        <input
                            ref={inputRef}
                            type="search"
                            aria-label="Search excerpts"
                            placeholder="Search excerpts…"
                            value={state.query}
                            onChange={onQueryChange}
                            style={styles.input}
                            autoComplete="off"
                            spellCheck={false}
                            id="search-input"
                        />
                        <button type="button" onClick={close} style={styles.closeButton} aria-label="Close search">
                            ESC
                        </button>
                    </div>

                    {/* Collection filters */}
                    {Object.keys(collectionFilters).length > 0 && (
                        <div style={styles.filters}>
                            {Object.entries(collectionFilters).map(([slug, count]) => (
                                <button
                                    key={slug}
                                    type="button"
                                    onClick={() => toggleCollectionFilter(slug)}
                                    style={styles.filterChip(state.activeCollectionFilter === slug)}
                                >
                                    {slug} ({count})
                                </button>
                            ))}
                        </div>
                    )}

                    {state.activeCollectionFilter && sectionOptions.length > 0 && (
                        <div style={styles.sectionFilterRow}>
                            <label htmlFor="search-section-filter" style={styles.sectionFilterLabel}>
                                Section
                            </label>
                            <select
                                id="search-section-filter"
                                style={styles.sectionSelect}
                                value={state.activeSectionFilter ?? ''}
                                onChange={(event) => onSectionFilterChange(event.target.value)}
                            >
                                <option value="">All sections</option>
                                {sectionOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.sectionTitle} ({option.count})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Results / States */}
                    <div style={styles.resultsList}>
                        {/* Error state */}
                        {state.error && (
                            <div style={styles.emptyState}>
                                <div style={styles.emptyIcon}>⚠️</div>
                                <div style={styles.emptyTitle}>Search unavailable</div>
                                <div style={styles.emptyDesc}>{state.error}</div>
                            </div>
                        )}

                        {/* Loading state */}
                        {!state.error && state.isLoading && (
                            <div style={styles.loadingState}>
                                <div style={styles.spinner} />
                                <div>Searching…</div>
                            </div>
                        )}

                        {/* Empty state - no query */}
                        {!state.error && !state.isLoading && !state.query.trim() && (
                            <div style={styles.emptyState}>
                                <div style={styles.emptyIcon}>🔍</div>
                                <div style={styles.emptyTitle}>Search the collection</div>
                                <div style={styles.emptyDesc}>Search in Arabic or English across all excerpts</div>
                            </div>
                        )}

                        {/* Empty state - no results */}
                        {!state.error && !state.isLoading && state.query.trim() && state.results.length === 0 && (
                            <div style={styles.emptyState}>
                                <div style={styles.emptyIcon}>📭</div>
                                <div style={styles.emptyTitle}>No results found</div>
                                <div style={styles.emptyDesc}>
                                    Try a different query or remove the collection filter
                                </div>
                            </div>
                        )}

                        {/* Results list */}
                        {!state.error &&
                            !state.isLoading &&
                            state.results.map((result) => (
                                <a
                                    key={result.id}
                                    href={result.url}
                                    style={styles.resultItem}
                                    onClick={(e) => {
                                        if (
                                            e.defaultPrevented ||
                                            e.button !== 0 ||
                                            e.metaKey ||
                                            e.ctrlKey ||
                                            e.shiftKey ||
                                            e.altKey
                                        ) {
                                            return;
                                        }
                                        e.preventDefault();
                                        navigateToResult(result.url);
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = 'var(--color-surface, #f3f4f6)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    <div style={styles.resultTitle}>{result.meta?.title ?? 'Untitled'}</div>
                                    <div style={styles.resultMeta}>
                                        {result.meta?.collectionTitle}
                                        {result.meta?.sectionTitle && ` → ${result.meta.sectionTitle}`}
                                        {result.meta?.authorName && ` • ${result.meta.authorName}`}
                                    </div>
                                    {result.excerpt && (
                                        <div
                                            style={styles.resultExcerpt}
                                            // Pagefind excerpt is pre-escaped with <mark> elements
                                            // biome-ignore lint/security/noDangerouslySetInnerHtml: excerpts are sanitized by Pagefind
                                            dangerouslySetInnerHTML={{ __html: result.excerpt }}
                                        />
                                    )}
                                </a>
                            ))}
                    </div>

                    {/* Footer */}
                    <div style={styles.footer}>
                        <span>
                            {state.resultCount > 0
                                ? `${state.resultCount} result${state.resultCount === 1 ? '' : 's'} found`
                                : 'Powered by Pagefind'}
                        </span>
                        <span>
                            <kbd style={styles.kbd}>⌘K</kbd> to toggle
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
}
