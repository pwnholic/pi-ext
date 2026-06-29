import { Type } from 'typebox';
import type { Answerer } from '../../modules/answer/answer.service.js';
import type { ToolDefinition, ToolTextResult } from '../ports.js';

export interface ExaAnswerParams {
    query: string;
}

/**
 * Exa Answer tool: gets an LLM-synthesized answer to a question informed by
 * Exa search results, with citations to sources. More efficient than
 * search → fetch → summarize for factual questions.
 */
export function createExaAnswerTool(service: Answerer): ToolDefinition<ExaAnswerParams> {
    return {
        name: 'exa_answer',
        label: 'Exa Answer',
        description: [
            'Get an LLM-synthesized answer to a question using Exa search results with citations.',
            'Performs an Exa search and uses an LLM to generate either:',
            '1. A direct answer for specific queries (e.g. "What is the capital of France?")',
            '2. A detailed summary with citations for open-ended queries',
            '',
            '## Parameters',
            '- `query` (string)   REQUIRED. Natural-language question or instructions.',
            '',
            '## Best Practices',
            '1. Use for factual questions that need a definitive answer with sources.',
            '   Good: { query: "What is the latest valuation of SpaceX?" }',
            '   Good: { query: "What are the main differences between Rust and Go?" }',
            '2. For open-ended research requiring multiple perspectives, use `web_search` instead.',
            '3. The answer includes citations — use `fetch_content` to read full source pages.',
            '',
            '## Anti-Patterns',
            '- Vague queries like { query: "tell me about AI" } — too broad, use `web_search` instead.',
            '- Questions that require real-time data without specifying recency — use `web_search` with recency instead.',
        ].join('\n'),
        promptSnippet:
            'Get a synthesized answer with citations from Exa; best for factual questions; use web_search for open-ended research; follow up with fetch_content for full source pages.',
        promptGuidelines: [
            'Use `exa_answer` for factual questions that need a definitive answer with sources. Example: { query: "What is the latest valuation of SpaceX?" }.',
            'For open-ended research requiring multiple perspectives or comparisons, use `web_search` with plural `queries` instead.',
            'The answer includes citations with source URLs. Use `fetch_content` to read full pages when deeper analysis is needed.',
            'Avoid vague queries like { query: "tell me about AI" } — too broad for a synthesized answer. Use `web_search` instead.',
        ],
        parameters: Type.Object({
            query: Type.String(),
        }),
        async execute(params, signal): Promise<ToolTextResult> {
            const result = await service.answer({ query: params.query }, signal);

            if (!result.ok) {
                return {
                    content: [
                        { type: 'text', text: `Answer failed: ${result.error.message}` },
                    ],
                };
            }

            const { answer, citations, tookMs } = result.value;
            const body = formatAnswer(params.query, answer, citations, tookMs);
            return {
                content: [{ type: 'text', text: body }],
                details: { citations: citations.length },
            };
        },
    };
}

function formatAnswer(
    query: string,
    answer: string,
    citations: readonly { title: string; url: string; publishedDate?: string; author?: string }[],
    tookMs: number,
): string {
    const header = `# Answer: ${query}\n(${citations.length} sources, ${tookMs}ms)`;
    const body = `\n\n${answer}`;
    const sources =
        citations.length > 0
            ? `\n\n## Sources\n${citations
                  .map(
                      (c, i) =>
                          `${i + 1}. ${c.title}\n   ${c.url}${c.author ? `\n   ${c.author}` : ''}`,
                  )
                  .join('\n')}`
            : '';
    return `${header}${body}${sources}`;
}
