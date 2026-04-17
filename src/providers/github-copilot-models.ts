/**
 * @module providers/github-copilot-models
 *
 * Defines the default set of models available through GitHub Copilot and provides
 * a factory function to build model definition configuration objects.
 *
 * The model list is intentionally broad because Copilot model availability varies
 * by plan and organization. If a model is not available to a user, the Copilot API
 * will return an error at request time, and the user can remove it from their config.
 */

import type { ModelDefinitionConfig } from "../config/types.js";

/** Default context window size (in tokens) used for all Copilot models. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Default maximum output tokens for Copilot model responses. */
const DEFAULT_MAX_TOKENS = 8192;

// Copilot model ids vary by plan/org and can change.
// We keep this list intentionally broad; if a model isn't available Copilot will
// return an error and users can remove it from their config.
const DEFAULT_MODEL_IDS = [
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "gpt-4o",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "o1",
  "o1-mini",
  "o3-mini",
] as const;

/**
 * Returns a mutable copy of the default Copilot model ID list.
 *
 * Callers receive a fresh array so they can safely modify it (e.g., add
 * or remove model IDs) without affecting the canonical list.
 *
 * @returns An array of model ID strings.
 */
export function getDefaultCopilotModelIds(): string[] {
  return [...DEFAULT_MODEL_IDS];
}

/**
 * Builds a {@link ModelDefinitionConfig} object for a given Copilot model ID.
 *
 * The resulting definition uses the OpenAI-compatible responses API format
 * (`"openai-responses"`) because the internal coding agent registry does not
 * have a dedicated "github-copilot" API type. The provider ID remains
 * "github-copilot" at a higher level so that Copilot-specific headers and
 * authentication can be attached by the request pipeline.
 *
 * All Copilot models are registered with zero cost since billing is handled
 * by the Copilot subscription, not per-token API charges.
 *
 * @param modelId - The model identifier string (e.g. "gpt-4o", "claude-sonnet-4.5").
 * @returns A fully populated model definition configuration.
 * @throws {Error} If the provided modelId is empty or whitespace-only.
 */
export function buildCopilotModelDefinition(modelId: string): ModelDefinitionConfig {
  const id = modelId.trim();
  if (!id) {
    throw new Error("Model id required");
  }
  return {
    id,
    name: id,
    // pi-coding-agent's registry schema doesn't know about a "github-copilot" API.
    // We use OpenAI-compatible responses API, while keeping the provider id as
    // "github-copilot" (pi-ai uses that to attach Copilot-specific headers).
    api: "openai-responses",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}
