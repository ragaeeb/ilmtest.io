import * as env from 'env-var';

const getRevision = (name: string) => env.get(name).asString() || undefined;

const requireReleaseRevision = (name: string, value: string | undefined) => {
    if (process.env.RELEASE_BUILD === '1' && !value) {
        throw new Error(`${name} is required when RELEASE_BUILD=1`);
    }

    return value ?? 'main';
};

export const HF_TOKEN = env.get('HF_TOKEN').required().asString();
export const HF_EXCERPT_STORE = env.get('HF_EXCERPT_STORE').required().asString();
export const HF_ASL_STORE = env.get('HF_ASL_STORE').required().asString();
export const HF_SHAMELA4_STORE = env.get('HF_SHAMELA4_STORE').required().asString();
export const HF_EXCERPT_REVISION = requireReleaseRevision('HF_EXCERPT_REVISION', getRevision('HF_EXCERPT_REVISION'));
export const HF_ASL_REVISION = requireReleaseRevision('HF_ASL_REVISION', getRevision('HF_ASL_REVISION'));
export const HF_SHAMELA4_REVISION = requireReleaseRevision('HF_SHAMELA4_REVISION', getRevision('HF_SHAMELA4_REVISION'));
export const ILMTEST_API_URL = env.get('ILMTEST_API_URL').required().asString();
export const OUTPUT_DIR = env.get('OUTPUT_DIR').default('tmp').asString();
