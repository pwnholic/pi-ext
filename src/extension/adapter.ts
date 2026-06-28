import { toError } from '../core/errors.js';
import type { CompletionRequest, LlmClient } from '../core/llm.js';
import { fromPromise, type Result } from '../core/result.js';
import type { ExtensionHost, ToolDefinition, WidgetHandle } from './ports.js';

/**
 * Minimal description of the Pi extension API surface this extension touches.
 * It mirrors `@earendil-works/pi-coding-agent`'s `ExtensionAPI` loosely so the
 * adapter is the SINGLE file to reconcile when the real SDK is wired in. Core
 * and modules never see this type.
 */
export interface PiHostApi {
    registerTool(tool: {
        name: string;
        label: string;
        description: string;
        parameters: unknown;
        execute: (callId: string, params: unknown, signal: AbortSignal) => Promise<unknown>;
    }): void;
    on(event: 'session_shutdown', handler: () => void | Promise<void>): void;
    ui?: {
        notify?: (message: string, level?: string) => void;
        setWidget?: (id: string, content: string | undefined) => void;
    };
    /** Optional model access provided by the Pi runtime (no extra API key). */
    complete?: (args: {
        messages: readonly { role: string; content: string }[];
        model?: string;
        temperature?: number;
        maxTokens?: number;
    }) => Promise<string>;
}

/**
 * Builds an LlmClient backed by Pi's own model access. Returns undefined when
 * the host exposes no `complete`, so summarization degrades gracefully.
 */
export function createPiLlmClient(pi: PiHostApi): LlmClient | undefined {
    const complete = pi.complete;
    if (!complete) return undefined;
    return {
        name: 'pi',
        isAvailable: () => true,
        complete(request: CompletionRequest): Promise<Result<string>> {
            return fromPromise(
                complete({
                    messages: request.messages,
                    ...(request.model ? { model: request.model } : {}),
                    ...(request.temperature !== undefined
                        ? { temperature: request.temperature }
                        : {}),
                    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
                }),
                (cause) => toError(cause, 'pi-llm'),
            );
        },
    };
}

/**
 * Adapts the concrete Pi API to our ExtensionHost port. This is the only place
 * that depends on the host's exact shape.
 */
export function createHost(pi: PiHostApi): ExtensionHost {
    return {
        registerTool<P>(tool: ToolDefinition<P>): void {
            pi.registerTool({
                name: tool.name,
                label: tool.label,
                description: tool.description,
                // Tools declare JSON-Schema-shaped parameters. Pi's SDK uses typebox,
                // which is JSON-Schema-compatible; convert here if a future SDK
                // version requires concrete `Type.Object(...)` instances.
                parameters: tool.parameters,
                execute: (_callId, params, signal) => tool.execute(params as P, signal),
            });
        },
        onSessionShutdown(handler) {
            pi.on('session_shutdown', handler);
        },
        notify(message, level = 'info') {
            pi.ui?.notify?.(message, level);
        },
        widget(id): WidgetHandle {
            return {
                set: (content) => pi.ui?.setWidget?.(id, content),
                remove: () => pi.ui?.setWidget?.(id, undefined),
            };
        },
    };
}
