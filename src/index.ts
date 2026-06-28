import { createContainer } from './core/container.js';
import { createHost, createPiLlmClient, type PiHostApi } from './extension/adapter.js';
import { registerExtension } from './extension/register.js';

/**
 * Extension entry point. Pi invokes `activate` with its extension API; we build
 * the container (composition root), adapt the host, and register tools. The
 * entry stays thin — all wiring lives in createContainer/registerExtension.
 */
export function activate(pi: PiHostApi): void {
    const llm = createPiLlmClient(pi);
    const container = createContainer(llm ? { llm } : {});
    const host = createHost(pi);
    registerExtension(host, container);
    container.logger.info('pi-ext activated', {
        tools: ['web_search', 'fetch_content', 'get_content'],
        summarization: container.summarize.isAvailable(),
    });
}

export type { Container } from './core/container.js';
export { createContainer } from './core/container.js';
