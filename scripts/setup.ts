import { mkdir } from 'node:fs/promises';
import { format, join } from 'node:path';
import { doApiGet, getCollection, getEntity, getLibrary, init, type Translator } from '@ilmtest/ilmtest-sdk-js';
import { getChunkFilename, groupAndChunkExcerpts } from './chunking';
import { HF_ASL_STORE, HF_EXCERPT_STORE, HF_SHAMELA4_STORE, HF_TOKEN, ILMTEST_API_URL, OUTPUT_DIR } from './env';
import { downloadDataSet } from './huggingface';
import { addEntityMappings, generateIndexes, mergeIndexes } from './indexing';
import { decompressJson } from './io';
import type { Collection, Excerpts } from './types/excerpts';

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
        slug: collection.title!.replace(' ', '_').toLowerCase(),
        citationTemplate: library.url_template!,
        unwan: collection.ar_display_name!,
        id,
    };
};

const loadExcerpts = async (collectionId: string): Promise<Excerpts> => {
    const excerptsFile = format({ dir: OUTPUT_DIR, name: collectionId, ext: '.json' });

    if (await Bun.file(excerptsFile).exists()) {
        return Bun.file(excerptsFile).json();
    }

    console.log('Downloading excerpts from HuggingFace...');
    const excerpts: Excerpts = await downloadAndUnzipFile(collectionId, HF_EXCERPT_STORE);

    console.log('Loading collection metadata...');
    excerpts.collection = await loadCollection(collectionId);

    console.log('Downloading asl from HuggingFace...');
    excerpts.asl = await downloadAndUnzipFile(
        excerpts.collection.src.fid,
        excerpts.collection.src.id === SHAMELA4_LIBRARY_ID ? HF_SHAMELA4_STORE : HF_ASL_STORE,
    );

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

    for (const id of collectionIds) {
        const data = await loadExcerpts(id);

        // Generate indexes for this collection
        console.log(`Generating indexes for collection ${id}...`);
        const indexes = generateIndexes(data, data.collection.slug);
        allIndexes = mergeIndexes(allIndexes, indexes);

        // Add entity mappings for authors
        addEntityMappings(
            allIndexes,
            id,
            data.collection.authors.map((a) => a.id),
        );

        // Chunk excerpts by section
        console.log(`Chunking excerpts for collection ${id}...`);
        const chunks = groupAndChunkExcerpts(data.excerpts, indexes.excerptToSection!, id);

        // Write chunks to output directory
        for (const [sectionId, sectionChunks] of chunks) {
            for (const chunk of sectionChunks) {
                const filename = getChunkFilename(id, sectionId, chunk.chunkIndex);
                const chunkPath = join(CHUNKS_DIR, filename);
                await Bun.write(chunkPath, JSON.stringify(chunk));
                totalChunks++;
            }
        }

        console.log(`  Created ${chunks.size} sections, ${totalChunks} chunk files`);

        data.excerpts.concat(data.headings).forEach((e) => {
            usedTranslatorIds.add(e.translator);
        });
    }

    // Write lookup indexes
    const indexesPath = join(INDEXES_DIR, 'indexes.json');
    await Bun.write(indexesPath, JSON.stringify(allIndexes, null, 2));
    console.log(`Generated ${indexesPath}`);

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
