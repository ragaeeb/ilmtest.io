type ModuleMap<T> = Record<string, T>;

const getFirstModule = <T>(modules: ModuleMap<T>, fallback: T): T => {
    const values = Object.values(modules);
    return (values.length ? values[0] : fallback) as T;
};

const collectionsModules = import.meta.glob('../data/collections.json', {
    eager: true,
    import: 'default',
}) as ModuleMap<unknown>;

const indexesModules = import.meta.glob('../data/indexes.json', {
    eager: true,
    import: 'default',
}) as ModuleMap<unknown>;

const translatorsModules = import.meta.glob('../data/translators.json', {
    eager: true,
    import: 'default',
}) as ModuleMap<unknown>;

export const loadCollectionsData = () => getFirstModule(collectionsModules, [] as unknown[]);
export const loadIndexesData = () => getFirstModule(indexesModules, {} as Record<string, unknown>);
export const loadTranslatorsData = () => getFirstModule(translatorsModules, [] as unknown[]);
