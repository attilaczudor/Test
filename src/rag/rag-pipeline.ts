import { EventEmitter } from "events";
import * as crypto from "crypto";
import { VectorStore } from "../vector";
import { GraphMemory } from "../memory";
import { Bm25Index, fuseScores } from "./hybrid-search";
import {
  RagConfig,
  RagChunk,
  RagRetrievalResult,
  RagAugmentedPrompt,
  DocumentIngestResult,
} from "./types";

/**
 * RAG Pipeline — Retrieval-Augmented Generation
 *
 * Connects embedding generation (via Ollama), vector storage, and graph
 * memory to provide context-enriched prompts for council deliberation
 * and agent tasks.
 *
 * Flow:
 *   1. Ingest: Document → chunk → embed → store in vector DB
 *   2. Retrieve: Query → embed → search vector DB + graph memory
 *   3. Augment: Combine retrieved context with original prompt
 */
export class RagPipeline extends EventEmitter {
  private readonly config: RagConfig;
  private readonly vectorStore: VectorStore;
  private readonly memory: GraphMemory;
  private readonly chunks = new Map<string, RagChunk>();
  private readonly bm25 = new Bm25Index();

  constructor(config: RagConfig, vectorStore: VectorStore, memory: GraphMemory) {
    super();
    this.config = config;
    this.vectorStore = vectorStore;
    this.memory = memory;
  }

  // ─── Embedding ─────────────────────────────────────────────

  /**
   * Generate embeddings via the local Ollama embedding endpoint.
   */
  async embed(text: string): Promise<number[]> {
    const url = `${this.config.embeddingEndpoint}/api/embeddings`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  }

  /**
   * Batch embed multiple texts.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  // ─── Document Ingestion ────────────────────────────────────

  /**
   * Ingest a document: chunk it, embed each chunk, store in vector DB.
   */
  async ingest(
    content: string,
    source: string,
    metadata: Record<string, unknown> = {}
  ): Promise<DocumentIngestResult> {
    const startTime = Date.now();
    const documentId = `doc-${crypto.randomUUID().slice(0, 8)}`;
    const textChunks = this.chunkText(content);
    let embeddingsGenerated = 0;

    for (let i = 0; i < textChunks.length; i++) {
      const chunkId = `${documentId}-chunk-${i}`;
      const chunkContent = textChunks[i];

      const embedding = await this.embed(chunkContent);
      embeddingsGenerated++;

      const chunk: RagChunk = {
        id: chunkId,
        content: chunkContent,
        source,
        metadata: { ...metadata, documentId, chunkIndex: i },
        embedding,
        chunkIndex: i,
      };

      this.chunks.set(chunkId, chunk);

      // Store in vector DB
      this.vectorStore.add(chunkId, chunkContent, embedding, {
        source,
        documentId,
        chunkIndex: i,
        ...metadata,
      });

      // Store in BM25 index for hybrid search
      this.bm25.add(chunkId, chunkContent, source, {
        documentId,
        chunkIndex: i,
        ...metadata,
      });

      // Also store in graph memory for relationship tracking
      this.memory.addNode("fact", chunkContent, {
        source,
        documentId,
        chunkId,
        chunkIndex: i,
      }, 0.4);
    }

    this.emit("documentIngested", { documentId, source, chunks: textChunks.length });

    return {
      documentId,
      source,
      chunksCreated: textChunks.length,
      embeddingsGenerated,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Ingest a pre-chunked document (useful when you want control over chunking).
   */
  async ingestChunks(
    chunks: Array<{ content: string; metadata?: Record<string, unknown> }>,
    source: string
  ): Promise<DocumentIngestResult> {
    const startTime = Date.now();
    const documentId = `doc-${crypto.randomUUID().slice(0, 8)}`;
    let embeddingsGenerated = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `${documentId}-chunk-${i}`;
      const embedding = await this.embed(chunks[i].content);
      embeddingsGenerated++;

      const chunk: RagChunk = {
        id: chunkId,
        content: chunks[i].content,
        source,
        metadata: { ...chunks[i].metadata, documentId, chunkIndex: i },
        embedding,
        chunkIndex: i,
      };

      this.chunks.set(chunkId, chunk);
      this.vectorStore.add(chunkId, chunks[i].content, embedding, {
        source,
        documentId,
        chunkIndex: i,
        ...chunks[i].metadata,
      });

      // Store in BM25 index for hybrid search
      this.bm25.add(chunkId, chunks[i].content, source, {
        documentId,
        chunkIndex: i,
        ...chunks[i].metadata,
      });
    }

    return {
      documentId,
      source,
      chunksCreated: chunks.length,
      embeddingsGenerated,
      durationMs: Date.now() - startTime,
    };
  }

  // ─── Retrieval ─────────────────────────────────────────────

  /**
   * Retrieve relevant chunks and memory nodes for a query.
   */
  async retrieve(query: string): Promise<RagRetrievalResult> {
    const startTime = Date.now();

    // Embed the query
    const queryEmbedding = await this.embed(query);

    // ── Hybrid Search: Vector + BM25 ──────────────────────────
    // Upstream OpenClaw pattern: fuse cosine similarity with BM25
    // keyword scores for better retrieval quality.
    const vectorResults = this.vectorStore.search(
      queryEmbedding,
      this.config.topK * 2 // fetch extra candidates for fusion
    );
    const bm25Results = this.bm25.search(query, this.config.topK * 2);

    // Fuse scores: 60% vector, 40% BM25
    const fusedResults = fuseScores(
      vectorResults.map((r) => ({ id: r.entry.id, score: r.score })),
      bm25Results,
      0.6,
      this.config.topK
    );

    const chunks = fusedResults.map((f) => {
      const vectorHit = vectorResults.find((r) => r.entry.id === f.id);
      const chunk = this.chunks.get(f.id) || (vectorHit ? {
        id: vectorHit.entry.id,
        content: vectorHit.entry.content,
        source: (vectorHit.entry.metadata.source as string) || "unknown",
        metadata: vectorHit.entry.metadata,
        chunkIndex: (vectorHit.entry.metadata.chunkIndex as number) || 0,
      } : {
        id: f.id,
        content: this.bm25.get(f.id)?.content || "",
        source: this.bm25.get(f.id)?.source || "unknown",
        metadata: this.bm25.get(f.id)?.metadata || {},
        chunkIndex: 0,
      });
      return { chunk, score: f.fusedScore };
    });

    // Also search graph memory for related nodes
    const memoryResults = this.memory.query({
      text: query,
      limit: 5,
      minImportance: 0.3,
    });

    const memoryNodes = memoryResults.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      content: n.content,
      importance: n.importance,
    }));

    return {
      chunks,
      memoryNodes,
      queryEmbedding,
      totalCandidates: this.vectorStore.size(),
      durationMs: Date.now() - startTime,
    };
  }

  // ─── Augmentation ──────────────────────────────────────────

  /**
   * Retrieve context and augment the query with it.
   * Returns the full augmented prompt ready for LLM inference.
   */
  async augment(query: string): Promise<RagAugmentedPrompt> {
    const retrieval = await this.retrieve(query);

    // Build context from retrieved chunks
    const retrievedContext = retrieval.chunks
      .map((c, i) => `[Source ${i + 1}: ${c.chunk.source}]\n${c.chunk.content}`)
      .join("\n\n");

    // Build context from memory nodes
    const memoryContext = retrieval.memoryNodes
      .map((n) => `[Memory (${n.type}, importance: ${n.importance.toFixed(2)})]: ${n.content}`)
      .join("\n");

    const augmentedQuery = [
      `## Retrieved Context`,
      retrievedContext || "(No relevant documents found)",
      ``,
      memoryContext ? `## Relevant Memories\n${memoryContext}\n` : "",
      `## Question`,
      query,
    ].filter(Boolean).join("\n");

    return {
      originalQuery: query,
      retrievedContext,
      memoryContext,
      augmentedQuery,
      sourcesUsed: retrieval.chunks.length + retrieval.memoryNodes.length,
    };
  }

  // ─── Text Chunking ─────────────────────────────────────────

  /**
   * Split text into overlapping chunks of configurable size.
   * Tries to split on paragraph/sentence boundaries when possible.
   */
  chunkText(text: string): string[] {
    const { chunkSize, chunkOverlap } = this.config;

    if (text.length <= chunkSize) {
      return [text.trim()].filter(Boolean);
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + chunkSize, text.length);

      // Try to find a natural break point (paragraph, then sentence, then word)
      if (end < text.length) {
        const slice = text.slice(start, end);
        const paragraphBreak = slice.lastIndexOf("\n\n");
        const sentenceBreak = Math.max(
          slice.lastIndexOf(". "),
          slice.lastIndexOf(".\n"),
          slice.lastIndexOf("? "),
          slice.lastIndexOf("! ")
        );
        const wordBreak = slice.lastIndexOf(" ");

        if (paragraphBreak > chunkSize * 0.5) {
          end = start + paragraphBreak + 2;
        } else if (sentenceBreak > chunkSize * 0.3) {
          end = start + sentenceBreak + 2;
        } else if (wordBreak > chunkSize * 0.3) {
          end = start + wordBreak + 1;
        }
      }

      const chunk = text.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      // Advance start, ensuring we always move forward
      const nextStart = end - chunkOverlap;
      start = nextStart > start ? nextStart : end;
      if (start >= text.length) break;
    }

    return chunks;
  }

  // ─── Stats ─────────────────────────────────────────────────

  getChunkCount(): number {
    return this.chunks.size;
  }

  getConfig(): RagConfig {
    return { ...this.config };
  }
}
