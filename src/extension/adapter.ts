import { complete } from '@earendil-works/pi-ai/compat';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { appError, toError } from '../core/errors.js';
import type { CompletionRequest, LlmClient } from '../core/llm.js';
import { err, fromPromise, ok, type Result } from '../core/result.js';
import type { ExtensionHost, ToolDefinition } from './ports.js';

/**
 * Adapter for the concrete Pi ExtensionAPI. This is the only file that depends
 * on the host SDK's exact shape; core/modules stay SDK-free.
 *
 * Pi passes a fresh `ExtensionContext` per session and tool call. We capture the
 * latest one via `getCtx` so the host port (notifications) and the LLM client
 * LLM client (active model) can reach it.
 */
export type GetExtensionContext = () => ExtensionContext | undefined;

export function createHost(pi: ExtensionAPI, getCtx: GetExtensionContext): ExtensionHost {
    return {
        registerTool<P>(tool: ToolDefinition<P>): void {
            pi.registerTool({
                name: tool.name,
                label: tool.label,
                description: tool.description,
                ...(tool.promptSnippet ? { promptSnippet: tool.promptSnippet } : {}),
                ...(tool.promptGuidelines ? { promptGuidelines: [...tool.promptGuidelines] } : {}),
                parameters: tool.parameters as never,
                async execute(_toolCallId, params, signal) {
                    const result = await tool.execute(
                        params as P,
                        signal ?? new AbortController().signal,
                    );
                    return {
                        content: result.content as never,
                        details: result.details ?? {},
                    };
                },
            });
        },
        onSessionShutdown(handler) {
            pi.on('session_shutdown', () => void handler());
        },
        notify(message, level = 'info') {
            getCtx()?.ui.notify(message, level === 'warn' ? 'warning' : level);
        },
    };
}

/**
 * LLM client backed by Pi's active model via `@earendil-works/pi-ai/compat`.
 * Uses the model resolved on the current session context, so summarization
 * needs no separate API key. Returns provider_unavailable when no model is set.
 *
 * Auth resolution: the session model is typically authenticated through Pi's
 * credential storage (/login, OAuth, subscription), not an env var. The compat
 * `complete()` only resolves env-var API keys, so we must resolve the model's
 * API key/headers from `ctx.modelRegistry` and inject them explicitly —
 * otherwise the call goes out unauthenticated and silently fails.
 */
export function createPiLlmClient(getCtx: GetExtensionContext): LlmClient {
    return {
        name: 'pi',
        isAvailable: () => Boolean(getCtx()?.model),
        async complete(request: CompletionRequest, signal?: AbortSignal): Promise<Result<string>> {
            const ctx = getCtx();
            const model = ctx?.model;
            if (!model) {
                return err(
                    appError('provider_unavailable', 'No active model for summarization', {
                        source: 'pi-llm',
                    }),
                );
            }
            const system = request.messages.find((m) => m.role === 'system')?.content;
            const userContent = request.messages
                .filter((m) => m.role !== 'system')
                .map((m) => m.content)
                .join('\n\n');

            // Resolve auth from Pi's credential storage so the call is
            // authenticated even when no env-var API key is set (the compat
            // complete() only resolves env-var keys).
            let auth: Record<string, unknown> = {};
            if (ctx?.modelRegistry) {
                try {
                    const resolved = (await ctx.modelRegistry.getApiKeyAndHeaders(model)) as
                        | {
                              ok?: boolean;
                              apiKey?: string;
                              headers?: Record<string, string>;
                              env?: Record<string, string>;
                          }
                        | undefined;
                    if (resolved?.ok) {
                        auth = {
                            ...(resolved.apiKey ? { apiKey: resolved.apiKey } : {}),
                            ...(resolved.headers ? { headers: resolved.headers } : {}),
                            ...(resolved.env ? { env: resolved.env } : {}),
                        };
                    }
                } catch {
                    // Auth resolution failed; let complete() surface the real error.
                }
            }

            return fromPromise(
                (async () => {
                    const assistant = await complete(
                        model,
                        {
                            ...(system ? { systemPrompt: system } : {}),
                            messages: [
                                { role: 'user', content: userContent, timestamp: Date.now() },
                            ],
                        },
                        { ...auth, ...(signal ? { signal } : {}) },
                    );
                    return assistant.content
                        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                        .map((c) => c.text)
                        .join('');
                })(),
                (cause) => toError(cause, 'pi-llm'),
            ).then((r) => (r.ok ? ok(r.value) : r));
        },
    };
}
