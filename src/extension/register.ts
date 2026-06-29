import type { Container } from '../core/container.js';
import type { ExtensionHost } from './ports.js';
import { createExaAnswerTool } from './tools/exa-answer.tool.js';
import { createFetchContentTool } from './tools/fetch-content.tool.js';
import { createGetContentTool } from './tools/get-content.tool.js';
import { createWebSearchTool } from './tools/web-search.tool.js';

/**
 * Host-agnostic registration: binds the container's services to the Pi host
 * via the ExtensionHost port. Knows nothing about the concrete SDK. Registers teardown.
 */
export function registerExtension(host: ExtensionHost, container: Container): void {
    host.registerTool(createWebSearchTool(container.search));
    host.registerTool(
        createFetchContentTool({
            fetch: container.fetch,
            summarize: container.summarize,
            content: container.content,
            inlineMaxChars: container.config.content.inlineMaxChars,
            maxSectionChars: container.config.content.maxSectionChars,
        }),
    );
    host.registerTool(createGetContentTool(container.content));
    host.registerTool(createExaAnswerTool(container.answer));

    host.onSessionShutdown(async () => {
        await container.dispose();
    });
}
