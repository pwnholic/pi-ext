import type { Container } from '../core/container.js';
import type { ExtensionHost } from './ports.js';
import { createFetchContentTool } from './tools/fetch-content.tool.js';
import { createGetContentTool } from './tools/get-content.tool.js';
import { createWebSearchTool } from './tools/web-search.tool.js';

/**
 * Host-agnostic registration: binds the container's services to the Pi host
 * via the ExtensionHost port. Knows nothing about the concrete SDK. Wires the
 * activity widget to the monitor and registers teardown.
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

    const widget = host.widget('web-activity');
    const off = container.activity.onUpdate((entries) => {
        const lines = entries
            .slice(-8)
            .map((e) => {
                const mark = e.status === 'ok' ? 'ok' : e.status === 'error' ? 'x' : '...';
                return `[${mark}] ${e.kind} ${e.label}${e.detail ? ` — ${e.detail}` : ''}`;
            })
            .join('\n');
        widget.set(lines || 'No activity');
    });

    host.onSessionShutdown(async () => {
        off();
        widget.remove();
        await container.dispose();
    });
}
