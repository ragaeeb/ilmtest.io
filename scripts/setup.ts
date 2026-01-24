import { mkdir } from 'node:fs/promises';
import { format, join } from 'node:path';
import { doApiGet, getCollection, getEntity, getLibrary, init, type Translator } from '@ilmtest/ilmtest-sdk-js';
import type { BookData } from 'shamela';
import { slugify } from '@/lib/textUtils';
import type { Collection, Compilation, Excerpt } from '@/types/excerpts';
import { getChunkFilename, groupAndChunkExcerpts } from './chunking';
import { HF_ASL_STORE, HF_EXCERPT_STORE, HF_SHAMELA4_STORE, HF_TOKEN, ILMTEST_API_URL, OUTPUT_DIR } from './env';
import { downloadDataSet } from './huggingface';
import { addEntityMappings, mergeIndexes } from './indexing';
import { decompressJson } from './io';
import {
    getExcerptsUnderTitle,
    mapTitlesToTableOfContents,
    mapTitleTreeToHeadingTree,
    type TitleNode,
} from './mapping';

const SHAMELA4_LIBRARY_ID = '75';

/** Output directories for generated files */
const INDEXES_DIR = 'src/data';
const CHUNKS_DIR = 'src/content/excerpt-chunks';

const downloadAndUnzipFile = async <T = unknown>(id: string, dataset: string) => {
    const fileName = `${id}.json.br`;
    const buffer = await downloadDataSet(dataset, fileName, {
        authToken: HF_TOKEN,
    });

    console.log('Uncompressing...', fileName);

    return decompressJson<T>(buffer);
};

const loadCollection = async (id: string): Promise<Collection> => {
    console.log('Downloading collection...');

    const [collection] = await getCollection(parseInt(id, 10));
    const [library] = await getLibrary(collection.library!);
    library.url_template = library.url_template!.replace('{id}', collection.fid!);
    library.url_template = library.url_template.replace('{page}', ':page');

    const [entity] = collection.author ? await getEntity(collection.author) : [];

    const slug = slugify(collection.title!, entity.display_name);

    return {
        authors: [
            {
                id: entity.id.toString(),
                name: entity.display_name,
                ism: entity.ar_display_name!,
                img: entity.avatars!,
            },
        ],
        src: { id: collection.library!.toString(), fid: collection.fid! },
        roman: collection.display_name,
        slug,
        citationTemplate: library.url_template!,
        unwan: collection.ar_display_name!,
        id,
    };
};

const loadExcerpts = async (collectionId: string): Promise<Compilation> => {
    const excerptsFile = format({ dir: OUTPUT_DIR, name: collectionId, ext: '.json' });

    if (await Bun.file(excerptsFile).exists()) {
        return Bun.file(excerptsFile).json();
    }

    console.log('Downloading excerpts from HuggingFace...');
    const excerpts: Compilation = await downloadAndUnzipFile(collectionId, HF_EXCERPT_STORE);

    console.log('Loading collection metadata...');
    excerpts.collection = await loadCollection(collectionId);

    console.log('Downloading asl from HuggingFace...');
    const store = excerpts.collection.src.id === SHAMELA4_LIBRARY_ID ? HF_SHAMELA4_STORE : HF_ASL_STORE;
    excerpts.sourceDocument = await downloadAndUnzipFile(excerpts.collection.src.fid, store);

    const serialized = JSON.stringify(excerpts, null, 2);

    console.log('Saving', excerptsFile, serialized.length, 'bytes');
    await Bun.write(excerptsFile, serialized);

    return excerpts;
};

const loadTranslators = async (): Promise<Translator[]> => {
    const jsonFile = join(OUTPUT_DIR, 'translators.json');

    if (!(await Bun.file(jsonFile).exists())) {
        console.log('Downloading translators');

        const translators = (await doApiGet<Translator[]>('translators', { limit: -1 })).map((t) => ({
            id: t.id,
            name: t.name,
        }));

        await Bun.write(jsonFile, JSON.stringify(translators));

        return translators;
    }

    return Bun.file(jsonFile).json();
};

/**
 * Fill in missing translator fields by using the translator from
 * the previous or next excerpt that has one defined.
 */
const fillMissingTranslators = (excerpts: Excerpt[]): void => {
    for (let i = 0; i < excerpts.length; i++) {
        if (excerpts[i].translator === undefined || excerpts[i].translator === null) {
            // Try previous, then next, then fallback to default
            const translator = excerpts[i - 1]?.translator ?? excerpts[i + 1]?.translator ?? 890;
            console.log(`  Filled missing translator for ${excerpts[i].id} with ${translator}`);
            excerpts[i].translator = translator;
        }
    }
};

/**
 * Generate indexes for Shamela books with hierarchical title structure.
 */
const generateShamelaIndexes = (
    data: Compilation,
    collectionId: string,
    titleTree: TitleNode[],
): {
    sectionToExcerpts: Record<string, string[]>;
    excerptToSection: Record<string, string>;
    pageToHeading: Record<number, string>;
    collectionToSections: Record<string, string[]>;
} => {
    const sectionToExcerpts: Record<string, string[]> = {};
    const excerptToSection: Record<string, string> = {};
    const pageToHeading: Record<number, string> = {};
    const collectionToSections: Record<string, string[]> = {};

    // Convert title tree to heading tree
    const headingTree = mapTitleTreeToHeadingTree(titleTree, data.headings);
    console.log('headingTree', headingTree);

    // Flatten the tree to get all headings
    const flattenHeadings = (nodes: typeof headingTree, result: typeof data.headings = []): typeof data.headings => {
        for (const node of nodes) {
            result.push(node);
            if (node.children) {
                flattenHeadings(node.children, result);
            }
        }
        return result;
    };

    const allHeadings = flattenHeadings(headingTree);

    // Initialize empty arrays for all headings
    for (const heading of allHeadings) {
        pageToHeading[heading.from] = heading.id;
        sectionToExcerpts[heading.id] = [];
    }

    // Map collection to root-level headings only
    collectionToSections[collectionId] = headingTree.map((h) => h.id);

    // Assign excerpts to headings using hierarchical logic
    const assignExcerptsToHeading = (node: (typeof headingTree)[0], titleNode: TitleNode) => {
        const excerpts = getExcerptsUnderTitle(titleTree, data.excerpts, titleNode);

        for (const excerpt of excerpts) {
            excerptToSection[excerpt.id] = node.id;
            sectionToExcerpts[node.id].push(excerpt.id);
        }

        // Recursively process children
        if (node.children && titleNode.children) {
            for (let i = 0; i < node.children.length; i++) {
                assignExcerptsToHeading(node.children[i], titleNode.children[i]);
            }
        }
    };

    // Process each root heading
    for (let i = 0; i < headingTree.length; i++) {
        assignExcerptsToHeading(headingTree[i], titleTree[i]);
    }

    return {
        sectionToExcerpts,
        excerptToSection,
        pageToHeading,
        collectionToSections,
    };
};

/**
 * Generate indexes for web-scraped content with flat page structure.
 */
const generateFlatIndexes = (
    data: Compilation,
    collectionId: string,
): {
    sectionToExcerpts: Record<string, string[]>;
    excerptToSection: Record<string, string>;
    pageToHeading: Record<number, string>;
    collectionToSections: Record<string, string[]>;
} => {
    const sectionToExcerpts: Record<string, string[]> = {};
    const excerptToSection: Record<string, string> = {};
    const pageToHeading: Record<number, string> = {};
    const collectionToSections: Record<string, string[]> = {};

    // Sort headings by page number
    const sortedHeadings = [...data.headings].sort((a, b) => a.from - b.from);

    // Initialize empty arrays for all headings
    for (const heading of sortedHeadings) {
        pageToHeading[heading.from] = heading.id;
        sectionToExcerpts[heading.id] = [];
    }

    // Map collection to all headings
    collectionToSections[collectionId] = sortedHeadings.map((h) => h.id);

    // Assign each excerpt to the appropriate heading
    // An excerpt belongs to the last heading whose 'from' <= excerpt's 'from'
    for (const excerpt of data.excerpts) {
        let assignedHeading: string | null = null;

        for (const heading of sortedHeadings) {
            if (heading.from <= excerpt.from) {
                assignedHeading = heading.id;
            } else {
                break;
            }
        }

        if (assignedHeading) {
            excerptToSection[excerpt.id] = assignedHeading;
            sectionToExcerpts[assignedHeading].push(excerpt.id);
        }
    }

    return {
        sectionToExcerpts,
        excerptToSection,
        pageToHeading,
        collectionToSections,
    };
};

export const setup = async (...collectionIds: string[]) => {
    console.log('Starting setup');

    init('3', ILMTEST_API_URL!);

    // Ensure output directories exist
    await mkdir(INDEXES_DIR, { recursive: true });
    await mkdir(CHUNKS_DIR, { recursive: true });

    let allIndexes = mergeIndexes();
    let translators = await loadTranslators();
    const usedTranslatorIds = new Set<number>();
    let totalChunks = 0;
    const collections: Collection[] = [];

    for (const id of collectionIds) {
        const data = await loadExcerpts(id);

        // Store collection metadata
        collections.push(data.collection);

        // Fill in missing translator fields
        console.log(`Checking and filling missing translators for collection ${id}...`);
        fillMissingTranslators(data.excerpts);
        fillMissingTranslators(data.headings);

        // Generate indexes based on data structure type
        console.log(`Generating indexes for collection ${id}...`);
        let indexes: any;

        // Check if this is a Shamela book (has titles) or web-scraped (has pages)
        if ((data.sourceDocument as BookData)?.titles) {
            const asl = data.sourceDocument as BookData;

            console.log('  Detected Shamela book with hierarchical titles');
            const titleTree = mapTitlesToTableOfContents(asl.titles);
            indexes = generateShamelaIndexes(data, id, titleTree);
        } else {
            console.log('  Detected web-scraped content with flat pages');
            indexes = generateFlatIndexes(data, id);
        }

        // Debug: Print section statistics
        console.log('  Section statistics:');
        for (const [sectionId, excerptIds] of Object.entries(indexes.sectionToExcerpts)) {
            const heading = data.headings.find((h) => h.id === sectionId);
            console.log(`    ${sectionId}: ${excerptIds.length} excerpts - "${heading?.text || heading?.nass}"`);
        }

        // Verify all excerpts are assigned
        const unassignedExcerpts = data.excerpts.filter((e) => !indexes.excerptToSection[e.id]);
        if (unassignedExcerpts.length > 0) {
            console.warn(`  ⚠️  ${unassignedExcerpts.length} excerpts not assigned to any section:`);
            unassignedExcerpts.slice(0, 5).forEach((e) => {
                console.warn(`    - ${e.id} (page ${e.from})`);
            });
        }

        allIndexes = mergeIndexes(allIndexes, indexes);

        // Add entity mappings for authors
        addEntityMappings(
            allIndexes,
            id,
            data.collection.authors.map((a) => a.id),
        );

        // Chunk excerpts by section
        console.log(`Chunking excerpts for collection ${id}...`);
        const chunks = groupAndChunkExcerpts(data.excerpts, indexes.excerptToSection, id);

        // Write chunks to output directory
        let chunkCount = 0;
        for (const [sectionId, sectionChunks] of chunks) {
            for (const chunk of sectionChunks) {
                const filename = getChunkFilename(id, sectionId, chunk.chunkIndex);
                const chunkPath = join(CHUNKS_DIR, filename);
                await Bun.write(chunkPath, JSON.stringify(chunk));
                chunkCount++;
            }
        }

        totalChunks += chunkCount;
        console.log(`  Created ${chunks.size} sections, ${chunkCount} chunk files`);

        data.excerpts.concat(data.headings).forEach((e) => {
            usedTranslatorIds.add(e.translator);
        });
    }

    // Write lookup indexes
    const indexesPath = join(INDEXES_DIR, 'indexes.json');
    await Bun.write(indexesPath, JSON.stringify(allIndexes, null, 2));
    console.log(`Generated ${indexesPath}`);

    // Write collections metadata
    const collectionsPath = join(INDEXES_DIR, 'collections.json');
    await Bun.write(collectionsPath, JSON.stringify(collections, null, 2));
    console.log(`Generated ${collectionsPath}`);

    translators = translators.filter((t) => usedTranslatorIds.has(t.id)).map((t) => ({ id: t.id, name: t.name }));

    // Write filtered translators
    const translatorsPath = join(INDEXES_DIR, 'translators.json');
    await Bun.write(translatorsPath, JSON.stringify(translators, null, 2));
    console.log(`Generated ${translatorsPath}`);

    console.log(`\nSetup complete!`);
    console.log(`  Collections: ${collectionIds.length}`);
    console.log(`  Total chunks: ${totalChunks}`);
    console.log(`  Translators: ${translators.length}`);
};

// Run if executed directly
if (import.meta.main) {
    await setup('1118', '2576');
}
