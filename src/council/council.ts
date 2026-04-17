import * as crypto from "crypto";
import { EventEmitter } from "events";
import { ProxmoxManager } from "../infra/proxmox.js";
import { CouncilMemoryManager } from "./council-memory.js";
import { sizeForDirector, sizeForModel } from "./model-sizing.js";
import {
  BranchResult,
  BranchType,
  CloudApprovalRequest,
  CouncilConfig,
  CouncilMember,
  CouncilMemberSpec,
  CouncilPrompt,
  CouncilResult,
  CouncilRole,
  CouncilVote,
  FlatCouncilConfig,
  FlatCouncilResult,
  MemberPersonality,
  MemberResponse,
  ModelSwapRequest,
  ModelSwapResult,
  Tier,
  createDefaultMemory,
  createDefaultMetrics,
} from "./types.js";

/**
 * LLM Council — Flexible 3-Tier Hierarchical Deliberation Engine
 *
 * The council represents an "individual person" whose thinking is
 * distributed across three tiers of LLMs:
 *
 * Tier 1 (Director): 1 LLM (3–70B) — decomposes prompts, synthesizes
 *         final answers, makes executive decisions. Smart and fast.
 *
 * Tier 2 (Branches): 2–5 coordinators (2–20B) — any expertise type,
 *         defined by personality and job description. Not limited to
 *         "logical" and "creative".
 *
 * Tier 3 (Specialists): Up to 10 per parent (0.5–7B) — small, focused
 *         models. Each an expert in its field.
 *
 * All members have persistent memory (vector DB, graph, RAG, LoRA) that
 * survives model swaps. Change the model, keep the knowledge.
 *
 * Cloud escalation requires explicit user approval when configured.
 */
export class Council extends EventEmitter {
  private readonly members = new Map<string, CouncilMember>();
  private tieredConfig: CouncilConfig | null = null;
  private flatConfig: FlatCouncilConfig | null = null;
  private proxmox: ProxmoxManager | null = null;
  private memoryManager: CouncilMemoryManager | null = null;
  private cloudApprovalCallback: ((req: CloudApprovalRequest) => Promise<boolean>) | null = null;
  private _running = false;

  constructor(config: CouncilConfig | FlatCouncilConfig) {
    super();
    if ("director" in config) {
      this.tieredConfig = config;
      if (config.memoryConfig) {
        this.memoryManager = new CouncilMemoryManager(config.memoryConfig);
      }
    } else {
      this.flatConfig = config;
    }
  }

  get isRunning(): boolean {
    return this._running;
  }

  setProxmox(proxmox: ProxmoxManager): void {
    this.proxmox = proxmox;
  }

  setMemoryManager(manager: CouncilMemoryManager): void {
    this.memoryManager = manager;
  }

  getMemoryManager(): CouncilMemoryManager | null {
    return this.memoryManager;
  }

  /**
   * Set callback for cloud escalation approval.
   * When the director recommends cloud, this callback is called
   * and the user must approve before escalation proceeds.
   */
  setCloudApprovalCallback(cb: (req: CloudApprovalRequest) => Promise<boolean>): void {
    this.cloudApprovalCallback = cb;
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  async startCouncil(): Promise<void> {
    this._running = true;
    this.emit("councilStarted", { members: this.getMembers().length });
  }

  async stopCouncil(): Promise<void> {
    this._running = false;
    if (this.memoryManager) {
      this.memoryManager.saveToDisk();
    }
    this.emit("councilStopped");
  }

  async restartCouncil(): Promise<void> {
    await this.stopCouncil();
    // Reset all member statuses
    for (const m of this.members.values()) {
      if (m.status !== "offline") {
        m.status = "ready";
      }
    }
    await this.startCouncil();
    this.emit("councilRestarted");
  }

  // ─── Provisioning ───────────────────────────────────────────

  async provision(): Promise<CouncilMember[]> {
    if (!this.proxmox) {
      throw new Error("ProxmoxManager not set. Call setProxmox() first.");
    }

    if (this.tieredConfig) {
      return this.provisionTiered();
    }

    return this.provisionFlat();
  }

  private async provisionTiered(): Promise<CouncilMember[]> {
    const cfg = this.tieredConfig!;
    const results: CouncilMember[] = [];

    // Tier 1: Director (VM)
    const director = await this.provisionMember(cfg.director, 1, undefined, "vm");
    results.push(director);

    // Tier 2 + 3: Iterate all branches (flexible — any names)
    for (const [branchName, branchConfig] of Object.entries(cfg.branches)) {
      const coord = await this.provisionMember(branchConfig.coordinator, 2, branchName, "lxc");
      director.children.push(coord.id);
      results.push(coord);

      for (const spec of branchConfig.specialists) {
        const specialist = await this.provisionMember(spec, 3, branchName, "lxc");
        coord.children.push(specialist.id);
        results.push(specialist);
      }
    }

    return results;
  }

  private async provisionFlat(): Promise<CouncilMember[]> {
    const results: CouncilMember[] = [];
    for (const spec of this.flatConfig!.members) {
      const member = await this.provisionMember(spec, 3, undefined, "lxc");
      results.push(member);
    }
    return results;
  }

  private async provisionMember(
    spec: CouncilMemberSpec,
    tier: Tier,
    branch: BranchType | undefined,
    containerType: "vm" | "lxc",
  ): Promise<CouncilMember> {
    const sizing = tier === 1 ? sizeForDirector(spec.model) : sizeForModel(spec.model);

    const member = this.createMember(spec, tier, branch, containerType);
    this.members.set(member.id, member);
    this.emit("memberProvisioning", member);

    // Register in memory manager
    if (this.memoryManager) {
      this.memoryManager.registerMember(member.id, member.name, tier, branch);
    }

    try {
      const instance = await this.proxmox!.createLlmContainer({
        name: `council-${spec.name}`,
        model: spec.model,
        backend: spec.backend,
        purpose: `Tier ${tier} ${spec.role}: ${spec.speciality}`,
        cores: spec.cores || sizing.cores,
        memoryMb: spec.memoryMb || sizing.memoryMb,
        diskGb: spec.diskGb || sizing.diskGb,
      });

      member.containerId = instance.id;
      member.endpoint = `http://${instance.ip}:${instance.port}`;
      member.status = "ready";
      this.emit("memberReady", member);
    } catch (err: unknown) {
      member.status = "error";
      this.emit("memberError", { member, error: err instanceof Error ? err.message : String(err) });
    }

    return member;
  }

  // ─── Manual member management ───────────────────────────────

  addMember(
    spec: CouncilMemberSpec,
    endpoint: string,
    tier: Tier = 3,
    branch?: BranchType,
  ): CouncilMember {
    const containerType = tier === 1 ? "vm" : "lxc";
    const member = this.createMember(spec, tier, branch, containerType);
    member.endpoint = endpoint;
    member.status = "ready";
    this.members.set(member.id, member);

    // Register in memory manager
    if (this.memoryManager) {
      this.memoryManager.registerMember(member.id, member.name, tier, branch);
    }

    return member;
  }

  removeMember(id: string): boolean {
    if (this.memoryManager) {
      this.memoryManager.unregisterMember(id);
    }
    for (const m of this.members.values()) {
      const idx = m.children.indexOf(id);
      if (idx >= 0) {
        m.children.splice(idx, 1);
      }
    }
    return this.members.delete(id);
  }

  getMembers(): CouncilMember[] {
    return Array.from(this.members.values());
  }

  getReadyMembers(): CouncilMember[] {
    return this.getMembers().filter((m) => m.status === "ready");
  }

  getMembersByTier(tier: Tier): CouncilMember[] {
    return this.getMembers().filter((m) => m.tier === tier);
  }

  getMembersByBranch(branch: BranchType): CouncilMember[] {
    return this.getMembers().filter((m) => m.branch === branch);
  }

  getDirector(): CouncilMember | undefined {
    return this.getMembers().find((m) => m.tier === 1);
  }

  getBranchCoordinator(branch: BranchType): CouncilMember | undefined {
    return this.getMembers().find((m) => m.tier === 2 && m.branch === branch);
  }

  getSpecialists(branch: BranchType): CouncilMember[] {
    return this.getMembers().filter((m) => m.tier === 3 && m.branch === branch);
  }

  getBranches(): string[] {
    const branches = new Set<string>();
    for (const m of this.members.values()) {
      if (m.branch) {
        branches.add(m.branch);
      }
    }
    return Array.from(branches);
  }

  getMember(id: string): CouncilMember | undefined {
    return this.members.get(id);
  }

  // ─── Model Swapping ─────────────────────────────────────────

  /**
   * Swap a member's model. Preserves all memory and knowledge.
   * The member personality stays the same — only the LLM changes.
   */
  async swapModel(request: ModelSwapRequest): Promise<ModelSwapResult> {
    const member = this.members.get(request.memberId);
    if (!member) {
      return {
        memberId: request.memberId,
        oldModel: "",
        newModel: request.newModel,
        memoryPreserved: false,
        success: false,
        error: "Member not found",
      };
    }

    const oldModel = member.model;
    const oldStatus = member.status;
    member.status = "provisioning";

    try {
      // Record the swap in memory manager
      if (this.memoryManager) {
        this.memoryManager.recordModelSwap(member.id, oldModel, request.newModel);
      }

      // Update the member
      member.previousModels.push(oldModel);
      member.model = request.newModel;
      if (request.newBackend) {
        member.backend = request.newBackend;
      }

      // If we have Proxmox, swap the actual container
      if (this.proxmox && member.containerId) {
        try {
          await this.proxmox.destroyInstance(member.containerId);
          const sizing =
            member.tier === 1 ? sizeForDirector(request.newModel) : sizeForModel(request.newModel);
          const instance = await this.proxmox.createLlmContainer({
            name: `council-${member.name}`,
            model: request.newModel,
            backend: member.backend,
            purpose: `Tier ${member.tier} model swap: ${request.reason}`,
            cores: sizing.cores,
            memoryMb: sizing.memoryMb,
            diskGb: sizing.diskGb,
          });
          member.containerId = instance.id;
          member.endpoint = `http://${instance.ip}:${instance.port}`;
        } catch (err: unknown) {
          member.status = "error";
          return {
            memberId: member.id,
            oldModel,
            newModel: request.newModel,
            memoryPreserved: true,
            success: false,
            error: `Container swap failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      member.status = "ready";
      this.emit("modelSwapped", {
        memberId: member.id,
        name: member.name,
        tier: member.tier,
        oldModel,
        newModel: request.newModel,
        reason: request.reason,
      });

      return {
        memberId: member.id,
        oldModel,
        newModel: request.newModel,
        memoryPreserved: true,
        success: true,
      };
    } catch (err: unknown) {
      member.model = oldModel;
      member.status = oldStatus;
      return {
        memberId: member.id,
        oldModel,
        newModel: request.newModel,
        memoryPreserved: true,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ─── Dynamic Tier 3 Scaling ─────────────────────────────────

  async spawnSpecialist(spec: CouncilMemberSpec, branch: BranchType): Promise<CouncilMember> {
    if (!this.proxmox) {
      throw new Error("ProxmoxManager not set. Cannot spawn specialists without Proxmox.");
    }

    const branchConfig = this.tieredConfig?.branches[branch];
    const pool = branchConfig?.pool;

    if (pool) {
      const currentCount = this.getSpecialists(branch).length;
      if (currentCount >= pool.maxInstances) {
        throw new Error(`Branch "${branch}" already at max specialists (${pool.maxInstances})`);
      }
    }

    const member = await this.provisionMember(spec, 3, branch, "lxc");

    const coordinator = this.getBranchCoordinator(branch);
    if (coordinator) {
      coordinator.children.push(member.id);
    }

    this.emit("specialistSpawned", { branch, member });
    return member;
  }

  async scaleUp(branch: BranchType, count: number = 1): Promise<CouncilMember[]> {
    const branchConfig = this.tieredConfig?.branches[branch];
    if (!branchConfig?.pool) {
      throw new Error(`No specialist pool defined for branch "${branch}"`);
    }

    const pool = branchConfig.pool;
    const currentCount = this.getSpecialists(branch).length;
    const available = pool.maxInstances - currentCount;
    const toSpawn = Math.min(count, available);

    if (toSpawn <= 0) {
      return [];
    }

    const results: CouncilMember[] = [];
    for (let i = 0; i < toSpawn; i++) {
      const template = pool.templates[i % pool.templates.length];
      const spec = {
        ...template,
        name: `${template.name}-${currentCount + i}`,
      };
      const member = await this.spawnSpecialist(spec, branch);
      results.push(member);
    }

    this.emit("scaleUp", { branch, added: results.length, total: currentCount + results.length });
    return results;
  }

  async scaleDown(branch: BranchType, count: number = 1): Promise<number> {
    if (!this.proxmox) {
      throw new Error("ProxmoxManager not set");
    }

    const specialists = this.getSpecialists(branch).filter((m) => m.status === "ready");

    const toRemove = Math.min(count, specialists.length);
    let removed = 0;

    for (let i = specialists.length - 1; i >= Math.max(0, specialists.length - toRemove); i--) {
      const member = specialists[i];
      try {
        if (member.containerId) {
          await this.proxmox.destroyInstance(member.containerId);
        }
        this.removeMember(member.id);
        removed++;
        this.emit("specialistRemoved", { branch, member });
      } catch (err) {
        console.error("[council] Failed to remove specialist member:", err);
      }
    }

    this.emit("scaleDown", { branch, removed, remaining: this.getSpecialists(branch).length });
    return removed;
  }

  async ensureMinSpecialists(branch: BranchType, min: number): Promise<CouncilMember[]> {
    const current = this.getSpecialists(branch).length;
    if (current >= min) {
      return [];
    }
    return this.scaleUp(branch, min - current);
  }

  // ─── Escalation Evaluation ─────────────────────────────────

  /**
   * Lightweight escalation check — uses only the Director (Tier 1).
   *
   * When requireCloudApproval is enabled, and the director recommends
   * escalation, this method emits a 'cloudApprovalRequired' event
   * and waits for the user's response before proceeding.
   */
  async evaluateEscalation(request: {
    originalQuestion: string;
    localResponse: string;
    localConfidence: number;
    localProvider: string;
    detectedComplexity: number;
    reason: string;
  }): Promise<{
    shouldEscalate: boolean;
    reason: string;
    suggestedProvider?: string;
    suggestedModel?: string;
    confidence: number;
    durationMs: number;
    userApproved?: boolean;
  }> {
    const startTime = Date.now();
    const director = this.getDirector();

    // Heuristic fallback when no director
    if (!director || director.status !== "ready") {
      const shouldEscalate = request.localConfidence < 0.3 || request.detectedComplexity > 0.8;
      return {
        shouldEscalate,
        reason: shouldEscalate
          ? `No council director available. Auto-escalating: confidence=${request.localConfidence.toFixed(2)}, complexity=${request.detectedComplexity.toFixed(2)}`
          : `No council director available. Local response acceptable: confidence=${request.localConfidence.toFixed(2)}`,
        confidence: request.localConfidence,
        durationMs: Date.now() - startTime,
      };
    }

    const evaluationPrompt = [
      `You are the Director of an LLM council. A local model has answered a user's question,`,
      `but the system detected potential issues. Evaluate whether we should escalate to a`,
      `cloud LLM (OpenAI/Anthropic/Google) for a better answer.`,
      ``,
      `IMPORTANT: Cloud LLMs cost money and send data externally. Only recommend escalation`,
      `when the local response is genuinely inadequate — not just imperfect.`,
      ``,
      `── User's Question ──`,
      request.originalQuestion,
      ``,
      `── Local Model Response (${request.localProvider}) ──`,
      request.localResponse.slice(0, 1500),
      ``,
      `── Assessment ──`,
      `Confidence: ${request.localConfidence.toFixed(2)}`,
      `Complexity: ${request.detectedComplexity.toFixed(2)}`,
      `Flag reason: ${request.reason}`,
      ``,
      `── Your Decision ──`,
      `Reply in this exact format:`,
      `DECISION: ESCALATE or KEEP_LOCAL`,
      `REASON: <one sentence explaining why>`,
      `[confidence: X.X]`,
    ].join("\n");

    try {
      const response = await this.queryMember(director, evaluationPrompt, undefined, 0);

      const decisionMatch = response.content.match(/DECISION:\s*(ESCALATE|KEEP_LOCAL)/i);
      const reasonMatch = response.content.match(/REASON:\s*(.+?)(?:\n|$)/i);

      let shouldEscalate = decisionMatch
        ? decisionMatch[1].toUpperCase() === "ESCALATE"
        : request.localConfidence < 0.3;

      const reason = reasonMatch?.[1]?.trim() || response.content.slice(0, 200);

      // Cloud approval gate: if director wants to escalate and approval is required
      let userApproved: boolean | undefined;
      if (shouldEscalate && this.tieredConfig?.requireCloudApproval) {
        const approvalReq: CloudApprovalRequest = {
          requestId: `esc-${Date.now()}`,
          question: request.originalQuestion,
          localResponse: request.localResponse.slice(0, 500),
          localConfidence: request.localConfidence,
          directorReason: reason,
        };

        this.emit("cloudApprovalRequired", approvalReq);

        if (this.cloudApprovalCallback) {
          userApproved = await this.cloudApprovalCallback(approvalReq);
          if (!userApproved) {
            shouldEscalate = false;
          }
        } else {
          // No callback — block escalation (require explicit approval)
          shouldEscalate = false;
          userApproved = false;
        }
      }

      return {
        shouldEscalate,
        reason,
        confidence: response.confidence,
        durationMs: Date.now() - startTime,
        userApproved,
      };
    } catch (err: unknown) {
      return {
        shouldEscalate: false,
        reason: `Council evaluation error: ${err instanceof Error ? err.message : String(err)}. Keeping local response.`,
        confidence: request.localConfidence,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ─── Deliberation ───────────────────────────────────────────

  async deliberate(prompt: CouncilPrompt): Promise<CouncilResult | FlatCouncilResult> {
    if (this.tieredConfig) {
      return this.deliberateHierarchical(prompt);
    }
    return this.deliberateFlat(prompt);
  }

  /**
   * 3-tier hierarchical deliberation with flexible N branches.
   */
  private async deliberateHierarchical(prompt: CouncilPrompt): Promise<CouncilResult> {
    const startTime = Date.now();
    const allRounds: MemberResponse[][] = [];

    const director = this.getDirector();
    const readyMembers = this.getReadyMembers();

    if (readyMembers.length === 0) {
      throw new Error("No council members are ready");
    }

    this.emit("deliberationStart", {
      promptId: prompt.id,
      mode: "hierarchical",
      participants: readyMembers.length,
    });

    // Determine which branches to run
    const allBranches = Object.keys(this.tieredConfig!.branches);
    const branchesToRun: string[] = prompt.requiredBranch ? [prompt.requiredBranch] : allBranches;

    // ── Step 1: Director decomposes the prompt ──
    const tier1Start = Date.now();
    let decomposition: Record<string, string>;

    if (director && director.status === "ready") {
      const branchList = branchesToRun.map((b) => {
        const coord = this.getBranchCoordinator(b);
        const personality = coord?.personality;
        const desc = personality
          ? `${b} (${personality.title}: ${personality.expertise.join(", ")})`
          : b;
        return desc;
      });

      const decomposePrompt = [
        `You are the Director of an LLM council. Decompose the following task into ${branchesToRun.length} sub-questions,`,
        `one for each branch:`,
        ...branchesToRun.map(
          (b, i) => `${i + 1}. A "${b.toUpperCase()}" sub-question for the ${branchList[i]} branch`,
        ),
        ``,
        `Task: ${prompt.question}`,
        prompt.context ? `\nContext: ${prompt.context}` : "",
        ``,
        `Reply in this exact format:`,
        ...branchesToRun.map((b) => `${b.toUpperCase()}: <the sub-question for ${b}>`),
      ].join("\n");

      // Include director's memory context
      const directorContext = this.memoryManager
        ? this.memoryManager.getMemberContext(director.id, 10)
        : "";
      const fullContext = directorContext
        ? `${directorContext}\n\n${prompt.context || ""}`
        : prompt.context;

      const directorResponse = await this.queryMember(director, decomposePrompt, fullContext, 0);
      allRounds.push([directorResponse]);

      decomposition = this.parseDecomposition(
        directorResponse.content,
        prompt.question,
        branchesToRun,
      );
    } else {
      decomposition = {};
      for (const branch of branchesToRun) {
        decomposition[branch] = `Analyze this from a ${branch} perspective: ${prompt.question}`;
      }
    }

    const tier1Duration = Date.now() - tier1Start;

    // ── Step 2: Branches dispatch to specialists (parallel) ──
    const tier3Start = Date.now();
    const branchResults: BranchResult[] = [];

    const branchPromises = branchesToRun.map((branch) =>
      this.runBranch(branch, decomposition[branch], prompt, allRounds),
    );
    const branchOutcomes = await Promise.all(branchPromises);
    branchResults.push(...branchOutcomes);

    const tier3Duration = Date.now() - tier3Start;

    // ── Step 3: Director synthesizes branch results ──
    const tier2Start = Date.now();
    let directorSynthesis: string;
    let confidence: number;

    if (director && director.status === "ready") {
      const branchSummaries = branchResults
        .map((br) =>
          [
            `=== ${br.branch.toUpperCase()} BRANCH (confidence: ${br.confidence.toFixed(2)}) ===`,
            br.consolidatedAnswer,
          ].join("\n"),
        )
        .join("\n\n");

      const synthesisPrompt = [
        `You are the Director. The council has deliberated on this question:`,
        `"${prompt.question}"`,
        ``,
        `Here are the consolidated results from each branch:`,
        ``,
        branchSummaries,
        ``,
        `Synthesize these into one final, authoritative answer. Combine the best`,
        `insights from all branches. Note any important disagreements.`,
        `Rate your confidence [confidence: X.X].`,
      ].join("\n");

      const synthResponse = await this.queryMember(director, synthesisPrompt, undefined, 2);
      allRounds.push([synthResponse]);
      directorSynthesis = synthResponse.content;
      confidence = synthResponse.confidence;
    } else {
      directorSynthesis = branchResults
        .map((br) => `[${br.branch}]: ${br.consolidatedAnswer}`)
        .join("\n\n");
      confidence = branchResults.reduce((sum, br) => sum + br.confidence, 0) / branchResults.length;
    }

    const tier2Duration = Date.now() - tier2Start;
    const totalDuration = Date.now() - startTime;

    // Store knowledge from this deliberation
    if (this.memoryManager && director) {
      this.memoryManager.addKnowledge(
        director.id,
        `Q: ${prompt.question.slice(0, 200)}\nA: ${directorSynthesis.slice(0, 500)}`,
        "council",
        confidence,
        ["deliberation"],
      );
    }

    const result: CouncilResult = {
      promptId: prompt.id,
      directorSynthesis,
      branches: branchResults,
      rounds: allRounds,
      confidence,
      participantCount: readyMembers.length,
      totalDurationMs: totalDuration,
      tierBreakdown: {
        tier1DurationMs: tier1Duration + tier2Duration,
        tier2DurationMs: branchResults.reduce((s, br) => s + br.coordinatorResponse.durationMs, 0),
        tier3DurationMs: tier3Duration,
      },
    };

    this.emit("deliberationComplete", result);
    return result;
  }

  /**
   * Run a single branch: dispatch to specialists, then consolidate.
   */
  private async runBranch(
    branch: BranchType,
    question: string,
    prompt: CouncilPrompt,
    allRounds: MemberResponse[][],
  ): Promise<BranchResult> {
    // Auto-scale Tier 3 if pool has "per-task" policy
    const branchConfig = this.tieredConfig?.branches[branch];
    if (branchConfig?.pool?.scalePolicy === "per-task" && this.proxmox) {
      const currentCount = this.getSpecialists(branch).length;
      if (currentCount < branchConfig.pool.maxInstances) {
        try {
          await this.scaleUp(branch, branchConfig.pool.maxInstances - currentCount);
        } catch {
          // Non-fatal
        }
      }
    }

    const coordinator = this.getBranchCoordinator(branch);
    const specialists = this.getSpecialists(branch).filter((m) => m.status === "ready");

    this.emit("branchStart", { branch, specialists: specialists.length });

    // Tier 3: All specialists answer in parallel
    const specialistResponses = await Promise.all(
      specialists.map((m) =>
        this.queryMember(m, `[${branch} branch task] ${question}`, prompt.context, 1),
      ),
    );

    if (specialistResponses.length > 0) {
      allRounds.push(specialistResponses);
    }

    // Tier 2: Coordinator consolidates specialist answers
    let coordinatorResponse: MemberResponse;
    let consolidatedAnswer: string;
    let confidence: number;

    if (coordinator && coordinator.status === "ready") {
      const specialistSummary = specialistResponses
        .map(
          (r) =>
            `[${r.memberName} (${r.role}, confidence ${r.confidence.toFixed(2)})]: ${r.content}`,
        )
        .join("\n\n");

      const consolidatePrompt =
        specialistSummary.length > 0
          ? [
              `You are the ${branch} branch coordinator.`,
              `Your specialists have answered the following question:`,
              `"${question}"`,
              ``,
              `Specialist responses:`,
              specialistSummary,
              ``,
              `Consolidate these into a single, clear answer for the Director.`,
              `Highlight the strongest points and resolve contradictions.`,
              `Rate your confidence [confidence: X.X].`,
            ].join("\n")
          : question;

      coordinatorResponse = await this.queryMember(coordinator, consolidatePrompt, undefined, 1);
      consolidatedAnswer = coordinatorResponse.content;
      confidence = coordinatorResponse.confidence;
    } else {
      const best = specialistResponses.toSorted((a, b) => b.confidence - a.confidence)[0];
      coordinatorResponse = best || {
        memberId: "none",
        memberName: "none",
        role: branch as CouncilRole,
        tier: 2 as Tier,
        branch,
        content: "No responses available",
        confidence: 0,
        round: 1,
        durationMs: 0,
      };
      consolidatedAnswer = coordinatorResponse.content;
      confidence = coordinatorResponse.confidence;
    }

    this.emit("branchComplete", { branch, confidence });

    return {
      branch,
      coordinatorResponse,
      specialistResponses,
      consolidatedAnswer,
      confidence,
    };
  }

  // ─── Flat (legacy) strategies ───────────────────────────────

  private async deliberateFlat(prompt: CouncilPrompt): Promise<FlatCouncilResult> {
    const startTime = Date.now();
    const readyMembers = this.getReadyMembers();

    if (readyMembers.length === 0) {
      throw new Error("No council members are ready");
    }

    const participants = prompt.requiredBranch
      ? readyMembers.filter((m) => m.branch === prompt.requiredBranch)
      : readyMembers;

    if (participants.length === 0) {
      throw new Error("No members match the required filter");
    }

    this.emit("deliberationStart", {
      promptId: prompt.id,
      strategy: this.flatConfig!.strategy,
      participants: participants.length,
    });

    let result: FlatCouncilResult;

    switch (this.flatConfig!.strategy) {
      case "debate":
        result = await this.runDebate(prompt, participants);
        break;
      case "chain":
        result = await this.runChain(prompt, participants);
        break;
      case "judge":
        result = await this.runJudge(prompt, participants);
        break;
      case "majority_vote":
        result = await this.runMajorityVote(prompt, participants);
        break;
      case "parallel":
      default:
        result = await this.runParallel(prompt, participants);
        break;
    }

    result.totalDurationMs = Date.now() - startTime;
    this.emit("deliberationComplete", result);
    return result;
  }

  private async runParallel(
    prompt: CouncilPrompt,
    members: CouncilMember[],
  ): Promise<FlatCouncilResult> {
    const responses = await Promise.all(
      members.map((m) => this.queryMember(m, prompt.question, prompt.context, 0)),
    );

    const synthesis = await this.synthesize(prompt, [responses]);

    return {
      promptId: prompt.id,
      strategy: "parallel",
      rounds: [responses],
      synthesis: synthesis.content,
      confidence: synthesis.confidence,
      participantCount: members.length,
      totalDurationMs: 0,
    };
  }

  private async runDebate(
    prompt: CouncilPrompt,
    members: CouncilMember[],
  ): Promise<FlatCouncilResult> {
    const allRounds: MemberResponse[][] = [];
    let context = prompt.context || "";
    const maxRounds = this.flatConfig?.maxRounds || 2;
    const threshold = this.flatConfig?.consensusThreshold || 0.7;

    for (let round = 0; round < maxRounds; round++) {
      const roundPrompt =
        round === 0 ? prompt.question : this.buildDebatePrompt(prompt.question, allRounds, round);

      const responses = await Promise.all(
        members.map((m) => this.queryMember(m, roundPrompt, context, round)),
      );

      allRounds.push(responses);

      if (round > 0 && this.checkConsensus(responses, threshold)) {
        break;
      }

      context = responses.map((r) => `[${r.memberName} (${r.role})]: ${r.content}`).join("\n\n");
    }

    const votes = await this.conductVote(members, allRounds);
    const synthesis = await this.synthesize(prompt, allRounds);
    const dissent = this.extractDissent(allRounds);

    return {
      promptId: prompt.id,
      strategy: "debate",
      rounds: allRounds,
      votes,
      synthesis: synthesis.content,
      confidence: synthesis.confidence,
      participantCount: members.length,
      totalDurationMs: 0,
      dissent,
    };
  }

  private async runChain(
    prompt: CouncilPrompt,
    members: CouncilMember[],
  ): Promise<FlatCouncilResult> {
    const allRounds: MemberResponse[][] = [];
    let currentAnswer = "";

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const personalityDesc = member.personality
        ? `${member.personality.title} (${member.personality.expertise.join(", ")})`
        : `${member.personality.title}`;

      const chainPrompt =
        i === 0
          ? prompt.question
          : `Original question: ${prompt.question}\n\nPrevious answer:\n${currentAnswer}\n\nYour role as ${personalityDesc}: Review, improve, and refine this answer.`;

      const response = await this.queryMember(member, chainPrompt, prompt.context, i);
      allRounds.push([response]);
      currentAnswer = response.content;
    }

    return {
      promptId: prompt.id,
      strategy: "chain",
      rounds: allRounds,
      synthesis: currentAnswer,
      confidence: allRounds[allRounds.length - 1]?.[0]?.confidence || 0.5,
      participantCount: members.length,
      totalDurationMs: 0,
    };
  }

  private async runJudge(
    prompt: CouncilPrompt,
    members: CouncilMember[],
  ): Promise<FlatCouncilResult> {
    const judgeIdx = members.findIndex(
      (m) =>
        m.personality.title.toLowerCase().includes("critic") ||
        m.personality.title.toLowerCase().includes("judge") ||
        m.tier === 1,
    );
    const judge = judgeIdx >= 0 ? members[judgeIdx] : members[members.length - 1];
    const contestants = members.filter((m) => m.id !== judge.id);

    const responses = await Promise.all(
      contestants.map((m) => this.queryMember(m, prompt.question, prompt.context, 0)),
    );

    const judgePrompt = this.buildJudgePrompt(prompt.question, responses);
    const judgeResponse = await this.queryMember(judge, judgePrompt, prompt.context, 1);

    return {
      promptId: prompt.id,
      strategy: "judge",
      rounds: [responses, [judgeResponse]],
      synthesis: judgeResponse.content,
      confidence: judgeResponse.confidence,
      participantCount: members.length,
      totalDurationMs: 0,
    };
  }

  private async runMajorityVote(
    prompt: CouncilPrompt,
    members: CouncilMember[],
  ): Promise<FlatCouncilResult> {
    const responses = await Promise.all(
      members.map((m) => this.queryMember(m, prompt.question, prompt.context, 0)),
    );

    const votes = await this.conductVote(members, [responses]);

    const voteCounts = new Map<string, number>();
    for (const vote of votes) {
      const member = this.members.get(vote.memberId);
      const weight = member?.weight || 1;
      const current = voteCounts.get(vote.selectedResponseId) || 0;
      voteCounts.set(vote.selectedResponseId, current + weight);
    }

    let winnerId = responses[0].memberId;
    let maxVotes = 0;
    for (const [id, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        winnerId = id;
      }
    }

    const winner = responses.find((r) => r.memberId === winnerId);

    return {
      promptId: prompt.id,
      strategy: "majority_vote",
      rounds: [responses],
      votes,
      synthesis: winner?.content || responses[0].content,
      confidence: maxVotes / members.length,
      participantCount: members.length,
      totalDurationMs: 0,
    };
  }

  // ─── Query helpers ──────────────────────────────────────────

  private async queryMember(
    member: CouncilMember,
    question: string,
    context: string | undefined,
    round: number,
  ): Promise<MemberResponse> {
    const startTime = Date.now();
    member.status = "busy";

    const tierLabel =
      member.tier === 1 ? "Director" : member.tier === 2 ? "Branch Coordinator" : "Specialist";
    const personality = member.personality;

    const systemParts = [
      `You are "${member.name}", a ${tierLabel} in an LLM council.`,
      `Title: ${personality.title}. Expertise: ${personality.expertise.join(", ")}.`,
      personality.description ? `Persona: ${personality.description}` : "",
      member.tier === 1 ? `You orchestrate the entire council and make final decisions.` : "",
      member.tier === 2
        ? `You coordinate the ${member.branch} branch specialists and consolidate their answers.`
        : "",
      member.tier === 3
        ? `You are a ${member.branch} branch specialist. Give focused, expert answers in your domain.`
        : "",
      `Communication style: ${personality.traits.style}. ` +
        `Verbosity: ${(personality.traits.verbosity * 100).toFixed(0)}%. ` +
        `Rigor: ${(personality.traits.rigor * 100).toFixed(0)}%.`,
      `Be concise but thorough. Rate your confidence [confidence: X.X].`,
    ];

    const systemPrompt = systemParts.filter(Boolean).join(" ");

    // Include member's memory context if available
    let fullContext = context;
    if (this.memoryManager) {
      const memCtx = this.memoryManager.getMemberContext(member.id, 10);
      if (memCtx) {
        fullContext = memCtx + (context ? `\n\n${context}` : "");
      }
    }

    const messages = [{ role: "system", content: systemPrompt }];
    if (fullContext) {
      messages.push({ role: "user", content: `Context:\n${fullContext}` });
    }
    messages.push({ role: "user", content: question });

    try {
      const response = await this.callEndpoint(member, messages);
      member.status = "ready";

      const conf = this.extractConfidence(response);
      const durationMs = Date.now() - startTime;

      // Track metrics
      if (this.memoryManager) {
        this.memoryManager.recordQuery(member.id, durationMs, conf, false);
      }

      return {
        memberId: member.id,
        memberName: member.name,
        role: member.role,
        tier: member.tier,
        branch: member.branch,
        content: response,
        confidence: conf,
        round,
        durationMs,
      };
    } catch (err: unknown) {
      member.status = "ready";
      const durationMs = Date.now() - startTime;

      // Track error metrics
      if (this.memoryManager) {
        this.memoryManager.recordQuery(member.id, durationMs, 0, true);
      }

      return {
        memberId: member.id,
        memberName: member.name,
        role: member.role,
        tier: member.tier,
        branch: member.branch,
        content: `[Error: ${err instanceof Error ? err.message : String(err)}]`,
        confidence: 0,
        round,
        durationMs,
      };
    }
  }

  private async callEndpoint(
    member: CouncilMember,
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    let url: string;
    let body: unknown;

    if (member.backend === "ollama") {
      url = `${member.endpoint}/api/chat`;
      body = { model: member.model, messages, stream: false };
    } else {
      url = `${member.endpoint}/v1/chat/completions`;
      body = { model: member.model, messages, temperature: 0.7, max_tokens: 2048 };
    }

    const timeoutMs = this.tieredConfig?.timeoutMs || this.flatConfig?.timeoutMs || 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        message?: { content?: string };
        choices?: Array<{ message?: { content?: string } }>;
      };

      return member.backend === "ollama"
        ? data.message?.content || ""
        : data.choices?.[0]?.message?.content || "";
    } catch (err: unknown) {
      clearTimeout(timeout);
      throw err;
    }
  }

  // ─── Synthesis & voting helpers ─────────────────────────────

  private async synthesize(
    prompt: CouncilPrompt,
    allRounds: MemberResponse[][],
  ): Promise<{ content: string; confidence: number }> {
    const synthesizer =
      this.getReadyMembers().find((m) => m.tier === 1 || m.tier === 2) || this.getReadyMembers()[0];

    if (!synthesizer) {
      const lastRound = allRounds[allRounds.length - 1] || [];
      return {
        content: lastRound.map((r) => r.content).join("\n\n---\n\n"),
        confidence: 0.5,
      };
    }

    const allResponses = allRounds.flat();
    const summary = allResponses
      .map((r) => `[${r.memberName} (${r.role}, confidence ${r.confidence})]:\n${r.content}`)
      .join("\n\n---\n\n");

    const synthesisPrompt = [
      `Original question: ${prompt.question}\n\n`,
      `Council responses:\n\n${summary}\n\n`,
      `Synthesize the best insights into a single answer. Note disagreements. [confidence: X.X]`,
    ].join("");

    const response = await this.queryMember(
      synthesizer,
      synthesisPrompt,
      prompt.context,
      allRounds.length,
    );
    return { content: response.content, confidence: response.confidence };
  }

  private async conductVote(
    members: CouncilMember[],
    allRounds: MemberResponse[][],
  ): Promise<CouncilVote[]> {
    const lastRound = allRounds[allRounds.length - 1] || [];
    if (lastRound.length <= 1) {
      return [];
    }

    const votes: CouncilVote[] = [];
    const options = lastRound
      .map((r, i) => `Option ${i + 1} (by ${r.memberName}): ${r.content.slice(0, 200)}...`)
      .join("\n\n");

    for (const member of members) {
      const votePrompt = `Vote for the best response:\n\n${options}\n\nReply with ONLY the option number and a brief reason.`;

      try {
        const response = await this.queryMember(member, votePrompt, undefined, -1);
        const optionMatch = response.content.match(/(\d+)/);
        const selectedIdx = optionMatch
          ? Math.min(parseInt(optionMatch[1]) - 1, lastRound.length - 1)
          : 0;

        votes.push({
          memberId: member.id,
          selectedResponseId: lastRound[Math.max(0, selectedIdx)].memberId,
          reason: response.content,
        });
      } catch {
        // Skip on error
      }
    }

    return votes;
  }

  // ─── Prompt builders ────────────────────────────────────────

  private parseDecomposition(
    directorOutput: string,
    fallback: string,
    branches: string[],
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const branch of branches) {
      const regex = new RegExp(`${branch.toUpperCase()}:\\s*(.+?)(?:\\n|$)`, "i");
      const match = directorOutput.match(regex);
      result[branch] = match?.[1]?.trim() || `Analyze from a ${branch} perspective: ${fallback}`;
    }

    return result;
  }

  private buildDebatePrompt(
    originalQuestion: string,
    previousRounds: MemberResponse[][],
    currentRound: number,
  ): string {
    const lastRound = previousRounds[previousRounds.length - 1] || [];
    const otherViews = lastRound
      .map((r) => `${r.memberName} (${r.role}): ${r.content}`)
      .join("\n\n");

    return [
      `Original question: ${originalQuestion}\n\n`,
      `Round ${currentRound}. Other members said:\n\n${otherViews}\n\n`,
      `Consider their arguments. Refine your position.`,
    ].join("");
  }

  private buildJudgePrompt(question: string, responses: MemberResponse[]): string {
    const options = responses
      .map((r, i) => `Response ${i + 1} (by ${r.memberName}, ${r.role}):\n${r.content}`)
      .join("\n\n---\n\n");

    return [
      `You are the judge. Question: "${question}"\n\n`,
      `Responses:\n\n${options}\n\n`,
      `Evaluate each for accuracy, completeness, clarity. Select the best or synthesize.`,
    ].join("");
  }

  private checkConsensus(responses: MemberResponse[], threshold: number): boolean {
    if (responses.length < 2) {
      return true;
    }
    const avg = responses.reduce((sum, r) => sum + r.confidence, 0) / responses.length;
    return avg >= threshold;
  }

  private extractDissent(allRounds: MemberResponse[][]): string[] {
    const lastRound = allRounds[allRounds.length - 1] || [];
    return lastRound
      .filter((r) => r.confidence < 0.4)
      .map((r) => `${r.memberName} (${r.role}): ${r.content.slice(0, 200)}`);
  }

  private extractConfidence(text: string): number {
    const match = text.match(/\[confidence:\s*([\d.]+)\]/i);
    return match ? Math.max(0, Math.min(1, parseFloat(match[1]))) : 0.5;
  }

  private createMember(
    spec: CouncilMemberSpec,
    tier: Tier,
    branch: BranchType | undefined,
    containerType: "vm" | "lxc",
  ): CouncilMember {
    const id = `member-${crypto.randomUUID().slice(0, 8)}`;

    // Build personality from spec or generate defaults
    const personality: MemberPersonality = spec.personality || {
      title: spec.speciality || spec.name,
      expertise: [spec.role, spec.speciality].filter(Boolean),
      description: spec.speciality || `${spec.role} specialist`,
      traits: {
        style: tier === 1 ? "authoritative" : tier === 2 ? "analytical" : "focused",
        verbosity: tier === 1 ? 0.7 : tier === 2 ? 0.6 : 0.4,
        creativity: spec.role === "creative" || spec.role === "brainstormer" ? 0.8 : 0.5,
        rigor: spec.role === "logical" || spec.role === "mathematician" ? 0.9 : 0.6,
      },
    };

    return {
      id,
      name: spec.name,
      role: spec.role,
      personality,
      tier,
      branch,
      model: spec.model,
      previousModels: [],
      backend: spec.backend,
      endpoint: "",
      containerId: undefined,
      containerType,
      status: "provisioning",
      weight: spec.weight || 1.0,
      children: [],
      memory: createDefaultMemory(id),
      metrics: createDefaultMetrics(),
    };
  }
}
