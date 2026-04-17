import { execSync, exec } from "child_process";
/**
 * Storage Client — SMB + NVMe Two-Tier Storage
 *
 * Architecture:
 * - SMB/CIFS share = permanent store for ALL files (models, datasets, configs)
 * - NVMe drive    = fast cache for RUNNING models only (loaded for inference)
 *
 * Flow:
 *   Download → SMB (permanent)
 *   Run model → copy SMB → NVMe (fast inference)
 *   Stop model → delete from NVMe (stays on SMB)
 *
 * Non-model files (datasets, voice samples, configs) live on SMB only.
 * NVMe should ONLY contain models that are actively being used for inference.
 * When NVMe fills up, least-recently-used models are evicted automatically.
 */
import { EventEmitter } from "events";
import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";

// ── Types ───────────────────────────────────────────────────────

export interface SmbConfig {
  host: string; // e.g. "192.168.1.100"
  share: string; // e.g. "models"
  username: string;
  password: string;
  domain?: string; // e.g. "WORKGROUP"
  mountPoint: string; // local mount path, e.g. "/mnt/models"
  port?: number; // default 445
}

export interface NvmeDrive {
  device: string; // e.g. "/dev/nvme0n1p1"
  mountPoint: string; // e.g. "/mnt/nvme-models"
  label?: string; // e.g. "Fast Model Cache"
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export type FileCategory = "model" | "dataset" | "voice-sample" | "config" | "other";

export interface StorageConfig {
  smb?: SmbConfig;
  nvmePath: string; // NVMe mount — ONLY for running models
  cacheDir: string; // fallback when SMB is not connected
  nvmeEvictThreshold: number; // percent usage above which we auto-evict (default 90)
}

export interface StoredModel {
  modelId: string;
  filename: string;
  location: "smb" | "nvme" | "cache";
  path: string;
  sizeBytes: number;
  lastAccessed?: string;
  loaded: boolean; // true = on NVMe, actively running
}

export interface StoredFile {
  name: string;
  category: FileCategory;
  path: string;
  sizeBytes: number;
  location: "smb" | "cache";
  createdAt?: string;
}

export interface CopyProgress {
  modelId: string;
  filename: string;
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
  from: "smb" | "nvme" | "cache";
  to: "smb" | "nvme" | "cache";
}

// ── Storage Client ──────────────────────────────────────────────

export class StorageClient extends EventEmitter {
  private config: StorageConfig;
  private smbMounted = false;

  constructor(config: StorageConfig) {
    super();
    this.config = {
      ...config,
      nvmeEvictThreshold: config.nvmeEvictThreshold ?? 90,
    };

    // Ensure local dirs exist
    this.ensureDir(config.nvmePath);
    this.ensureDir(config.cacheDir);
  }

  // ── SMB Operations ──────────────────────────────────────────

  async mountSmb(): Promise<boolean> {
    if (!this.config.smb) {
      return false;
    }
    const smb = this.config.smb;

    this.ensureDir(smb.mountPoint);

    try {
      const opts = [
        `username=${smb.username}`,
        `password=${smb.password}`,
        `domain=${smb.domain || "WORKGROUP"}`,
        `port=${smb.port || 445}`,
        "iocharset=utf8",
        "file_mode=0755",
        "dir_mode=0755",
      ].join(",");

      execSync(`mount -t cifs //${smb.host}/${smb.share} ${smb.mountPoint} -o ${opts}`, {
        timeout: 15000,
      });

      this.smbMounted = true;
      this.emit("smbMounted", { host: smb.host, share: smb.share });

      // Auto-migrate any locally cached files to SMB
      const migrated = await this.migrateCacheToSmb();
      if (migrated > 0) {
        this.emit("autoMigrated", { count: migrated });
      }

      return true;
    } catch (err) {
      this.emit("smbError", {
        message: `Failed to mount SMB share: ${(err as Error).message}`,
      });
      return false;
    }
  }

  async unmountSmb(): Promise<void> {
    if (!this.config.smb || !this.smbMounted) {
      return;
    }

    try {
      execSync(`umount ${this.config.smb.mountPoint}`, { timeout: 10000 });
      this.smbMounted = false;
      this.emit("smbUnmounted");
    } catch (err) {
      this.emit("smbError", {
        message: `Failed to unmount: ${(err as Error).message}`,
      });
    }
  }

  isSmbMounted(): boolean {
    if (!this.config.smb) {
      return false;
    }
    try {
      execSync(`mountpoint -q ${this.config.smb.mountPoint}`);
      this.smbMounted = true;
      return true;
    } catch {
      this.smbMounted = false;
      return false;
    }
  }

  updateSmbConfig(smb: SmbConfig): void {
    this.config.smb = smb;
    this.emit("configUpdated", { smb });
  }

  // ── NVMe Drive Detection ───────────────────────────────────

  detectNvmeDrives(): NvmeDrive[] {
    try {
      const output = execSync(
        "df -B1 --output=source,target,size,used,avail,pcent 2>/dev/null || df -k",
        {
          encoding: "utf-8",
          timeout: 5000,
        },
      );

      const lines = output.trim().split("\n").slice(1);
      const drives: NvmeDrive[] = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) {
          continue;
        }

        const device = parts[0];
        const mountPoint = parts[1];
        const totalBytes = parseInt(parts[2], 10) || 0;
        const usedBytes = parseInt(parts[3], 10) || 0;
        const freeBytes = parseInt(parts[4], 10) || 0;
        const usedPercent = parseInt((parts[5] || "0").replace("%", ""), 10) || 0;

        // Filter for NVMe drives and any mounted data volumes
        if (
          device.includes("nvme") ||
          mountPoint.startsWith("/mnt/") ||
          mountPoint.startsWith("/data") ||
          mountPoint.startsWith("/opt")
        ) {
          drives.push({
            device,
            mountPoint,
            label: this.getDriveLabel(device, mountPoint),
            totalBytes,
            freeBytes,
            usedBytes,
            usedPercent,
          });
        }
      }

      return drives;
    } catch {
      return [];
    }
  }

  setNvmePath(path: string): void {
    this.ensureDir(path);
    this.config.nvmePath = path;
    this.emit("nvmePathChanged", { path });
  }

  // ── Model Storage Operations ────────────────────────────────

  /**
   * Get the permanent storage path for a model file.
   * Always targets SMB (permanent store). Falls back to local cache
   * only when SMB is unavailable. NVMe is NEVER used for storage —
   * it's only for running models.
   */
  getStoragePath(modelId: string, filename: string): string {
    const modelDir = modelId.replace("/", "_");

    // Always prefer SMB as permanent storage
    if (this.smbMounted && this.config.smb) {
      const dir = join(this.config.smb.mountPoint, "models", modelDir);
      this.ensureDir(dir);
      return join(dir, filename);
    }

    // Fallback: local cache (should be migrated to SMB when available)
    const dir = join(this.config.cacheDir, modelDir);
    this.ensureDir(dir);
    return join(dir, filename);
  }

  /**
   * Get the permanent storage path for a general file (datasets, voice samples, etc.).
   * Always goes to SMB. Non-model files never touch NVMe.
   */
  getFileStoragePath(category: FileCategory, filename: string): string {
    if (this.smbMounted && this.config.smb) {
      const dir = join(this.config.smb.mountPoint, category === "other" ? "files" : `${category}s`);
      this.ensureDir(dir);
      return join(dir, filename);
    }

    // Fallback: local cache
    const dir = join(this.config.cacheDir, category === "other" ? "files" : `${category}s`);
    this.ensureDir(dir);
    return join(dir, filename);
  }

  /**
   * List all non-model files stored on SMB/cache.
   */
  listStoredFiles(category?: FileCategory): StoredFile[] {
    const files: StoredFile[] = [];
    const categories: FileCategory[] = category
      ? [category]
      : ["dataset", "voice-sample", "config", "other"];

    for (const cat of categories) {
      const dirName = cat === "other" ? "files" : `${cat}s`;

      // Scan SMB
      if (this.smbMounted && this.config.smb) {
        files.push(
          ...this.scanFileDirectory(join(this.config.smb.mountPoint, dirName), cat, "smb"),
        );
      }

      // Scan cache
      files.push(...this.scanFileDirectory(join(this.config.cacheDir, dirName), cat, "cache"));
    }

    return files;
  }

  /**
   * Migrate all locally cached files to SMB when the share becomes available.
   * Call this after a successful SMB mount.
   */
  async migrateCacheToSmb(): Promise<number> {
    if (!this.smbMounted || !this.config.smb) {
      return 0;
    }

    let migrated = 0;
    const cacheDir = this.config.cacheDir;

    try {
      if (!existsSync(cacheDir)) {
        return 0;
      }

      const entries = readdirSync(cacheDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const sourceDirPath = join(cacheDir, entry.name);
        const targetDirPath = join(this.config.smb.mountPoint, "models", entry.name);
        this.ensureDir(targetDirPath);

        const files = readdirSync(sourceDirPath);
        for (const file of files) {
          const sourcePath = join(sourceDirPath, file);
          const targetPath = join(targetDirPath, file);

          if (existsSync(targetPath)) {
            // Already on SMB — remove cache copy
            unlinkSync(sourcePath);
            migrated++;
            continue;
          }

          try {
            execSync(`mv "${sourcePath}" "${targetPath}"`, { timeout: 60000 });
            migrated++;
            this.emit("fileMigrated", { file, from: "cache", to: "smb" });
          } catch {
            // Leave in cache if move fails
          }
        }
      }
    } catch {
      // Best effort
    }

    if (migrated > 0) {
      this.emit("migrationComplete", { count: migrated });
    }
    return migrated;
  }

  /**
   * Load a model from SMB/cache onto the NVMe for fast inference.
   * NVMe is ONLY for running models — auto-evicts least recently used
   * models if NVMe is above the eviction threshold.
   */
  async loadToNvme(modelId: string, filename: string): Promise<string> {
    const modelDir = modelId.replace("/", "_");
    const nvmeDir = join(this.config.nvmePath, modelDir);
    const nvmePath = join(nvmeDir, filename);

    // Already on NVMe?
    if (existsSync(nvmePath)) {
      this.emit("modelAlreadyLoaded", { modelId, filename, path: nvmePath });
      return nvmePath;
    }

    // Find source file (must be on SMB or cache, never download directly to NVMe)
    const sourcePath = this.findModelOnPermanentStorage(modelId, filename);
    if (!sourcePath) {
      throw new Error(`Model file not found on SMB/cache: ${modelId}/${filename}`);
    }

    const stat = statSync(sourcePath);

    // Check NVMe capacity — evict if needed
    await this.ensureNvmeCapacity(stat.size);

    // Copy to NVMe for inference
    this.ensureDir(nvmeDir);

    this.emit("loadStart", {
      modelId,
      filename,
      from: this.getLocation(sourcePath),
      totalBytes: stat.size,
    });

    await new Promise<void>((resolve, reject) => {
      exec(`cp "${sourcePath}" "${nvmePath}"`, (err) => {
        if (err) {
          reject(new Error(`Copy to NVMe failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });

    this.emit("loadComplete", {
      modelId,
      filename,
      path: nvmePath,
      sizeBytes: stat.size,
    });

    return nvmePath;
  }

  /**
   * Find a model only on permanent storage (SMB or cache).
   * NVMe is excluded because it's only a temporary runtime cache.
   */
  findModelOnPermanentStorage(modelId: string, filename: string): string | null {
    const modelDir = modelId.replace("/", "_");

    // Check SMB first (preferred permanent storage)
    if (this.smbMounted && this.config.smb) {
      const smbPath = join(this.config.smb.mountPoint, "models", modelDir, filename);
      if (existsSync(smbPath)) {
        return smbPath;
      }
    }

    // Check local cache (fallback)
    const cachePath = join(this.config.cacheDir, modelDir, filename);
    if (existsSync(cachePath)) {
      return cachePath;
    }

    return null;
  }

  /**
   * Ensure NVMe has enough free space for a new model.
   * Evicts least-recently-accessed models until there's room.
   */
  private async ensureNvmeCapacity(requiredBytes: number): Promise<void> {
    const stats = this.getDiskSpace(this.config.nvmePath);
    const freeBytes = stats.freeGb * 1073741824;

    if (freeBytes >= requiredBytes) {
      return; // Enough space
    }

    // Get all models on NVMe, sorted by last access (oldest first)
    const nvmeModels = this.scanDirectory(this.config.nvmePath, "nvme", true).toSorted((a, b) => {
      const aTime = a.lastAccessed ? new Date(a.lastAccessed).getTime() : 0;
      const bTime = b.lastAccessed ? new Date(b.lastAccessed).getTime() : 0;
      return aTime - bTime;
    });

    let freed = 0;
    for (const model of nvmeModels) {
      if (freeBytes + freed >= requiredBytes) {
        break;
      }

      try {
        unlinkSync(model.path);
        freed += model.sizeBytes;
        this.emit("nvmeEvicted", {
          modelId: model.modelId,
          filename: model.filename,
          sizeBytes: model.sizeBytes,
          reason: "capacity",
        });
      } catch {
        // Skip if we can't delete
      }
    }

    if (freeBytes + freed < requiredBytes) {
      throw new Error(
        `Not enough NVMe space. Need ${formatBytes(requiredBytes)}, ` +
          `only ${formatBytes(freeBytes + freed)} available after eviction`,
      );
    }
  }

  /**
   * Unload a model from NVMe — removes the fast cache copy.
   * The model remains safely on SMB/cache for future use.
   * Call this when the model is no longer needed for active inference.
   */
  async unloadFromNvme(modelId: string, filename: string): Promise<void> {
    const modelDir = modelId.replace("/", "_");
    const nvmePath = join(this.config.nvmePath, modelDir, filename);

    if (!existsSync(nvmePath)) {
      return;
    }

    // Verify the file still exists on permanent storage before deleting NVMe copy
    const permanentPath = this.findModelOnPermanentStorage(modelId, filename);
    if (!permanentPath) {
      this.emit("warning", {
        message: `Model ${modelId}/${filename} not found on SMB/cache — keeping NVMe copy as safety`,
      });
      return;
    }

    unlinkSync(nvmePath);
    this.emit("unloaded", {
      modelId,
      filename,
      permanentLocation: this.getLocation(permanentPath),
    });
  }

  /**
   * Find a model file across all storage locations.
   * Checks NVMe first (might be loaded), then SMB, then cache.
   */
  findModel(modelId: string, filename: string): string | null {
    const modelDir = modelId.replace("/", "_");

    // Check NVMe first (model might be running)
    const nvmePath = join(this.config.nvmePath, modelDir, filename);
    if (existsSync(nvmePath)) {
      return nvmePath;
    }

    // Check SMB (permanent storage)
    if (this.smbMounted && this.config.smb) {
      const smbPath = join(this.config.smb.mountPoint, "models", modelDir, filename);
      if (existsSync(smbPath)) {
        return smbPath;
      }
    }

    // Check local cache (fallback)
    const cachePath = join(this.config.cacheDir, modelDir, filename);
    if (existsSync(cachePath)) {
      return cachePath;
    }

    return null;
  }

  /**
   * Check if a model is currently loaded on NVMe (running).
   */
  isModelLoaded(modelId: string, filename: string): boolean {
    const modelDir = modelId.replace("/", "_");
    const nvmePath = join(this.config.nvmePath, modelDir, filename);
    return existsSync(nvmePath);
  }

  /**
   * Get NVMe usage summary — how many models are loaded and space used.
   */
  getNvmeUsage(): {
    loadedModels: StoredModel[];
    usedGb: number;
    freeGb: number;
    totalGb: number;
    usedPercent: number;
  } {
    const loadedModels = this.scanDirectory(this.config.nvmePath, "nvme", true);
    const disk = this.getDiskSpace(this.config.nvmePath);
    const usedByModels = loadedModels.reduce((sum, m) => sum + m.sizeBytes, 0);
    return {
      loadedModels,
      usedGb: Math.round((usedByModels / 1073741824) * 10) / 10,
      freeGb: disk.freeGb,
      totalGb: disk.totalGb,
      usedPercent:
        disk.totalGb > 0 ? Math.round(((disk.totalGb - disk.freeGb) / disk.totalGb) * 100) : 0,
    };
  }

  /**
   * List all stored models across all locations.
   * Models on NVMe are marked as "loaded" (running).
   * Models on SMB/cache are marked as "stored" (not running).
   */
  listStoredModels(): StoredModel[] {
    const models: StoredModel[] = [];

    // Scan NVMe — these are the RUNNING models
    models.push(...this.scanDirectory(this.config.nvmePath, "nvme", true));

    // Scan SMB — permanent storage (models subdir)
    if (this.smbMounted && this.config.smb) {
      const smbModelsDir = join(this.config.smb.mountPoint, "models");
      models.push(...this.scanDirectory(smbModelsDir, "smb", false));
    }

    // Scan local cache — fallback when SMB is unavailable
    models.push(...this.scanDirectory(this.config.cacheDir, "cache", false));

    // Deduplicate: if a model exists on both NVMe and SMB, show the NVMe entry
    // (it's loaded/running). The SMB copy is the permanent backup.
    const seen = new Map<string, StoredModel>();
    for (const model of models) {
      const key = `${model.modelId}/${model.filename}`;
      const existing = seen.get(key);
      if (!existing || model.location === "nvme") {
        seen.set(key, model);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Get storage stats.
   */
  getStorageStats(): {
    smb: { mounted: boolean; totalGb: number; freeGb: number } | null;
    nvme: { path: string; totalGb: number; freeGb: number } | null;
    cache: { path: string; totalGb: number; freeGb: number } | null;
  } {
    return {
      smb:
        this.config.smb && this.smbMounted
          ? { mounted: true, ...this.getDiskSpace(this.config.smb.mountPoint) }
          : this.config.smb
            ? { mounted: false, totalGb: 0, freeGb: 0 }
            : null,
      nvme: { path: this.config.nvmePath, ...this.getDiskSpace(this.config.nvmePath) },
      cache: { path: this.config.cacheDir, ...this.getDiskSpace(this.config.cacheDir) },
    };
  }

  // ── Helpers ─────────────────────────────────────────────────

  private scanDirectory(
    basePath: string,
    location: "smb" | "nvme" | "cache",
    loaded: boolean,
  ): StoredModel[] {
    const models: StoredModel[] = [];

    try {
      if (!existsSync(basePath)) {
        return models;
      }

      const modelDirs = readdirSync(basePath, { withFileTypes: true }).filter((d) =>
        d.isDirectory(),
      );

      for (const dir of modelDirs) {
        const modelId = dir.name.replace("_", "/");
        const modelPath = join(basePath, dir.name);
        const files = readdirSync(modelPath);

        for (const file of files) {
          const filePath = join(modelPath, file);
          try {
            const stat = statSync(filePath);
            if (stat.isFile()) {
              models.push({
                modelId,
                filename: file,
                location,
                path: filePath,
                sizeBytes: stat.size,
                lastAccessed: stat.atime.toISOString(),
                loaded,
              });
            }
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Directory not accessible
    }

    return models;
  }

  private getDiskSpace(path: string): { totalGb: number; freeGb: number } {
    try {
      const output = execSync(`df -B1 "${path}" 2>/dev/null | tail -1`, {
        encoding: "utf-8",
      });
      const parts = output.trim().split(/\s+/);
      const totalBytes = parseInt(parts[1], 10) || 0;
      const freeBytes = parseInt(parts[3], 10) || 0;
      return {
        totalGb: Math.round((totalBytes / 1073741824) * 10) / 10,
        freeGb: Math.round((freeBytes / 1073741824) * 10) / 10,
      };
    } catch {
      return { totalGb: 0, freeGb: 0 };
    }
  }

  private getLocation(path: string): "smb" | "nvme" | "cache" {
    if (this.config.smb && path.startsWith(this.config.smb.mountPoint)) {
      return "smb";
    }
    if (path.startsWith(this.config.nvmePath)) {
      return "nvme";
    }
    return "cache";
  }

  private getDriveLabel(device: string, mountPoint: string): string {
    if (device.includes("nvme")) {
      const match = device.match(/nvme(\d+)n(\d+)/);
      if (match) {
        return `NVMe ${match[1]} Part ${match[2]}`;
      }
    }
    if (mountPoint === "/") {
      return "Root";
    }
    return mountPoint.split("/").pop() || mountPoint;
  }

  private scanFileDirectory(
    basePath: string,
    category: FileCategory,
    location: "smb" | "cache",
  ): StoredFile[] {
    const files: StoredFile[] = [];

    try {
      if (!existsSync(basePath)) {
        return files;
      }

      const entries = readdirSync(basePath);
      for (const entry of entries) {
        const filePath = join(basePath, entry);
        try {
          const stat = statSync(filePath);
          if (stat.isFile()) {
            files.push({
              name: entry,
              category,
              path: filePath,
              sizeBytes: stat.size,
              location,
              createdAt: stat.birthtime.toISOString(),
            });
          }
        } catch {
          // Skip inaccessible files
        }
      }
    } catch {
      // Directory not accessible
    }

    return files;
  }

  private ensureDir(path: string): void {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }
}

// ── Utility ──────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) {
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}
