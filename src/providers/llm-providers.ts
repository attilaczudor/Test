/**
 * Multi-Provider LLM Support
 *
 * Inspired by upstream OpenClaw's model provider abstraction.
 * Supports multiple LLM backends with automatic fallback:
 *
 *   1. Ollama (local, default)
 *   2. OpenAI-compatible API (OpenAI, Together, Groq, OpenRouter)
 *   3. Anthropic Messages API (Claude)
 *   4. Google Generative AI (Gemini)
 *
 * When useCloudModels is false (default), only local backends are used.
 * Cloud providers serve as fallbacks when local models are overloaded
 * or unavailable.
 */

import { AgentMessage, LlmResponse } from "../agent/types";

// ─── Provider Types ──────────────────────────────────────────

export type ProviderType = "ollama" | "openai" | "anthropic" | "google";

export interface ProviderConfig {
  type: ProviderType;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  maxTokens?: number;
  priority: number; // lower = preferred, 0 = primary
  enabled: boolean;
}

export interface ProviderHealth {
  name: string;
  type: ProviderType;
  healthy: boolean;
  latencyMs: number;
  lastChecked: number;
  errorCount: number;
}

// ─── Provider Registry ───────────────────────────────────────

export class LlmProviderRegistry {
  private readonly providers: ProviderConfig[] = [];
  private readonly health = new Map<string, ProviderHealth>();
  private readonly MAX_ERROR_COUNT = 5;
  private readonly HEALTH_CHECK_INTERVAL = 60000;

  /**
   * Register a provider. Lower priority number = preferred.
   */
  addProvider(config: ProviderConfig): void {
    this.providers.push(config);
    this.health.set(config.name, {
      name: config.name,
      type: config.type,
      healthy: true,
      latencyMs: 0,
      lastChecked: 0,
      errorCount: 0,
    });

    // Sort by priority
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get the best available provider (lowest priority that is healthy and enabled).
   */
  getBestProvider(): ProviderConfig | null {
    for (const provider of this.providers) {
      if (!provider.enabled) {
        continue;
      }
      const h = this.health.get(provider.name);
      if (h && h.errorCount >= this.MAX_ERROR_COUNT) {
        continue;
      }
      return provider;
    }
    return null;
  }

  /**
   * Get all registered providers.
   */
  getProviders(): ProviderConfig[] {
    return [...this.providers];
  }

  /**
   * Get health info for all providers.
   */
  getHealth(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  /**
   * Record a successful request.
   */
  recordSuccess(name: string, latencyMs: number): void {
    const h = this.health.get(name);
    if (h) {
      h.healthy = true;
      h.latencyMs = latencyMs;
      h.lastChecked = Date.now();
      h.errorCount = 0;
    }
  }

  /**
   * Record a failed request.
   */
  recordError(name: string): void {
    const h = this.health.get(name);
    if (h) {
      h.errorCount++;
      h.lastChecked = Date.now();
      if (h.errorCount >= this.MAX_ERROR_COUNT) {
        h.healthy = false;
      }
    }
  }

  /**
   * Reset error counts (e.g., after a health check succeeds).
   */
  resetErrors(name: string): void {
    const h = this.health.get(name);
    if (h) {
      h.errorCount = 0;
      h.healthy = true;
    }
  }

  /**
   * Create an LlmProvider function with automatic fallback.
   * Tries providers in priority order, falling back on failure.
   */
  createProvider(): (
    messages: AgentMessage[],
    tools: unknown[],
    config: { model: string; temperature: number },
  ) => Promise<LlmResponse> {
    return async (messages, _tools, config) => {
      const errors: string[] = [];

      for (const provider of this.providers) {
        if (!provider.enabled) {
          continue;
        }
        const h = this.health.get(provider.name);
        if (h && h.errorCount >= this.MAX_ERROR_COUNT) {
          continue;
        }

        try {
          const startTime = Date.now();
          const response = await callProvider(provider, messages, config);
          this.recordSuccess(provider.name, Date.now() - startTime);
          return response;
        } catch (err: unknown) {
          this.recordError(provider.name);
          errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      throw new Error(`All LLM providers failed:\n${errors.join("\n")}`);
    };
  }
}

// ─── API Response Types ─────────────────────────────────────

/** Ollama /api/chat response shape. */
interface OllamaChatResponse {
  message?: { content?: string };
  eval_count?: number;
  prompt_eval_count?: number;
}

/** OpenAI-compatible /v1/chat/completions response shape. */
interface OpenAiChatResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

/** Anthropic /v1/messages response shape. */
interface AnthropicMessagesResponse {
  content?: Array<{ text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/** Google Generative AI generateContent response shape. */
interface GoogleGenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/** Gemini request body shape. */
interface GeminiRequestBody {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  generationConfig: { temperature: number; maxOutputTokens: number };
  systemInstruction?: { parts: Array<{ text: string }> };
}

// ─── Provider-Specific Implementations ───────────────────────

async function callProvider(
  provider: ProviderConfig,
  messages: AgentMessage[],
  config: { model: string; temperature: number },
): Promise<LlmResponse> {
  switch (provider.type) {
    case "ollama":
      return callOllama(provider, messages, config);
    case "openai":
      return callOpenAi(provider, messages, config);
    case "anthropic":
      return callAnthropic(provider, messages, config);
    case "google":
      return callGoogle(provider, messages, config);
    default:
      throw new Error(`Unknown provider type: ${String(provider.type)}`);
  }
}

/**
 * Ollama /api/chat endpoint.
 */
async function callOllama(
  provider: ProviderConfig,
  messages: AgentMessage[],
  config: { model: string; temperature: number },
): Promise<LlmResponse> {
  const url = `${provider.baseUrl}/api/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model || provider.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      options: { temperature: config.temperature ?? 0.7 },
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}`);
  }
  const data = (await res.json()) as OllamaChatResponse;

  return {
    content: data.message?.content || "",
    toolCalls: [],
    finishReason: "stop",
    usage: data.eval_count
      ? { inputTokens: data.prompt_eval_count || 0, outputTokens: data.eval_count }
      : undefined,
  };
}

/**
 * OpenAI-compatible /v1/chat/completions endpoint.
 * Works with: OpenAI, Together AI, Groq, OpenRouter, vLLM, LM Studio.
 */
async function callOpenAi(
  provider: ProviderConfig,
  messages: AgentMessage[],
  config: { model: string; temperature: number },
): Promise<LlmResponse> {
  const url = `${provider.baseUrl}/v1/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model || provider.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: config.temperature ?? 0.7,
      max_tokens: provider.maxTokens || 4096,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI-compatible API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as OpenAiChatResponse;
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content || "",
    toolCalls: [],
    finishReason: mapFinishReason(choice?.finish_reason),
    usage: data.usage
      ? {
          inputTokens: data.usage.prompt_tokens || 0,
          outputTokens: data.usage.completion_tokens || 0,
        }
      : undefined,
  };
}

/**
 * Anthropic Messages API (/v1/messages).
 */
async function callAnthropic(
  provider: ProviderConfig,
  messages: AgentMessage[],
  config: { model: string; temperature: number },
): Promise<LlmResponse> {
  const url = `${provider.baseUrl}/v1/messages`;

  // Separate system message from conversation
  const systemMessages = messages.filter((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model || provider.model,
      max_tokens: provider.maxTokens || 4096,
      system: systemMessages.map((m) => m.content).join("\n") || undefined,
      messages: chatMessages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content,
      })),
      temperature: config.temperature ?? 0.7,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as AnthropicMessagesResponse;

  return {
    content: data.content?.[0]?.text || "",
    toolCalls: [],
    finishReason: data.stop_reason === "end_turn" ? "stop" : "stop",
    usage: data.usage
      ? { inputTokens: data.usage.input_tokens || 0, outputTokens: data.usage.output_tokens || 0 }
      : undefined,
  };
}

/**
 * Google Generative AI (Gemini) via /v1beta/models/{model}:generateContent.
 */
async function callGoogle(
  provider: ProviderConfig,
  messages: AgentMessage[],
  config: { model: string; temperature: number },
): Promise<LlmResponse> {
  const model = config.model || provider.model;
  const url = `${provider.baseUrl}/v1beta/models/${model}:generateContent?key=${provider.apiKey || ""}`;

  // Convert to Gemini format
  const systemMessages = messages.filter((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const contents = chatMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: GeminiRequestBody = {
    contents,
    generationConfig: {
      temperature: config.temperature ?? 0.7,
      maxOutputTokens: provider.maxTokens || 4096,
    },
  };

  if (systemMessages.length > 0) {
    body.systemInstruction = {
      parts: [{ text: systemMessages.map((m) => m.content).join("\n") }],
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google AI HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as GoogleGenerateContentResponse;
  const candidate = data.candidates?.[0];
  const content = candidate?.content?.parts?.map((p) => p.text).join("") || "";

  return {
    content,
    toolCalls: [],
    finishReason: "stop",
    usage: data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount || 0,
          outputTokens: data.usageMetadata.candidatesTokenCount || 0,
        }
      : undefined,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function mapFinishReason(reason?: string): LlmResponse["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return "stop";
  }
}
