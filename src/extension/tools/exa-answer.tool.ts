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
            'Synthesizes a direct answer to a factual question using Exa search + LLM.',
            'Returns a concise answer with numbered citations linking to sources.',
            '',
            '## When to Use',
            '- Specific factual questions with a definitive answer',
            '- Comparisons with concrete criteria ("X vs Y for Z")',
            '- Current state of something ("What is the status of X?")',
            '',
            '## When NOT to Use',
            '- Broad exploration: use `web_search` with multiple queries',
            '- Need full page content: use `fetch_content` directly',
            '- Opinion or subjective analysis: this tool returns factual synthesis only',
            '',
            '## Output Format',
            '```',
            '# Answer: What is the latest valuation of SpaceX?',
            '(2 sources, 1234ms)',
            '',
            'SpaceX was last valued at approximately $180 billion in June 2024.',
            'This valuation came from a secondary share sale...',
            '',
            '## Sources',
            '1. SpaceX raises funds at $180B valuation',
            '   https://www.reuters.com/...',
            '   Reuters',
            '2. SpaceX Secondary Share Sale',
            '   https://www.bloomberg.com/...',
            '```',
            '',
            '## Limitations',
            '- Answer quality depends on source availability. Obscure topics may have weak citations.',
            '- Not suitable for real-time data (stock prices, live scores). Use `web_search` with recency.',
            '- Maximum ~5 citations per answer. For comprehensive research, use `web_search`.',
        ].join('\n'),

        promptSnippet:
            'Factual question -> synthesized answer + citations. Not for broad research (use web_search) or full pages (use fetch_content).',

        promptGuidelines: [
            'DECISION: Is the question specific enough for ONE direct answer?',
            '  YES -> use exa_answer',
            '  NO  -> use web_search with multiple queries',
            '',
            'Write queries as clear, self-contained questions:',
            '  GOOD: { query: "What is the latest valuation of SpaceX as of 2024?" }',
            '  GOOD: { query: "Compare Rust vs Go for systems programming: performance, memory safety, learning curve" }',
            '  BAD:  { query: "tell me about AI" }',
            '  FIX:  { query: "What are the main branches of machine learning and their key algorithms?" }',
            '',
            'After getting an answer, common follow-ups:',
            '  - Need more detail on a citation -> `fetch_content` with the source URL',
            '  - Need different perspective -> `web_search` with a different query angle',
            '  - Need to verify a claim -> `fetch_content` the specific citation URL',
            '',
            'NEVER use for:',
            '  - "Give me an overview of X" -> web_search',
            '  - "What should I choose?" (subjective) -> web_search, then synthesize yourself',
            '  - "List all X" (exhaustive) -> web_search with multiple specific queries',
        ],

        parameters: Type.Object({
            query: Type.String({
                description:
                    'Natural-language question. Be specific -- this tool works best with focused, answerable questions.',
                minLength: 10,
            }),
        }),

        async execute(params, signal): Promise<ToolTextResult> {
            if (params.query.trim().length < 10) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: [
                                'Error: Query too short. This tool requires specific, focused questions.',
                                '',
                                'Your query needs more context. Try reformulating:',
                                `  Current: "${params.query}"`,
                                '  Better: "What is [specific topic] and [specific aspect]?"',
                                '',
                                'For broad exploration, use `web_search` instead.',
                            ].join('\n'),
                        },
                    ],
                };
            }

            const result = await service.answer({ query: params.query }, signal);

            if (!result.ok) {
                const msg = (result.error.message ?? '').toLowerCase();

                let suggestion: string;
                if (msg.includes('429') || msg.includes('rate')) {
                    suggestion =
                        'Wait a moment, then retry. Alternatively, use `web_search` for similar results.';
                } else if (msg.includes('408') || msg.includes('timeout')) {
                    suggestion =
                        'The query may be too complex. Try simplifying it, or use `web_search` instead.';
                } else if (msg.includes('no results') || msg.includes('not found')) {
                    suggestion =
                        'No relevant sources found. Try rephrasing the question or use `web_search` with broader terms.';
                } else {
                    suggestion = 'Try `web_search` as an alternative, or rephrase your question.';
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: [
                                `Error: ${result.error.message}`,
                                '',
                                `Suggested action: ${suggestion}`,
                            ].join('\n'),
                        },
                    ],
                };
            }

            const { answer, citations, tookMs } = result.value;
            const body = formatAnswer(params.query, answer, citations, tookMs);

            return {
                content: [{ type: 'text', text: body }],
                details: {
                    citations: citations.length,
                    tookMs,
                },
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
