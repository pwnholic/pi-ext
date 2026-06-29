import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createContainer } from './core/container.js';
import { createHost, createPiLlmClient } from './extension/adapter.js';
import { registerExtension } from './extension/register.js';

/**
 * Pi extension entry point. Pi loads this via jiti and invokes the default
 * export with its ExtensionAPI. We capture the active session context so the
 * host port (widget/notify) and the Pi-backed LLM client can reach the current
 * model, then build the container and register the tools.
 */
export default function piExt(pi: ExtensionAPI): void {
    let activeCtx: ExtensionContext | undefined;
    pi.on('session_start', (_event, ctx) => {
        activeCtx = ctx;
    });

    const llm = createPiLlmClient(() => activeCtx);
    const container = createContainer({ llm });
    const host = createHost(pi, () => activeCtx);
    registerExtension(host, container);

    pi.on('session_shutdown', () => void container.dispose());
}

export type { Container } from './core/container.js';
export { createContainer } from './core/container.js';
