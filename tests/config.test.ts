import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from '../src/core/config.js';

describe('resolveConfig', () => {
    it('returns defaults with no file config or env', () => {
        expect(resolveConfig({}, {})).toEqual(DEFAULT_CONFIG);
    });

    it('merges file config over defaults per section', () => {
        const config = resolveConfig({}, { search: { defaultNumResults: 8 } as never });
        expect(config.search.defaultNumResults).toBe(8);
        expect(config.search.timeoutMs).toBe(DEFAULT_CONFIG.search.timeoutMs); // untouched
        expect(config.fetch).toEqual(DEFAULT_CONFIG.fetch);
    });

    it('applies env overrides above file config', () => {
        const config = resolveConfig(
            {
                EXA_API_KEY: 'exa-from-env',
                IMPERS_PROXY: 'http://localhost:3128',
                PI_EXT_LOG_LEVEL: 'debug',
            },
            { search: { exaApiKey: 'from-file' } as never },
        );
        expect(config.search.exaApiKey).toBe('exa-from-env');
        expect(config.fetch.proxy).toBe('http://localhost:3128');
    });

    it('ignores blank env values', () => {
        const config = resolveConfig({ EXA_API_KEY: '  ' }, {});
        expect(config.search.exaApiKey).toBeUndefined();
    });
});
