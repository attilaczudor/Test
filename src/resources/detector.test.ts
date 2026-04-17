import { describe, it, expect } from "vitest";
import { calculateBudget, recommendTier } from "./detector";
import { HardwareProfile, ResourceBudget } from "./types";

describe("Resource Detector", () => {
  describe("calculateBudget", () => {
    it("should calculate budget for reference 16-core/128GB system", () => {
      const hardware: HardwareProfile = {
        totalMemoryMb: 128 * 1024, // 128 GB
        totalCores: 16,
        gpuMemoryMb: 0,
        gpuType: "none",
        hostname: "proxmox-host",
      };

      // Use defaults: reservedMemory=4096, reservedCores=2
      const budget = calculateBudget(hardware);

      // Available: 128*1024 - 4096 = 126976 MB, 14 cores
      expect(budget.availableMemoryMb).toBe(128 * 1024 - 4096);
      expect(budget.availableCores).toBe(14);
      expect(budget.maxUtilization).toBe(0.8);
      // Budget: 126976 * 0.8 = 101580, floor(14*0.8) = 11
      expect(budget.budgetMemoryMb).toBeGreaterThan(99000);
      expect(budget.budgetCores).toBe(11);
    });

    it("should calculate budget for 256GB system with explicit reserves", () => {
      const hardware: HardwareProfile = {
        totalMemoryMb: 256 * 1024,
        totalCores: 48,
        gpuMemoryMb: 16384,
        gpuType: "amd",
        hostname: "proxmox-host",
      };

      const budget = calculateBudget(hardware, 0.8, 4096, 4);

      expect(budget.availableMemoryMb).toBe(256 * 1024 - 4096);
      expect(budget.availableCores).toBe(44);
      expect(budget.budgetMemoryMb).toBeGreaterThan(200000);
      expect(budget.budgetCores).toBe(35);
    });

    it("should calculate budget for 64GB system", () => {
      const hardware: HardwareProfile = {
        totalMemoryMb: 64 * 1024,
        totalCores: 16,
        gpuMemoryMb: 0,
        gpuType: "none",
        hostname: "dev-box",
      };

      const budget = calculateBudget(hardware, 0.8, 4096, 4);

      expect(budget.availableMemoryMb).toBe(64 * 1024 - 4096);
      expect(budget.availableCores).toBe(12);
      expect(budget.budgetMemoryMb).toBeGreaterThan(40000);
    });

    it("should clamp to zero when reserves exceed total", () => {
      const hardware: HardwareProfile = {
        totalMemoryMb: 2048,
        totalCores: 2,
        gpuMemoryMb: 0,
        gpuType: "none",
        hostname: "tiny",
      };

      const budget = calculateBudget(hardware, 0.8, 4096, 4);

      expect(budget.availableMemoryMb).toBe(0);
      expect(budget.availableCores).toBe(0);
      expect(budget.budgetMemoryMb).toBe(0);
      expect(budget.budgetCores).toBe(0);
    });

    it("should use custom utilization cap", () => {
      const hardware: HardwareProfile = {
        totalMemoryMb: 128 * 1024,
        totalCores: 32,
        gpuMemoryMb: 0,
        gpuType: "none",
        hostname: "test",
      };

      const budget50 = calculateBudget(hardware, 0.5, 4096, 4);
      const budget80 = calculateBudget(hardware, 0.8, 4096, 4);

      expect(budget50.budgetMemoryMb).toBeLessThan(budget80.budgetMemoryMb);
    });
  });

  describe("recommendTier", () => {
    it("should recommend homelab for >= 80GB budget (128GB system)", () => {
      const budget: ResourceBudget = {
        availableMemoryMb: 124 * 1024,
        availableCores: 12,
        maxUtilization: 0.8,
        budgetMemoryMb: 99 * 1024,
        budgetCores: 9,
      };
      expect(recommendTier(budget)).toBe("homelab");
    });

    it("should recommend homelab for large 256GB system", () => {
      const budget: ResourceBudget = {
        availableMemoryMb: 250 * 1024,
        availableCores: 44,
        maxUtilization: 0.8,
        budgetMemoryMb: 200 * 1024,
        budgetCores: 35,
      };
      expect(recommendTier(budget)).toBe("homelab");
    });

    it("should recommend compact for >= 32GB budget", () => {
      const budget: ResourceBudget = {
        availableMemoryMb: 60 * 1024,
        availableCores: 12,
        maxUtilization: 0.8,
        budgetMemoryMb: 48 * 1024,
        budgetCores: 9,
      };
      expect(recommendTier(budget)).toBe("compact");
    });

    it("should recommend minimal for < 32GB budget", () => {
      const budget: ResourceBudget = {
        availableMemoryMb: 28 * 1024,
        availableCores: 6,
        maxUtilization: 0.8,
        budgetMemoryMb: 22 * 1024,
        budgetCores: 4,
      };
      expect(recommendTier(budget)).toBe("minimal");
    });

    it("should recommend minimal when budget is zero", () => {
      const budget: ResourceBudget = {
        availableMemoryMb: 0,
        availableCores: 0,
        maxUtilization: 0.8,
        budgetMemoryMb: 0,
        budgetCores: 0,
      };
      expect(recommendTier(budget)).toBe("minimal");
    });
  });
});
