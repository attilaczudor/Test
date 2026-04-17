import * as crypto from "crypto";
import { EventEmitter } from "events";

export interface LaneTask {
  id: string;
  name: string;
  execute: () => Promise<unknown>;
  resources: string[]; // resource identifiers this task reads/writes
  destructive: boolean; // does it modify state? (file writes, etc.)
  priority: number; // higher = runs first
  createdAt: number;
}

export interface LaneTaskResult {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
  startedAt: number;
  completedAt: number;
}

export interface LaneQueueConfig {
  maxParallel: number;
  lockTimeoutMs: number;
}

/**
 * Lane Queue with Controlled Parallelism.
 *
 * Non-conflicting tasks run in parallel. Destructive tasks that
 * touch the same resources are serialized via resource-level locking.
 * A global state lock prevents concurrent destructive writes.
 */
export class LaneQueue extends EventEmitter {
  private readonly config: LaneQueueConfig;
  private readonly pending: LaneTask[] = [];
  private readonly running = new Map<string, LaneTask>();
  private readonly lockedResources = new Set<string>();
  private readonly results = new Map<string, LaneTaskResult>();
  private globalWriteLock = false;

  constructor(config: LaneQueueConfig) {
    super();
    this.config = config;
  }

  enqueue(
    name: string,
    execute: () => Promise<unknown>,
    options: {
      resources?: string[];
      destructive?: boolean;
      priority?: number;
    } = {},
  ): string {
    const task: LaneTask = {
      id: crypto.randomUUID(),
      name,
      execute,
      resources: options.resources || [],
      destructive: options.destructive ?? false,
      priority: options.priority ?? 0,
      createdAt: Date.now(),
    };

    this.pending.push(task);
    // Sort by priority (descending), then by creation time (ascending)
    this.pending.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

    this.emit("taskEnqueued", task.id, task.name);
    this.drain();

    return task.id;
  }

  getResult(taskId: string): LaneTaskResult | undefined {
    return this.results.get(taskId);
  }

  waitForTask(taskId: string): Promise<LaneTaskResult> {
    const existing = this.results.get(taskId);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve) => {
      const handler = (result: LaneTaskResult) => {
        if (result.taskId === taskId) {
          this.off("taskCompleted", handler);
          this.off("taskFailed", handler);
          resolve(result);
        }
      };
      this.on("taskCompleted", handler);
      this.on("taskFailed", handler);
    });
  }

  getStatus(): {
    pending: number;
    running: number;
    completed: number;
    lockedResources: string[];
  } {
    return {
      pending: this.pending.length,
      running: this.running.size,
      completed: this.results.size,
      lockedResources: Array.from(this.lockedResources),
    };
  }

  private drain(): void {
    while (this.running.size < this.config.maxParallel && this.pending.length > 0) {
      const nextIndex = this.findNextRunnable();
      if (nextIndex === -1) {
        break;
      }

      const task = this.pending.splice(nextIndex, 1)[0];
      void this.startTask(task);
    }
  }

  private findNextRunnable(): number {
    for (let i = 0; i < this.pending.length; i++) {
      const task = this.pending[i];

      // If task is destructive, need global write lock
      if (task.destructive && this.globalWriteLock) {
        continue;
      }

      // Check if any required resources are locked
      const hasConflict = task.resources.some((r) => this.lockedResources.has(r));
      if (hasConflict) {
        continue;
      }

      return i;
    }
    return -1;
  }

  private async startTask(task: LaneTask): Promise<void> {
    this.running.set(task.id, task);

    // Lock resources
    for (const r of task.resources) {
      this.lockedResources.add(r);
    }
    if (task.destructive) {
      this.globalWriteLock = true;
    }

    this.emit("taskStarted", task.id, task.name);
    const startedAt = Date.now();

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      this.completeTask(task, {
        taskId: task.id,
        success: false,
        error: `Task timed out after ${this.config.lockTimeoutMs}ms`,
        durationMs: Date.now() - startedAt,
        startedAt,
        completedAt: Date.now(),
      });
    }, this.config.lockTimeoutMs);

    try {
      const result = await task.execute();
      clearTimeout(timeoutHandle);

      if (this.running.has(task.id)) {
        this.completeTask(task, {
          taskId: task.id,
          success: true,
          result,
          durationMs: Date.now() - startedAt,
          startedAt,
          completedAt: Date.now(),
        });
      }
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);

      if (this.running.has(task.id)) {
        this.completeTask(task, {
          taskId: task.id,
          success: false,
          error: (err instanceof Error ? err.message : String(err)) || "Unknown error",
          durationMs: Date.now() - startedAt,
          startedAt,
          completedAt: Date.now(),
        });
      }
    }
  }

  private completeTask(task: LaneTask, result: LaneTaskResult): void {
    this.running.delete(task.id);

    // Unlock resources
    for (const r of task.resources) {
      this.lockedResources.delete(r);
    }
    if (task.destructive) {
      this.globalWriteLock = false;
    }

    this.results.set(task.id, result);

    if (result.success) {
      this.emit("taskCompleted", result);
    } else {
      this.emit("taskFailed", result);
    }

    // Try to run more tasks
    this.drain();
  }
}
