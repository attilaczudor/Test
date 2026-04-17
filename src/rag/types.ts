/**
 * RAG (Retrieval-Augmented Generation) Pipeline Types
 *
 * Connects the vector store + graph memory to council deliberation
 * and agent workflows. Embeds text via local Ollama embedding models,
 * retrieves relevant context, and augments prompts before LLM inference.
 */

export interface RagConfig {
  /** Ollama endpoint for embedding generation */
  embeddingEndpoint: string;
  /** Embedding model name (e.g. "nomic-embed-text", "all-minilm") */
  embeddingModel: string;
  /** Embedding dimensions (must match vector store) */
  dimensions: number;
  /** Max chunks to retrieve per query */
  topK: number;
  /** Minimum similarity score for retrieval (0.0-1.0) */
  similarityThreshold: number;
  /** Max characters per chunk when splitting documents */
  chunkSize: number;
  /** Overlap between chunks in characters */
  chunkOverlap: number;
}

export interface RagChunk {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  chunkIndex: number;
}

export interface RagRetrievalResult {
  chunks: Array<{
    chunk: RagChunk;
    score: number;
  }>;
  /** Graph memory nodes that are related to the query */
  memoryNodes: Array<{
    id: string;
    type: string;
    content: string;
    importance: number;
  }>;
  queryEmbedding: number[];
  totalCandidates: number;
  durationMs: number;
}

export interface RagAugmentedPrompt {
  originalQuery: string;
  retrievedContext: string;
  memoryContext: string;
  augmentedQuery: string;
  sourcesUsed: number;
}

export interface DocumentIngestResult {
  documentId: string;
  source: string;
  chunksCreated: number;
  embeddingsGenerated: number;
  durationMs: number;
}
