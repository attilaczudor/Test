/**
 * Hybrid Search — BM25 + Vector Similarity Score Fusion
 *
 * Inspired by upstream OpenClaw's hybrid retrieval approach.
 * Combines BM25 full-text scoring with cosine similarity for
 * better retrieval quality than either method alone.
 *
 * BM25 excels at exact keyword matches ("Proxmox cluster error"),
 * while vector search captures semantic similarity ("container
 * orchestration problem"). Fusing both gives the best of both worlds.
 */

export interface HybridSearchResult {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  vectorScore: number;
  bm25Score: number;
  fusedScore: number;
}

export interface HybridSearchConfig {
  /** Weight for vector similarity score (0-1). BM25 weight = 1 - vectorWeight */
  vectorWeight: number;
  /** BM25 tuning: term frequency saturation. Default 1.2 */
  bm25K1: number;
  /** BM25 tuning: field length normalization. Default 0.75 */
  bm25B: number;
}

const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  vectorWeight: 0.6,
  bm25K1: 1.2,
  bm25B: 0.75,
};

/**
 * In-memory BM25 index for full-text search.
 * Paired with vector store for hybrid retrieval.
 */
export class Bm25Index {
  private readonly config: HybridSearchConfig;
  private readonly documents = new Map<string, BM25Document>();
  private readonly idf = new Map<string, number>(); // term -> IDF score
  private avgDocLength = 0;
  private dirty = true; // IDF needs recalculation

  constructor(config?: Partial<HybridSearchConfig>) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };
  }

  /**
   * Add a document to the BM25 index.
   */
  add(id: string, content: string, source: string, metadata: Record<string, unknown> = {}): void {
    const terms = this.tokenize(content);
    const termFreqs = new Map<string, number>();

    for (const term of terms) {
      termFreqs.set(term, (termFreqs.get(term) || 0) + 1);
    }

    this.documents.set(id, {
      id,
      content,
      source,
      metadata,
      terms,
      termFreqs,
      length: terms.length,
    });

    this.dirty = true;
  }

  /**
   * Remove a document from the index.
   */
  remove(id: string): boolean {
    const removed = this.documents.delete(id);
    if (removed) this.dirty = true;
    return removed;
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.documents.clear();
    this.idf.clear();
    this.avgDocLength = 0;
    this.dirty = true;
  }

  /**
   * Search using BM25 scoring.
   * Returns documents ranked by BM25 relevance.
   */
  search(query: string, topK: number = 10): Array<{ id: string; score: number }> {
    if (this.dirty) this.rebuildIdf();

    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    const scores: Array<{ id: string; score: number }> = [];

    for (const [id, doc] of this.documents) {
      let score = 0;

      for (const term of queryTerms) {
        const tf = doc.termFreqs.get(term) || 0;
        if (tf === 0) continue;

        const idf = this.idf.get(term) || 0;
        const { bm25K1: k1, bm25B: b } = this.config;
        const lengthNorm = 1 - b + b * (doc.length / this.avgDocLength);

        // BM25 formula: IDF * (tf * (k1 + 1)) / (tf + k1 * lengthNorm)
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * lengthNorm));
      }

      if (score > 0) {
        scores.push({ id, score });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  /**
   * Get a document by ID.
   */
  get(id: string): BM25Document | undefined {
    return this.documents.get(id);
  }

  /**
   * Number of indexed documents.
   */
  size(): number {
    return this.documents.size;
  }

  // ─── Internals ─────────────────────────────────────────────

  /**
   * Tokenize text into normalized terms.
   * Simple whitespace + punctuation splitting with lowercasing and stopword removal.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  }

  /**
   * Rebuild IDF scores and average document length.
   * Called lazily when the index is dirty and a search is performed.
   */
  private rebuildIdf(): void {
    const N = this.documents.size;
    if (N === 0) {
      this.dirty = false;
      return;
    }

    // Count document frequency for each term
    const docFreq = new Map<string, number>();
    let totalLength = 0;

    for (const doc of this.documents.values()) {
      totalLength += doc.length;

      // Count unique terms in this document
      const seen = new Set<string>();
      for (const term of doc.terms) {
        if (!seen.has(term)) {
          seen.add(term);
          docFreq.set(term, (docFreq.get(term) || 0) + 1);
        }
      }
    }

    this.avgDocLength = totalLength / N;

    // Compute IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    this.idf.clear();
    for (const [term, df] of docFreq) {
      this.idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }

    this.dirty = false;
  }
}

interface BM25Document {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  terms: string[];
  termFreqs: Map<string, number>;
  length: number;
}

/**
 * Fuse vector similarity scores with BM25 scores using weighted combination.
 * Both score arrays are min-max normalized before fusion.
 */
export function fuseScores(
  vectorResults: Array<{ id: string; score: number }>,
  bm25Results: Array<{ id: string; score: number }>,
  vectorWeight: number = 0.6,
  topK: number = 10
): Array<{ id: string; vectorScore: number; bm25Score: number; fusedScore: number }> {
  const bm25Weight = 1 - vectorWeight;

  // Normalize vector scores to 0-1 (they may already be 0-1 for cosine, but be safe)
  const vectorNorm = normalizeScores(vectorResults);
  const bm25Norm = normalizeScores(bm25Results);

  // Build lookup maps
  const vectorMap = new Map(vectorNorm.map((r) => [r.id, r.score]));
  const bm25Map = new Map(bm25Norm.map((r) => [r.id, r.score]));

  // Collect all unique IDs
  const allIds = new Set([
    ...vectorResults.map((r) => r.id),
    ...bm25Results.map((r) => r.id),
  ]);

  const fused: Array<{ id: string; vectorScore: number; bm25Score: number; fusedScore: number }> = [];

  for (const id of allIds) {
    const vs = vectorMap.get(id) || 0;
    const bs = bm25Map.get(id) || 0;
    fused.push({
      id,
      vectorScore: vs,
      bm25Score: bs,
      fusedScore: vectorWeight * vs + bm25Weight * bs,
    });
  }

  fused.sort((a, b) => b.fusedScore - a.fusedScore);
  return fused.slice(0, topK);
}

/**
 * Min-max normalize scores to [0, 1].
 */
function normalizeScores(results: Array<{ id: string; score: number }>): Array<{ id: string; score: number }> {
  if (results.length === 0) return [];
  if (results.length === 1) return [{ ...results[0], score: 1 }];

  const min = Math.min(...results.map((r) => r.score));
  const max = Math.max(...results.map((r) => r.score));
  const range = max - min;

  if (range === 0) return results.map((r) => ({ ...r, score: 1 }));

  return results.map((r) => ({
    id: r.id,
    score: (r.score - min) / range,
  }));
}

/**
 * Common English stopwords — excluded from BM25 indexing.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for",
  "if", "in", "is", "it", "no", "not", "of", "on", "or", "so",
  "the", "to", "up", "was", "we", "do", "he", "me", "my", "am",
  "can", "did", "get", "got", "had", "has", "her", "him", "his",
  "how", "its", "let", "may", "new", "now", "old", "our", "out",
  "own", "say", "she", "too", "use", "all", "any", "few", "who",
  "with", "will", "that", "this", "they", "them", "then", "than",
  "from", "been", "have", "what", "when", "here", "just", "also",
  "more", "some", "very", "your", "into", "each", "over", "such",
  "much", "only", "most", "same", "both", "does", "well", "back",
  "about", "would", "could", "should", "their", "there", "these",
  "which", "being", "other", "those", "where", "while", "after",
  "before", "still", "through",
]);
