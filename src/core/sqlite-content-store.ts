import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
    type ContentStore,
    newResponseId,
    type SectionHit,
    type StoredDoc,
    snippetAround,
    tokenize,
} from './content-store.js';
import type { Section } from './sections.js';

/**
 * SQLite-backed content store using FTS5 for ranked section search. Content
 * lives in SQLite (off the JS heap) and `search` uses BM25 ranking natively
 * instead of the in-memory term-frequency scorer.
 *
 * Defaults to an in-memory database (`:memory:`) since responseIds are only
 * meaningful within a session; pass a file path for cross-session persistence.
 */
export interface SqliteContentStoreConfig {
    readonly maxResponses: number;
    readonly path?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS responses (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS documents (
  response_id TEXT NOT NULL, doc_index INTEGER NOT NULL,
  url TEXT NOT NULL, title TEXT NOT NULL, full_content TEXT NOT NULL, total_chars INTEGER NOT NULL,
  PRIMARY KEY (response_id, doc_index)
);
CREATE TABLE IF NOT EXISTS sections (
  response_id TEXT NOT NULL, doc_index INTEGER NOT NULL, section_id TEXT NOT NULL,
  level INTEGER NOT NULL, heading TEXT NOT NULL, content TEXT NOT NULL, char_count INTEGER NOT NULL,
  PRIMARY KEY (response_id, doc_index, section_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
  heading, content, response_id UNINDEXED, doc_index UNINDEXED, section_id UNINDEXED, tokenize='porter'
);
`;

const DEFAULT_TOP_K = 5;

export class SqliteContentStore implements ContentStore {
    private readonly db: DatabaseSync;
    private readonly insertResponse: StatementSync;
    private readonly insertDocument: StatementSync;
    private readonly insertSection: StatementSync;
    private readonly insertFts: StatementSync;
    private readonly selectDocuments: StatementSync;
    private readonly selectSections: StatementSync;
    private readonly searchStmt: StatementSync;

    constructor(private readonly config: SqliteContentStoreConfig) {
        this.db = new DatabaseSync(config.path ?? ':memory:');
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
        this.db.exec(SCHEMA);

        this.insertResponse = this.db.prepare(
            'INSERT INTO responses (id, created_at) VALUES (?, ?)',
        );
        this.insertDocument = this.db.prepare(
            'INSERT INTO documents (response_id, doc_index, url, title, full_content, total_chars) VALUES (?, ?, ?, ?, ?, ?)',
        );
        this.insertSection = this.db.prepare(
            'INSERT INTO sections (response_id, doc_index, section_id, level, heading, content, char_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
        );
        this.insertFts = this.db.prepare(
            'INSERT INTO sections_fts (heading, content, response_id, doc_index, section_id) VALUES (?, ?, ?, ?, ?)',
        );
        this.selectDocuments = this.db.prepare(
            'SELECT doc_index, url, title, full_content, total_chars FROM documents WHERE response_id = ? ORDER BY doc_index',
        );
        this.selectSections = this.db.prepare(
            'SELECT section_id, level, heading, content, char_count FROM sections WHERE response_id = ? AND doc_index = ? ORDER BY CAST(section_id AS INTEGER)',
        );
        this.searchStmt = this.db.prepare(
            `SELECT s.doc_index AS docIndex, s.section_id AS sectionId, s.level AS level,
              s.heading AS heading, s.content AS content, s.char_count AS charCount
       FROM sections_fts f
       JOIN sections s ON s.response_id = f.response_id AND s.doc_index = f.doc_index AND s.section_id = f.section_id
       WHERE f.sections_fts MATCH ? AND f.response_id = ?
       ORDER BY f.rank LIMIT ?`,
        );
    }

    put(docs: readonly StoredDoc[]): string {
        const id = newResponseId();
        this.db.exec('BEGIN');
        try {
            this.insertResponse.run(id, Date.now());
            docs.forEach((doc, docIndex) => {
                this.insertDocument.run(
                    id,
                    docIndex,
                    doc.url,
                    doc.title,
                    doc.fullContent,
                    doc.totalChars,
                );
                for (const s of doc.sections) {
                    this.insertSection.run(
                        id,
                        docIndex,
                        s.id,
                        s.level,
                        s.heading,
                        s.content,
                        s.charCount,
                    );
                    this.insertFts.run(s.heading, s.content, id, docIndex, s.id);
                }
            });
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        this.enforceCap();
        return id;
    }

    get(responseId: string): readonly StoredDoc[] | undefined {
        const docRows = this.selectDocuments.all(responseId);
        if (docRows.length === 0) return undefined;
        return docRows.map((row) => {
            const docIndex = Number(row.doc_index);
            const sections = this.selectSections.all(responseId, docIndex).map(toSection);
            return {
                url: String(row.url),
                title: String(row.title),
                sections,
                fullContent: String(row.full_content),
                totalChars: Number(row.total_chars),
            } satisfies StoredDoc;
        });
    }

    search(responseId: string, query: string, topK = DEFAULT_TOP_K): SectionHit[] {
        const terms = tokenize(query);
        const firstTerm = terms[0];
        if (firstTerm === undefined) return [];
        const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');

        const rows = this.searchStmt.all(match, responseId, topK);
        return rows.map((row) => {
            const section = toSection(row);
            return {
                docIndex: Number(row.docIndex),
                section,
                snippet: snippetAround(section.content, firstTerm),
            };
        });
    }

    clear(): void {
        this.db.exec(
            'DELETE FROM responses; DELETE FROM documents; DELETE FROM sections; DELETE FROM sections_fts;',
        );
    }

    close(): void {
        this.db.close();
    }

    /** Drop the oldest responses (and their rows) once past the cap. */
    private enforceCap(): void {
        const row = this.db.prepare('SELECT COUNT(*) AS n FROM responses').get() as { n: number };
        const excess = Number(row.n) - this.config.maxResponses;
        if (excess <= 0) return;
        const stale = this.db
            .prepare('SELECT id FROM responses ORDER BY created_at ASC LIMIT ?')
            .all(excess)
            .map((r) => String(r.id));
        const deleteFrom = (table: string): void => {
            const placeholders = stale.map(() => '?').join(',');
            this.db
                .prepare(`DELETE FROM ${table} WHERE response_id IN (${placeholders})`)
                .run(...stale);
        };
        this.db.exec('BEGIN');
        try {
            deleteFrom('sections_fts');
            deleteFrom('sections');
            deleteFrom('documents');
            const ph = stale.map(() => '?').join(',');
            this.db.prepare(`DELETE FROM responses WHERE id IN (${ph})`).run(...stale);
            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
}

function toSection(row: Record<string, unknown>): Section {
    const id = String(row.section_id ?? row.sectionId);
    return {
        id,
        level: Number(row.level),
        heading: String(row.heading),
        content: String(row.content),
        charCount: Number(row.char_count ?? row.charCount),
    };
}
