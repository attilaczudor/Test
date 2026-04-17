import { describe, it, expect, beforeEach } from "vitest";
import { LaneQueue } from "./lane-queue";

describe("LaneQueue", () => {
  let queue: LaneQueue;

  beforeEach(() => {
    queue = new LaneQueue({ maxParallel: 3, lockTimeoutMs: 5000 });
  });

  it("should execute a simple task", async () => {
    const taskId = queue.enqueue("test-task", async () => "result");
    const result = await queue.waitForTask(taskId);

    expect(result.success).toBe(true);
    expect(result.result).toBe("result");
  });

  it("should run non-conflicting tasks in parallel", async () => {
    const order: number[] = [];

    const id1 = queue.enqueue(
      "task-1",
      async () => {
        await delay(50);
        order.push(1);
        return 1;
      },
      { resources: ["file-a"] }
    );

    const id2 = queue.enqueue(
      "task-2",
      async () => {
        await delay(10);
        order.push(2);
        return 2;
      },
      { resources: ["file-b"] }
    );

    const [r1, r2] = await Promise.all([
      queue.waitForTask(id1),
      queue.waitForTask(id2),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    // Task 2 should finish first (shorter delay)
    expect(order[0]).toBe(2);
  });

  it("should serialize tasks with conflicting resources", async () => {
    const order: number[] = [];

    const id1 = queue.enqueue(
      "task-1",
      async () => {
        await delay(30);
        order.push(1);
        return 1;
      },
      { resources: ["shared-file"], destructive: true }
    );

    const id2 = queue.enqueue(
      "task-2",
      async () => {
        order.push(2);
        return 2;
      },
      { resources: ["shared-file"], destructive: true }
    );

    await Promise.all([
      queue.waitForTask(id1),
      queue.waitForTask(id2),
    ]);

    // Task 1 should always complete before task 2 starts
    expect(order).toEqual([1, 2]);
  });

  it("should respect maxParallel limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const createTask = () =>
      queue.enqueue("task", async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(30);
        concurrent--;
      });

    const ids = Array.from({ length: 6 }, createTask);
    await Promise.all(ids.map((id) => queue.waitForTask(id)));

    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it("should handle task errors gracefully", async () => {
    const taskId = queue.enqueue("failing-task", async () => {
      throw new Error("Task failed!");
    });

    const result = await queue.waitForTask(taskId);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Task failed!");
  });

  it("should prioritize higher priority tasks", async () => {
    // Enqueue a long-running task to fill all slots
    const blockerId = queue.enqueue(
      "blocker",
      async () => {
        await delay(100);
      },
      { resources: ["r1"], destructive: true }
    );

    const order: string[] = [];

    // These will be queued while blocker runs
    const lowId = queue.enqueue(
      "low-priority",
      async () => {
        order.push("low");
      },
      { priority: 1, resources: ["r1"], destructive: true }
    );

    const highId = queue.enqueue(
      "high-priority",
      async () => {
        order.push("high");
      },
      { priority: 10, resources: ["r1"], destructive: true }
    );

    await Promise.all([
      queue.waitForTask(blockerId),
      queue.waitForTask(lowId),
      queue.waitForTask(highId),
    ]);

    // High priority should run before low priority
    expect(order[0]).toBe("high");
  });

  it("should report correct status", () => {
    queue.enqueue("task-1", () => delay(100), {
      resources: ["file-a"],
    });

    const status = queue.getStatus();
    // Task may already be running
    expect(status.pending + status.running).toBeGreaterThanOrEqual(1);
  });

  it("should emit events", async () => {
    const events: string[] = [];
    queue.on("taskEnqueued", () => events.push("enqueued"));
    queue.on("taskStarted", () => events.push("started"));
    queue.on("taskCompleted", () => events.push("completed"));

    const taskId = queue.enqueue("test", async () => "done");
    await queue.waitForTask(taskId);

    expect(events).toContain("enqueued");
    expect(events).toContain("started");
    expect(events).toContain("completed");
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
