import { type FixtureVariant, materializeFixture } from './fixtures';

const main = async () => {
    const [variantArg = 'tiny'] = process.argv.slice(2);
    if (variantArg !== 'tiny' && variantArg !== 'medium') {
        throw new Error('Usage: bun scripts/setupFixture.ts <tiny|medium>');
    }

    const result = await materializeFixture(variantArg as FixtureVariant);
    console.log(JSON.stringify(result, null, 2));
};

if (import.meta.main) {
    await main();
}
