import { describe, it, expect, afterEach, vi } from "vitest";
import { Council } from "./council";
import {
  CouncilConfig,
  FlatCouncilConfig,
  CouncilMember,
  CouncilPrompt,
} from "./types";
import {
  calculateResources,
  OPENCLAW_COUNCIL,
  HOMELAB_COUNCIL,
  CODING_FLAT,
  MINIMAL_FLAT,
} from "./presets";
import {
  parseModelParams,
  sizeForModel,
  sizeForDirector,
  calculateTieredResources,
} from "./model-sizing";

// Mock fetch for testing (simulates Ollama responses)
const originalFetch = global.fetch;

function mockFetch(responses: Record<string, string>) {
  let callCount = 0;
  const keys = Object.keys(responses);

  global.fetch = vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => {
      const key = keys[callCount % keys.length];
      const content = responses[key] || "Mock response [confidence: 0.7]";
      callCount++;
      return {
        message: { content },
        choices: [{ message: { content } }],
      };
    },
  })) as any;
}

afterEach(() => {
  global.fetch = originalFetch;
});

// ─── Model Sizing ──────────────────────────────────────────────

describe("Model Sizing", () => {
  describe("parseModelParams", () => {
    it("should parse known models", () => {
      expect(parseModelParams("mistral:7b")).toBe(7.0);
      expect(parseModelParams("phi:3.8b")).toBe(3.8);
      expect(parseModelParams("tinyllama:1.1b")).toBe(1.1);
      expect(parseModelParams("mixtral:8x7b-instruct")).toBe(47.0);
    });

    it("should extract params from unknown model names", () => {
      expect(parseModelParams("some-model:13b-q4")).toBe(13);
      expect(parseModelParams("custom:6.7b-instruct")).toBe(6.7);
    });

    it("should parse MoE patterns", () => {
      expect(parseModelParams("foo:4x7b")).toBe(28);
    });

    it("should return null for unrecognizable models", () => {
      expect(parseModelParams("mystery-model")).toBeNull();
    });
  });

  describe("sizeForModel", () => {
    it("should size a 7B model correctly", () => {
      const sizing = sizeForModel("mistral:7b");
      // RAM: (7 × 0.6 + 1.5) × 1024 = 5734 → round to 6144 MB
      expect(sizing.memoryMb).toBeGreaterThanOrEqual(5632);
      expect(sizing.memoryMb).toBeLessThanOrEqual(6144);
      expect(sizing.cores).toBe(4);
      expect(sizing.diskGb).toBeGreaterThanOrEqual(8);
    });

    it("should size a small model (1.1B) with less RAM", () => {
      const sizing = sizeForModel("tinyllama:1.1b");
      expect(sizing.memoryMb).toBeLessThanOrEqual(3072);
      expect(sizing.cores).toBe(2);
    });

    it("should size a large model (34B) with more RAM", () => {
      const sizing = sizeForModel("codellama:34b");
      expect(sizing.memoryMb).toBeGreaterThanOrEqual(20480);
      expect(sizing.cores).toBe(8);
    });

    it("should account for quantization", () => {
      const q4 = sizeForModel("mistral:7b", "Q4_K_M");
      const fp16 = sizeForModel("mistral:7b", "FP16");
      expect(fp16.memoryMb).toBeGreaterThan(q4.memoryMb);
    });

    it("should return defaults for unknown models", () => {
      const sizing = sizeForModel("totally-unknown");
      expect(sizing.memoryMb).toBe(8192);
      expect(sizing.cores).toBe(4);
    });
  });

  describe("sizeForDirector", () => {
    it("should add extra overhead for VM", () => {
      const base = sizeForModel("mistral:7b");
      const director = sizeForDirector("mistral:7b");
      expect(director.memoryMb).toBe(base.memoryMb + 2048);
      expect(director.diskGb).toBe(base.diskGb + 5);
    });
  });

  describe("calculateTieredResources", () => {
    it("should sum all tiers for openclaw council", () => {
      const res = calculateTieredResources(OPENCLAW_COUNCIL);
      expect(res.total.containerCount).toBe(8); // 1 director + 2 coords + 5 specialists
      expect(res.total.memoryMb).toBeGreaterThan(50000); // >50 GB
    });
  });
});

// ─── 3-Tier Hierarchical Council ───────────────────────────────

describe("Council (3-Tier Hierarchical)", () => {
  function createTieredCouncil(): Council {
    const council = new Council(OPENCLAW_COUNCIL);

    // Tier 1: Director
    council.addMember(
      { name: "director", role: "director", model: "dolphin-mixtral:8x7b-v2.6", backend: "ollama", speciality: "Orchestration" },
      "http://10.0.0.302:11434",
      1
    );

    // Tier 2: Logical coordinator
    council.addMember(
      { name: "logical-lead", role: "logical", model: "nous-hermes2:34b", backend: "ollama", speciality: "Code reasoning" },
      "http://10.0.0.303:11434",
      2,
      "logical"
    );

    // Tier 3: Logical specialist
    council.addMember(
      { name: "coder", role: "coder", model: "codebooga:34b", backend: "ollama", speciality: "Code generation" },
      "http://10.0.0.304:11434",
      3,
      "logical"
    );

    // Tier 2: Creative coordinator
    council.addMember(
      { name: "creative-lead", role: "creative", model: "nous-hermes2:10.7b", backend: "ollama", speciality: "Creative ideas" },
      "http://10.0.0.307:11434",
      2,
      "creative"
    );

    // Tier 3: Creative specialist
    council.addMember(
      { name: "brainstormer", role: "brainstormer", model: "openhermes:7b", backend: "ollama", speciality: "Quick validation" },
      "http://10.0.0.308:11434",
      3,
      "creative"
    );

    return council;
  }

  describe("member management", () => {
    it("should add members with tiers and branches", () => {
      const council = createTieredCouncil();
      expect(council.getMembers()).toHaveLength(5);
      expect(council.getReadyMembers()).toHaveLength(5);
    });

    it("should get director", () => {
      const council = createTieredCouncil();
      const director = council.getDirector();
      expect(director).toBeDefined();
      expect(director!.tier).toBe(1);
      expect(director!.role).toBe("director");
    });

    it("should get branch coordinators", () => {
      const council = createTieredCouncil();
      const logical = council.getBranchCoordinator("logical");
      const creative = council.getBranchCoordinator("creative");
      expect(logical).toBeDefined();
      expect(logical!.tier).toBe(2);
      expect(creative).toBeDefined();
      expect(creative!.branch).toBe("creative");
    });

    it("should get specialists by branch", () => {
      const council = createTieredCouncil();
      const logicalSpecs = council.getSpecialists("logical");
      const creativeSpecs = council.getSpecialists("creative");
      expect(logicalSpecs).toHaveLength(1);
      expect(creativeSpecs).toHaveLength(1);
      expect(logicalSpecs[0].tier).toBe(3);
    });

    it("should get members by tier", () => {
      const council = createTieredCouncil();
      expect(council.getMembersByTier(1)).toHaveLength(1);
      expect(council.getMembersByTier(2)).toHaveLength(2);
      expect(council.getMembersByTier(3)).toHaveLength(2);
    });

    it("should remove members", () => {
      const council = createTieredCouncil();
      const members = council.getMembers();
      council.removeMember(members[4].id);
      expect(council.getMembers()).toHaveLength(4);
    });

    it("should assign VM type for tier 1, LXC for others", () => {
      const council = createTieredCouncil();
      const director = council.getDirector();
      expect(director!.containerType).toBe("vm");

      const specialist = council.getSpecialists("logical")[0];
      expect(specialist.containerType).toBe("lxc");
    });
  });

  describe("hierarchical deliberation", () => {
    it("should run 3-tier flow: decompose → branch → synthesize", async () => {
      const council = createTieredCouncil();
      mockFetch({
        default: "LOGICAL: Analyze the code structure\nCREATIVE: Explore alternative designs [confidence: 0.8]",
      });

      const result = await council.deliberate({
        id: "test-h1",
        question: "How should we design the API?",
      });

      // Should be a CouncilResult (not FlatCouncilResult)
      expect("directorSynthesis" in result).toBe(true);
      const tieredResult = result as any;
      expect(tieredResult.directorSynthesis).toBeTruthy();
      expect(tieredResult.branches).toBeDefined();
      expect(tieredResult.tierBreakdown).toBeDefined();
      expect(tieredResult.participantCount).toBe(5);
    });

    it("should run both branches in parallel", async () => {
      const council = createTieredCouncil();
      mockFetch({
        default: "Analysis result [confidence: 0.75]",
      });

      const result = await council.deliberate({
        id: "test-h2",
        question: "Optimize this algorithm",
      }) as any;

      expect(result.branches).toHaveLength(2);
      expect(result.branches.map((b: any) => b.branch).sort()).toEqual(["creative", "logical"]);
    });

    it("should route to specific branch when required", async () => {
      const council = createTieredCouncil();
      mockFetch({
        default: "Logical analysis [confidence: 0.8]",
      });

      const result = await council.deliberate({
        id: "test-h3",
        question: "Find bugs in this code",
        requiredBranch: "logical",
      }) as any;

      expect(result.branches).toHaveLength(1);
      expect(result.branches[0].branch).toBe("logical");
    });

    it("should include tier breakdown timing", async () => {
      const council = createTieredCouncil();
      mockFetch({ default: "Response [confidence: 0.7]" });

      const result = await council.deliberate({
        id: "test-h4",
        question: "Test",
      }) as any;

      expect(result.tierBreakdown).toBeDefined();
      expect(result.tierBreakdown.tier1DurationMs).toBeGreaterThanOrEqual(0);
      expect(result.tierBreakdown.tier2DurationMs).toBeGreaterThanOrEqual(0);
      expect(result.tierBreakdown.tier3DurationMs).toBeGreaterThanOrEqual(0);
    });

    it("should emit events", async () => {
      const council = createTieredCouncil();
      mockFetch({ default: "Answer [confidence: 0.7]" });

      const events: string[] = [];
      council.on("deliberationStart", () => events.push("start"));
      council.on("branchStart", () => events.push("branch"));
      council.on("branchComplete", () => events.push("branchDone"));
      council.on("deliberationComplete", () => events.push("complete"));

      await council.deliberate({ id: "test-h5", question: "Test" });

      expect(events).toContain("start");
      expect(events).toContain("branch");
      expect(events).toContain("complete");
    });
  });

  describe("error handling", () => {
    it("should error when no members are ready", async () => {
      const council = new Council(OPENCLAW_COUNCIL);

      await expect(
        council.deliberate({ id: "test-e1", question: "Test" })
      ).rejects.toThrow("No council members are ready");
    });

    it("should handle member errors gracefully", async () => {
      const council = createTieredCouncil();
      global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const result = await council.deliberate({
        id: "test-e2",
        question: "Test",
      }) as any;

      // Should still return a result with error content
      expect(result.directorSynthesis).toBeTruthy();
    });

    it("should error when provisioning without Proxmox", async () => {
      const council = new Council(OPENCLAW_COUNCIL);

      await expect(council.provision()).rejects.toThrow(
        "ProxmoxManager not set"
      );
    });
  });

  describe("dynamic Tier 3 scaling", () => {
    it("should error when spawning without Proxmox", async () => {
      const council = createTieredCouncil();

      await expect(
        council.spawnSpecialist(
          { name: "extra", role: "coder", model: "phi:3.8b", backend: "ollama", speciality: "Extra" },
          "logical"
        )
      ).rejects.toThrow("ProxmoxManager not set");
    });

    it("should track pool maxInstances from config", () => {
      expect(OPENCLAW_COUNCIL.branches.logical.pool).toBeDefined();
      expect(OPENCLAW_COUNCIL.branches.logical.pool!.maxInstances).toBe(8);
      expect(OPENCLAW_COUNCIL.branches.creative.pool).toBeDefined();
      expect(OPENCLAW_COUNCIL.branches.creative.pool!.maxInstances).toBe(6);
    });

    it("should have pool templates available", () => {
      const pool = OPENCLAW_COUNCIL.branches.logical.pool!;
      expect(pool.templates).toHaveLength(2);
      expect(pool.templates[0].role).toBe("coder");
      expect(pool.scalePolicy).toBe("per-task");
    });
  });
});

// ─── Flat (Legacy) Council ─────────────────────────────────────

describe("Council (Flat/Legacy)", () => {
  function createFlatCouncil(
    strategy: FlatCouncilConfig["strategy"] = "parallel"
  ): Council {
    const council = new Council({
      strategy,
      maxRounds: 2,
      consensusThreshold: 0.7,
      timeoutMs: 5000,
      members: [],
    });

    council.addMember(
      { name: "reasoner", role: "generalist", model: "mistral:7b", backend: "ollama", speciality: "General reasoning" },
      "http://10.0.0.1:11434"
    );
    council.addMember(
      { name: "critic", role: "critic", model: "phi:3.8b", backend: "ollama", speciality: "Finding flaws", weight: 1.2 },
      "http://10.0.0.2:11434"
    );
    council.addMember(
      { name: "synthesizer", role: "logical", model: "solar:10.7b", backend: "ollama", speciality: "Combining insights" },
      "http://10.0.0.3:11434"
    );

    return council;
  }

  describe("parallel strategy", () => {
    it("should query all members and synthesize", async () => {
      const council = createFlatCouncil("parallel");
      mockFetch({
        reasoner: "The answer is 42 [confidence: 0.8]",
        critic: "Consider edge cases [confidence: 0.6]",
        synthesizer: "Combined answer [confidence: 0.75]",
      });

      const result = await council.deliberate({
        id: "flat-1",
        question: "What is the meaning of life?",
      });

      expect("synthesis" in result).toBe(true);
      const flat = result as any;
      expect(flat.strategy).toBe("parallel");
      expect(flat.rounds).toHaveLength(1);
      expect(flat.participantCount).toBe(3);
      expect(flat.synthesis).toBeTruthy();
    });
  });

  describe("debate strategy", () => {
    it("should run multiple rounds", async () => {
      const council = createFlatCouncil("debate");
      mockFetch({ default: "I think X [confidence: 0.8]" });

      const result = await council.deliberate({
        id: "flat-2",
        question: "How should we design the API?",
      }) as any;

      expect(result.strategy).toBe("debate");
      expect(result.rounds.length).toBeGreaterThanOrEqual(1);
      expect(result.synthesis).toBeTruthy();
    });
  });

  describe("chain strategy", () => {
    it("should pass through members sequentially", async () => {
      const council = createFlatCouncil("chain");
      let callOrder: string[] = [];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const host = new URL(url).hostname;
        callOrder.push(host);
        return {
          ok: true,
          json: async () => ({
            message: { content: `Refined from ${host} [confidence: 0.8]` },
          }),
        };
      });

      const result = await council.deliberate({
        id: "flat-3",
        question: "Write a sorting algorithm",
      }) as any;

      expect(result.strategy).toBe("chain");
      expect(result.rounds).toHaveLength(3);
      expect(result.synthesis).toContain("Refined");
    });
  });

  describe("judge strategy", () => {
    it("should have contestants then judge", async () => {
      const council = createFlatCouncil("judge");
      mockFetch({ default: "My answer is X [confidence: 0.7]" });

      const result = await council.deliberate({
        id: "flat-4",
        question: "What is the best framework?",
      }) as any;

      expect(result.strategy).toBe("judge");
      expect(result.rounds).toHaveLength(2);
    });
  });

  describe("majority_vote strategy", () => {
    it("should collect votes and pick a winner", async () => {
      const council = createFlatCouncil("majority_vote");
      mockFetch({ default: "Option 1 is best. 1 [confidence: 0.7]" });

      const result = await council.deliberate({
        id: "flat-5",
        question: "Which database?",
      }) as any;

      expect(result.strategy).toBe("majority_vote");
      expect(result.votes).toBeDefined();
      expect(result.synthesis).toBeTruthy();
    });
  });
});

// ─── Escalation Evaluation ────────────────────────────────────

describe("Council evaluateEscalation", () => {
  it("should use heuristic fallback when no director is available", async () => {
    const council = new Council({
      strategy: "parallel" as any,
      maxRounds: 1,
      consensusThreshold: 0.7,
      timeoutMs: 5000,
      members: [],
    });

    // Low confidence → should escalate
    const result = await council.evaluateEscalation({
      originalQuestion: "Complex quantum computing question",
      localResponse: "I'm not sure about that",
      localConfidence: 0.2,
      localProvider: "ollama",
      detectedComplexity: 0.9,
      reason: "low_confidence",
    });

    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain("No council director available");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should keep local when heuristic determines response is adequate", async () => {
    const council = new Council({
      strategy: "parallel" as any,
      maxRounds: 1,
      consensusThreshold: 0.7,
      timeoutMs: 5000,
      members: [],
    });

    // Higher confidence → should not escalate
    const result = await council.evaluateEscalation({
      originalQuestion: "What color is the sky?",
      localResponse: "The sky is blue due to Rayleigh scattering",
      localConfidence: 0.5,
      localProvider: "ollama",
      detectedComplexity: 0.1,
      reason: "low_confidence",
    });

    expect(result.shouldEscalate).toBe(false);
    expect(result.reason).toContain("acceptable");
  });

  it("should use director for evaluation when available", async () => {
    const council = new Council(OPENCLAW_COUNCIL);

    // Add a director member
    council.addMember(
      OPENCLAW_COUNCIL.director,
      "http://10.0.0.10:11434",
      1,
      undefined
    );

    mockFetch({
      director: "DECISION: KEEP_LOCAL\nREASON: The local response adequately addresses the question.\n[confidence: 0.7]",
    });

    const result = await council.evaluateEscalation({
      originalQuestion: "Simple factual question",
      localResponse: "Here is the factual answer",
      localConfidence: 0.55,
      localProvider: "ollama",
      detectedComplexity: 0.2,
      reason: "low_confidence",
    });

    expect(result.shouldEscalate).toBe(false);
    expect(result.reason).toContain("adequately");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should escalate when director recommends it", async () => {
    const council = new Council(OPENCLAW_COUNCIL);

    // Set approval callback that auto-approves for this test
    council.setCloudApprovalCallback(async () => true);

    council.addMember(
      OPENCLAW_COUNCIL.director,
      "http://10.0.0.10:11434",
      1,
      undefined
    );

    mockFetch({
      director: "DECISION: ESCALATE\nREASON: This requires advanced multi-step reasoning beyond local model capability.\n[confidence: 0.4]",
    });

    const result = await council.evaluateEscalation({
      originalQuestion: "Design a distributed consensus algorithm",
      localResponse: "I think maybe you could use something like Raft?",
      localConfidence: 0.25,
      localProvider: "ollama",
      detectedComplexity: 0.85,
      reason: "task_complexity",
    });

    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toContain("reasoning");
    expect(result.userApproved).toBe(true);
  });

  it("should block escalation when user denies approval", async () => {
    const council = new Council(OPENCLAW_COUNCIL);

    // User denies cloud escalation
    council.setCloudApprovalCallback(async () => false);

    council.addMember(
      OPENCLAW_COUNCIL.director,
      "http://10.0.0.10:11434",
      1,
      undefined
    );

    mockFetch({
      director: "DECISION: ESCALATE\nREASON: This requires cloud LLM.\n[confidence: 0.4]",
    });

    const result = await council.evaluateEscalation({
      originalQuestion: "Complex question",
      localResponse: "Basic answer",
      localConfidence: 0.25,
      localProvider: "ollama",
      detectedComplexity: 0.85,
      reason: "task_complexity",
    });

    // Director wanted to escalate, but user denied it
    expect(result.shouldEscalate).toBe(false);
    expect(result.userApproved).toBe(false);
  });

  it("should handle director errors gracefully", async () => {
    const council = new Council(OPENCLAW_COUNCIL);

    council.addMember(
      OPENCLAW_COUNCIL.director,
      "http://10.0.0.10:11434",
      1,
      undefined
    );

    // Director call fails
    global.fetch = vi.fn().mockRejectedValue(new Error("Network timeout")) as any;

    const result = await council.evaluateEscalation({
      originalQuestion: "Test question",
      localResponse: "Test answer",
      localConfidence: 0.5,
      localProvider: "ollama",
      detectedComplexity: 0.5,
      reason: "low_confidence",
    });

    // Should not escalate on error (conservative default)
    expect(result.shouldEscalate).toBe(false);
    expect(result.reason.toLowerCase()).toContain("error");
  });
});

// ─── Presets ───────────────────────────────────────────────────

describe("Council Presets", () => {
  it("should calculate resources for openclaw council", () => {
    const res = calculateResources(OPENCLAW_COUNCIL);
    expect(res.memberCount).toBe(8);
    expect(res.totalMemoryMb).toBeGreaterThan(50000);
  });

  it("should have HOMELAB_COUNCIL as alias for OPENCLAW_COUNCIL", () => {
    expect(HOMELAB_COUNCIL).toBe(OPENCLAW_COUNCIL);
  });

  it("should calculate resources for flat coding preset", () => {
    const res = calculateResources(CODING_FLAT);
    expect(res.memberCount).toBe(3);
    expect(res.totalCores).toBeGreaterThan(0);
  });

  it("should calculate resources for flat minimal preset", () => {
    const res = calculateResources(MINIMAL_FLAT);
    expect(res.memberCount).toBe(2);
  });

  it("should have valid tiered preset with uncensored models", () => {
    expect(OPENCLAW_COUNCIL.director.model).toContain("dolphin-mixtral");
    expect(OPENCLAW_COUNCIL.director.cores).toBe(4);
  });

  it("should have valid flat presets", () => {
    expect(CODING_FLAT.strategy).toBe("chain");
    expect(MINIMAL_FLAT.strategy).toBe("judge");
  });

  it("should cap total cores at 16", () => {
    const dir = OPENCLAW_COUNCIL.director.cores || 0;
    const logical = OPENCLAW_COUNCIL.branches.logical;
    const creative = OPENCLAW_COUNCIL.branches.creative;
    let totalCores = dir;
    totalCores += logical.coordinator.cores || 0;
    for (const s of logical.specialists) totalCores += s.cores || 0;
    totalCores += creative.coordinator.cores || 0;
    for (const s of creative.specialists) totalCores += s.cores || 0;
    expect(totalCores).toBe(16);
  });

  it("should have requireCloudApproval enabled", () => {
    expect(OPENCLAW_COUNCIL.requireCloudApproval).toBe(true);
  });

  it("should have memoryConfig defined", () => {
    expect(OPENCLAW_COUNCIL.memoryConfig).toBeDefined();
    expect(OPENCLAW_COUNCIL.memoryConfig!.vectorBackend).toBe("memory");
    expect(OPENCLAW_COUNCIL.memoryConfig!.graphBackend).toBe("memory");
  });

  it("should have personality definitions on all members", () => {
    expect(OPENCLAW_COUNCIL.director.personality).toBeDefined();
    expect(OPENCLAW_COUNCIL.director.personality!.title).toBe("Chief Intelligence Officer");
    for (const [, branch] of Object.entries(OPENCLAW_COUNCIL.branches)) {
      expect(branch.coordinator.personality).toBeDefined();
      expect(branch.coordinator.personality!.title.length).toBeGreaterThan(0);
      for (const spec of branch.specialists) {
        expect(spec.personality).toBeDefined();
        expect(spec.personality!.traits).toBeDefined();
      }
    }
  });
});

// ─── Council Memory ──────────────────────────────────────────────

import { CouncilMemoryManager } from "./council-memory";
import { createDefaultMetrics, createDefaultMemory, TIER_CONSTRAINTS } from "./types";

describe("CouncilMemoryManager", () => {
  it("should register and retrieve members", () => {
    const mm = new CouncilMemoryManager();
    const state = mm.registerMember("m1", "Director", 1);
    expect(state.memberId).toBe("m1");
    expect(state.memberName).toBe("Director");
    expect(state.tier).toBe(1);
    expect(state.knowledge).toHaveLength(0);
    mm.dispose();
  });

  it("should add and search knowledge", () => {
    const mm = new CouncilMemoryManager();
    mm.registerMember("m1", "Director", 1);
    mm.addKnowledge("m1", "Python is a great language for data science", "interaction", 0.8, ["python"]);
    mm.addKnowledge("m1", "Rust is fast and memory safe", "interaction", 0.7, ["rust"]);
    mm.addKnowledge("m1", "The weather is nice today", "interaction", 0.3);

    const results = mm.searchKnowledge("m1", "python data");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("Python");
    mm.dispose();
  });

  it("should track metrics per member", () => {
    const mm = new CouncilMemoryManager();
    mm.registerMember("m1", "Coder", 3, "logical");
    mm.recordQuery("m1", 150, 0.85, false);
    mm.recordQuery("m1", 200, 0.75, false);
    mm.recordQuery("m1", 100, 0, true);

    const metrics = mm.getMetrics("m1")!;
    expect(metrics.totalQueries).toBe(3);
    expect(metrics.errorCount).toBe(1);
    expect(metrics.avgConfidence).toBeGreaterThan(0);
    mm.dispose();
  });

  it("should preserve memory across model swaps", () => {
    const mm = new CouncilMemoryManager();
    mm.registerMember("m1", "Director", 1);
    mm.addKnowledge("m1", "Important fact about the codebase", "interaction", 0.9);
    mm.recordModelSwap("m1", "old-model:7b", "new-model:13b");

    // Knowledge should still be there
    const results = mm.searchKnowledge("m1", "codebase");
    expect(results.length).toBeGreaterThan(0);
    // Metrics should be reset
    const metrics = mm.getMetrics("m1")!;
    expect(metrics.totalQueries).toBe(0);
    // Swap should be recorded as knowledge
    const swapEntries = mm.searchKnowledge("m1", "swapped");
    expect(swapEntries.length).toBeGreaterThan(0);
    mm.dispose();
  });

  it("should recommend swap for poorly performing models", () => {
    const mm = new CouncilMemoryManager();
    mm.registerMember("m1", "BadModel", 3);
    // Not enough queries yet
    expect(mm.shouldRecommendSwap("m1")).toBe(false);
    // Simulate many errors
    for (let i = 0; i < 15; i++) {
      mm.recordQuery("m1", 100, 0, true);
    }
    expect(mm.shouldRecommendSwap("m1")).toBe(true);
    mm.dispose();
  });

  it("should generate member context from knowledge", () => {
    const mm = new CouncilMemoryManager();
    mm.registerMember("m1", "Writer", 3, "creative");
    mm.addKnowledge("m1", "The user prefers concise documentation", "interaction", 0.9);
    mm.addKnowledge("m1", "Markdown is the standard format", "interaction", 0.7);

    const context = mm.getMemberContext("m1", 5);
    expect(context).toContain("documentation");
    expect(context).toContain("Markdown");
    mm.dispose();
  });

  it("should track LoRA adapters per member", () => {
    const mm = new CouncilMemoryManager();
    mm.registerMember("m1", "Coder", 3);
    mm.setLoraAdapter("m1", "lora-coder-v2");
    expect(mm.getLoraAdapter("m1")).toBe("lora-coder-v2");
    mm.dispose();
  });

  it("should provide stats", () => {
    const mm = new CouncilMemoryManager();
    mm.registerMember("m1", "Director", 1);
    mm.registerMember("m2", "Logical", 2, "logical");
    mm.addKnowledge("m1", "Fact 1", "interaction");
    mm.addKnowledge("m2", "Fact 2", "interaction");

    const stats = mm.getStats();
    expect(stats.totalMembers).toBe(2);
    expect(stats.totalKnowledgeEntries).toBe(2);
    expect(stats.memberStats).toHaveLength(2);
    mm.dispose();
  });
});

// ─── Tier Constraints ──────────────────────────────────────────

describe("Tier Constraints", () => {
  it("should define valid constraints for all tiers", () => {
    expect(TIER_CONSTRAINTS[1].minModelSizeB).toBe(3);
    expect(TIER_CONSTRAINTS[1].maxModelSizeB).toBe(70);
    expect(TIER_CONSTRAINTS[1].maxMembers).toBe(1);

    expect(TIER_CONSTRAINTS[2].minModelSizeB).toBe(2);
    expect(TIER_CONSTRAINTS[2].maxModelSizeB).toBe(20);
    expect(TIER_CONSTRAINTS[2].minMembers).toBe(2);
    expect(TIER_CONSTRAINTS[2].maxMembers).toBe(5);

    expect(TIER_CONSTRAINTS[3].minModelSizeB).toBe(0.5);
    expect(TIER_CONSTRAINTS[3].maxModelSizeB).toBe(7);
    expect(TIER_CONSTRAINTS[3].maxMembers).toBe(10);
  });
});

// ─── Flexible Branches ──────────────────────────────────────────

describe("Flexible Branch Architecture", () => {
  it("should support custom branch names beyond logical/creative", () => {
    const config: CouncilConfig = {
      name: "test-custom-branches",
      maxRounds: 2,
      consensusThreshold: 0.7,
      timeoutMs: 30000,
      director: {
        name: "director",
        role: "director",
        model: "test-model:7b",
        backend: "ollama",
        speciality: "Test director",
      },
      branches: {
        engineering: {
          coordinator: { name: "eng-lead", role: "logical", model: "test:7b", backend: "ollama", speciality: "Engineering" },
          specialists: [
            { name: "backend-dev", role: "coder", model: "test:3b", backend: "ollama", speciality: "Backend" },
          ],
        },
        security: {
          coordinator: { name: "sec-lead", role: "reviewer", model: "test:7b", backend: "ollama", speciality: "Security" },
          specialists: [
            { name: "pen-tester", role: "reviewer", model: "test:3b", backend: "ollama", speciality: "Penetration testing" },
          ],
        },
        research: {
          coordinator: { name: "research-lead", role: "generalist", model: "test:7b", backend: "ollama", speciality: "Research" },
          specialists: [],
        },
      },
    };

    const council = new Council(config);
    // Add members manually for testing
    council.addMember(config.director, "http://localhost:11434", 1);
    for (const [branch, bc] of Object.entries(config.branches)) {
      council.addMember(bc.coordinator, "http://localhost:11434", 2, branch);
      for (const spec of bc.specialists) {
        council.addMember(spec, "http://localhost:11434", 3, branch);
      }
    }

    expect(council.getBranches()).toContain("engineering");
    expect(council.getBranches()).toContain("security");
    expect(council.getBranches()).toContain("research");
    expect(council.getMembersByBranch("engineering")).toHaveLength(2);
    expect(council.getMembersByBranch("security")).toHaveLength(2);
    expect(council.getMembersByBranch("research")).toHaveLength(1);
    expect(council.getMembersByTier(1)).toHaveLength(1);
    expect(council.getMembersByTier(2)).toHaveLength(3);
    expect(council.getMembersByTier(3)).toHaveLength(2);
  });

  it("should calculate resources for flexible branches", () => {
    const res = calculateTieredResources(OPENCLAW_COUNCIL);
    // Should have entries for both logical and creative branches
    expect(res.tier2).toHaveProperty("logical");
    expect(res.tier2).toHaveProperty("creative");
    expect(res.tier1.cores).toBeGreaterThanOrEqual(4);
    expect(res.total.containerCount).toBeGreaterThan(5);
  });
});

// ─── Model Swap ─────────────────────────────────────────────────

describe("Model Swap", () => {
  it("should swap a member's model and preserve role", async () => {
    const council = new Council(OPENCLAW_COUNCIL);
    const member = council.addMember(
      OPENCLAW_COUNCIL.director,
      "http://localhost:11434",
      1,
    );

    expect(member.model).toBe("dolphin-mixtral:8x7b-v2.6");

    const result = await council.swapModel({
      memberId: member.id,
      newModel: "nous-hermes2-mixtral:8x7b",
      reason: "Testing swap",
    });

    expect(result.success).toBe(true);
    expect(result.oldModel).toBe("dolphin-mixtral:8x7b-v2.6");
    expect(result.newModel).toBe("nous-hermes2-mixtral:8x7b");
    expect(result.memoryPreserved).toBe(true);

    // The member's model should be updated
    const updated = council.getMember(member.id)!;
    expect(updated.model).toBe("nous-hermes2-mixtral:8x7b");
    expect(updated.previousModels).toContain("dolphin-mixtral:8x7b-v2.6");
    // Role and personality should be preserved
    expect(updated.role).toBe("director");
    expect(updated.personality.title).toBe("Chief Intelligence Officer");
  });

  it("should fail swap for non-existent member", async () => {
    const council = new Council(OPENCLAW_COUNCIL);
    const result = await council.swapModel({
      memberId: "nonexistent",
      newModel: "test:7b",
      reason: "test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});

// ─── Council Lifecycle ──────────────────────────────────────────

describe("Council Lifecycle", () => {
  it("should start and stop", async () => {
    const council = new Council(OPENCLAW_COUNCIL);
    expect(council.isRunning).toBe(false);
    await council.startCouncil();
    expect(council.isRunning).toBe(true);
    await council.stopCouncil();
    expect(council.isRunning).toBe(false);
  });

  it("should restart", async () => {
    const council = new Council(OPENCLAW_COUNCIL);
    await council.startCouncil();
    expect(council.isRunning).toBe(true);
    await council.restartCouncil();
    expect(council.isRunning).toBe(true);
  });
});
