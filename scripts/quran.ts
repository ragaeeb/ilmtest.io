import { Database } from 'bun:sqlite';

const mapUnixTimestampToSeconds = (t: number) => Math.floor(t / 1000);

type Surah = {
    id: number;
    name: string;
    verse_count: number;
    start: number;
    type: number;
    revelation_order: number;
    rukus: number;
};

type Ayat = {
    surah_id: number;
    verse_number: number;
    content: string;
    searchable: string;
};

type Chapter = {
    id: number;
    transliteration: string;
    translation: string;
};

type Verse = {
    chapter_id: number;
    verse_id: number;
    translation: string;
};

type Page = {
    page_number: number;
    surah_id: number;
    verse_number: number;
};

/**
 * Returns the current Unix timestamp in seconds (not milliseconds).
 * Used for lastUpdatedAt fields which track time in seconds for data persistence.
 */
const nowInSeconds = () => mapUnixTimestampToSeconds(Date.now());

let db = new Database('/Users/rhaq/workspace/ilmtest/admin-api/api/db/quran_english.db');
const chapters = db.query('SELECT * FROM chapters').all() as Chapter[];
const verses = db.query('SELECT * FROM verses').all() as Verse[];

db.close();

db = new Database('/Users/rhaq/workspace/ilmtest/admin-api/api/db/quran_arabic.db');
const surahs = db.query('SELECT * FROM surahs').all() as Surah[];
const ayahs = db.query('SELECT * FROM ayahs').all() as Ayat[];
const pages = db.query('SELECT * FROM ayahs').all() as Page[];

db.close();

const chapterVerseToPage: Record<string, number> = {};

pages.forEach((p) => {
    chapterVerseToPage[`${p.surah_id}.${p.verse_number}`] = p.page_number;
});

const compilation = {
    contractVersion: 'v4.0',
    createdAt: nowInSeconds(),
    lastUpdatedAt: nowInSeconds(),
    options: {},
    headings: surahs.map((s, i) => ({
        nass: s.name,
        id: `T${s.id}`,
        from: chapterVerseToPage[`${s.id}.1`],
        translator: 13,
        lastUpdatedAt: nowInSeconds(),
        text: `${chapters[i].transliteration} (${chapters[i].translation})`,
        meta: {
            num: s.id,
            revelationOrder: s.revelation_order,
            isMakkan: s.type === 1,
            rukus: s.rukus,
        },
    })),
    excerpts: ayahs.map((a, i) => ({
        nass: a.content,
        from: chapterVerseToPage[`${a.surah_id}.${a.verse_number}`],
        text: verses[i].translation,
        translator: 13,
        lastUpdatedAt: nowInSeconds(),
        meta: {
            headingId: `T${a.surah_id}`,
        },
    })),
    footnotes: [],
    postProcessingApps: [],
};

await Bun.write('1.json', JSON.stringify(compilation, null, 2));
