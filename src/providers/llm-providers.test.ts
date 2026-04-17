import { describe, it, expect, beforeEach, vi } from "vitest";
import { LlmProviderRegistry } from "./llm-providers";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("LlmProviderRegistry", () => {
  let registry: LlmProviderRegistry;

  beforeEach(() => {
    mockFetch.mockReset();
    registry = new LlmProviderRegistry();
  });

  it("should register providers and sort by priority", () => {
    registry.addProvider({
      type: "openai",
      name: "openai",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
      model: "gpt-4o",
      priority: 10,
      enabled: true,
    });

    registry.addProvider({
      type: "ollama",
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "dolphin-mistral:7b",
      priority: 0,
      enabled: true,
    });

    const providers = registry.getProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0].name).toBe("ollama"); // priority 0 first
    expect(providers[1].name).toBe("openai"); // priority 10 second
  });

  it("should return best available provider (lowest priority, healthy, enabled)", () => {
    registry.addProvider({
      type: "ollama",
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      priority: 0,
      enabled: true,
    });

    registry.addProvider({
      type: "openai",
      name: "openai",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o",
      priority: 10,
      enabled: true,
    });

    expect(registry.getBestProvider()!.name).toBe("ollama");
  });

  it("should skip disabled providers", () => {
    registry.addProvider({
      type: "ollama",
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      priority: 0,
      enabled: false,
    });

    registry.addProvider({
      type: "openai",
      name: "openai",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o",
      priority: 10,
      enabled: true,
    });

    expect(registry.getBestProvider()!.name).toBe("openai");
  });

  it("should skip providers with too many errors", () => {
    registry.addProvider({
      type: "ollama",
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      priority: 0,
      enabled: true,
    });

    // Record 5 errors (MAX_ERROR_COUNT)
    for (let i = 0; i < 5; i++) {
      registry.recordError("ollama");
    }

    registry.addProvider({
      type: "openai",
      name: "openai",
      baseUrl: "https://api.openai.com",
      model: "gpt-4o",
      priority: 10,
      enabled: true,
    });

    expect(registry.getBestProvider()!.name).toBe("openai");
  });

  it("should return null when no providers available", () => {
    expect(registry.getBestProvider()).toBeNull();
  });

  it("should track health info", () => {
    registry.addProvider({
      type: "ollama",
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      priority: 0,
      enabled: true,
    });

    registry.recordSuccess("ollama", 150);
    const health = registry.getHealth();

    expect(health).toHaveLength(1);
    expect(health[0].healthy).toBe(true);
    expect(health[0].latencyMs).toBe(150);
    expect(health[0].errorCount).toBe(0);
  });

  it("should reset errors", () => {
    registry.addProvider({
      type: "ollama",
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      priority: 0,
      enabled: true,
    });

    for (let i = 0; i < 5; i++) registry.recordError("ollama");
    expect(registry.getHealth()[0].healthy).toBe(false);

    registry.resetErrors("ollama");
    expect(registry.getHealth()[0].healthy).toBe(true);
    expect(registry.getHealth()[0].errorCount).toBe(0);
  });

  // ─── Provider Call Tests ─────────────────────────────────

  it("should call Ollama provider correctly", async () => {
    registry.addProvider({
      type: "ollama",
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "dolphin-mistral:7b",
      priority: 0,
      enabled: true,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: "Hello from Ollama!" },
        eval_count: 50,
        prompt_eval_count: 20,
      }),
    });

    const provider = registry.createProvider();
    const response = await provider(
      [{ role: "user", content: "Hi", timestamp: Date.now() }],
      [],
      { model: "dolphin-mistral:7b", temperature: 0.7 }
    );

    expect(response.content).toBe("Hello from Ollama!");
    expect(response.finishReason).toBe("stop");
    expect(response.usage?.outputTokens).toBe(50);
  });

  it("should call OpenAI provider correctly", async () => {
    registry.addProvider({
      type: "openai",
      name: "openai",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
      model: "gpt-4o",
      priority: 0,
      enabled: true,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Hello from OpenAI!" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    });

    const provider = registry.createProvider();
    const response = await provider(
      [{ role: "user", content: "Hi", timestamp: Date.now() }],
      [],
      { model: "gpt-4o", temperature: 0.7 }
    );

    expect(response.content).toBe("Hello from OpenAI!");
    expect(response.usage?.inputTokens).toBe(10);
    expect(response.usage?.outputTokens).toBe(20);

    // Verify Authorization header was sent
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer sk-test");
  });

  it("should call Anthropic provider correctly", async () => {
    registry.addProvider({
      type: "anthropic",
      name: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-5-20250929",
      priority: 0,
      enabled: true,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Hello from Claude!" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 15, output_tokens: 25 },
      }),
    });

    const provider = registry.createProvider();
    const response = await provider(
      [
        { role: "system", content: "You are helpful.", timestamp: Date.now() },
        { role: "user", content: "Hi", timestamp: Date.now() },
      ],
      [],
      { model: "claude-sonnet-4-5-20250929", temperature: 0.7 }
    );

    expect(response.content).toBe("Hello from Claude!");
    expect(response.usage?.inputTokens).toBe(15);

    // Verify Anthropic-specific headers
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[1].headers["x-api-key"]).toBe("sk-ant-test");
    expect(fetchCall[1].headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("should call Google provider correctly", async () => {
    registry.addProvider({
      type: "google",
      name: "google",
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "AIza-test",
      model: "gemini-2.0-flash",
      priority: 0,
      enabled: true,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: "Hello from Gemini!" }] },
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 15 },
      }),
    });

    const provider = registry.createProvider();
    const response = await provider(
      [{ role: "user", content: "Hi", timestamp: Date.now() }],
      [],
      { model: "gemini-2.0-flash", temperature: 0.7 }
    );

    expect(response.content).toBe("Hello from Gemini!");
    expect(response.usage?.inputTokens).toBe(10);

    // Verify API key in URL
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain("key=AIza-test");
  });

  it("should fallback to next provider on failure", async () => {
    registry.addProvider({
      type: "ollama",
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      priority: 0,
      enabled: true,
    });

    registry.addProvider({
      type: "openai",
      name: "openai-backup",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
      model: "gpt-4o",
      priority: 10,
      enabled: true,
    });

    // Ollama fails
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    // OpenAI succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Fallback response" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      }),
    });

    const provider = registry.createProvider();
    const response = await provider(
      [{ role: "user", content: "Hi", timestamp: Date.now() }],
      [],
      { model: "test", temperature: 0.7 }
    );

    expect(response.content).toBe("Fallback response");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Ollama should have an error recorded
    const health = registry.getHealth();
    const ollamaHealth = health.find((h) => h.name === "ollama");
    expect(ollamaHealth?.errorCount).toBe(1);
  });

  it("should throw when all providers fail", async () => {
    registry.addProvider({
      type: "ollama",
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      priority: 0,
      enabled: true,
    });

    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const provider = registry.createProvider();

    await expect(
      provider(
        [{ role: "user", content: "Hi", timestamp: Date.now() }],
        [],
        { model: "test", temperature: 0.7 }
      )
    ).rejects.toThrow("All LLM providers failed");
  });

  it("should handle HTTP errors from providers", async () => {
    registry.addProvider({
      type: "openai",
      name: "openai",
      baseUrl: "https://api.openai.com",
      apiKey: "sk-invalid",
      model: "gpt-4o",
      priority: 0,
      enabled: true,
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const provider = registry.createProvider();

    await expect(
      provider(
        [{ role: "user", content: "Hi", timestamp: Date.now() }],
        [],
        { model: "gpt-4o", temperature: 0.7 }
      )
    ).rejects.toThrow("All LLM providers failed");
  });
});
