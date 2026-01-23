import * as env from 'env-var';

export const HF_TOKEN = env.get('HF_TOKEN').required().asString();
export const HF_EXCERPT_STORE = env.get('HF_EXCERPT_STORE').required().asString();
export const HF_ASL_STORE = env.get('HF_ASL_STORE').required().asString();
export const HF_SHAMELA4_STORE = env.get('HF_SHAMELA4_STORE').required().asString();
export const ILMTEST_API_URL = env.get('ILMTEST_API_URL').required().asString();
export const OUTPUT_DIR = env.get('OUTPUT_DIR').default('tmp').asString();
