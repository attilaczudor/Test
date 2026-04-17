/**
 * LoRA (Low-Rank Adaptation) Fine-Tuning Types
 *
 * Enables recursive learning: OpenClaw continuously improves its
 * local models by fine-tuning on high-quality conversation data
 * and evaluation results.
 */

export interface LoraConfig {
  /** Directory to store training data, adapters, and checkpoints */
  persistPath: string;
  /** Ollama endpoint for creating/loading LoRA models */
  ollamaEndpoint: string;
  /** Base model to fine-tune (e.g. "llama3:8b") */
  baseModel: string;
  /** LoRA rank — lower = fewer params, higher = more expressive (4-64) */
  rank: number;
  /** LoRA alpha scaling factor (typically rank * 2) */
  alpha: number;
  /** Minimum evaluation score to include in training data (0.0-1.0) */
  qualityThreshold: number;
  /** Minimum training examples before a fine-tune run */
  minTrainingExamples: number;
  /** Maximum training examples per run */
  maxTrainingExamples: number;
  /** How often to check for enough data to trigger training (ms) */
  trainingCheckInterval: number;
}

export interface TrainingExample {
  /** Unique ID for deduplication */
  id: string;
  /** System prompt that was active */
  systemPrompt?: string;
  /** User's input prompt */
  prompt: string;
  /** Model's response (high-quality only) */
  response: string;
  /** Quality score from evaluator (0.0-1.0) */
  score: number;
  /** Category of the interaction */
  category: string;
  /** Which model generated this response */
  sourceModel: string;
  /** Timestamp of the original interaction */
  timestamp: number;
}

export interface TrainingDataset {
  /** Dataset ID */
  id: string;
  /** When this dataset was created */
  createdAt: number;
  /** Number of examples */
  size: number;
  /** Path to the JSONL file */
  filePath: string;
  /** Average quality score of examples */
  averageScore: number;
  /** Categories represented */
  categories: string[];
}

export interface LoraAdapter {
  /** Adapter ID */
  id: string;
  /** Base model this adapts */
  baseModel: string;
  /** Name registered with Ollama (e.g. "openclaw-lora-v3") */
  ollamaName: string;
  /** Training dataset used */
  datasetId: string;
  /** Training hyperparameters used */
  hyperparameters: TrainingHyperparameters;
  /** Number of training examples */
  trainingExamples: number;
  /** Final training loss (lower = better fit) */
  finalLoss: number;
  /** Evaluation score after training */
  postTrainingScore: number;
  /** Version number (incremented per training run) */
  version: number;
  /** Creation timestamp */
  createdAt: number;
  /** Status */
  status: "training" | "ready" | "active" | "superseded" | "failed";
}

export interface TrainingHyperparameters {
  epochs: number;
  batchSize: number;
  learningRate: number;
  warmupRatio: number;
  weightDecay: number;
  gradientAccumulationSteps: number;
}

export interface LoraHistory {
  /** All training examples collected so far */
  examples: TrainingExample[];
  /** All datasets created */
  datasets: TrainingDataset[];
  /** All adapters trained */
  adapters: LoraAdapter[];
  /** Currently active adapter (if any) */
  activeAdapterId: string | null;
  /** Total training runs completed */
  totalTrainingRuns: number;
  lastUpdated: number;
}
