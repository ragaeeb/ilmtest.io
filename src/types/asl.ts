export type WebPage = BasePage & ({ body: string } | { title: string });

type BasePage = {
    accessed?: Date; // serialized "2025-02-25T12:07:16.438Z"
    body?: string;
    footnotes?: string;
    index?: string;

    /**
     * Freeform
     * {
        "book": "سلسلة الهدى والنور",
        "chapter": "سلسلة الهدى والنور-001"
      }
     */
    metadata?: Record<string, any>;
    page: number;
    part?: number;
    publishDate?: string; // "16-08-2004"
    publishTimestamp?: Date;
    title?: string;
    url?: string;
};

export type ScrapeResult = {
    pages: WebPage[];
    scrapingEngine?: { name: string; version: string };
    timestamp: Date;
    urlPattern?: string;
};
