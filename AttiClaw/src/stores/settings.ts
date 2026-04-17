import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Types ────────────────────────────────────────────────────────────────────

export type Theme = "light" | "dark" | "system";

export interface UserProfile {
  name: string;
  email: string;
  bio: string;
}

export interface SmbConfig {
  host: string;
  share: string;
  username: string;
  password: string;
  domain: string;
  mountPoint: string;
  port: number;
}

export interface NvmeDrive {
  device: string;
  mountPoint: string;
  label: string;
  totalGb: number;
  freeGb: number;
  usedPercent: number;
}

// ── State ────────────────────────────────────────────────────────────────────

interface SettingsState {
  theme: Theme;
  language: string;
  smbConfig: SmbConfig;
  smbConnected: boolean;
  nvmeDrives: NvmeDrive[];
  selectedNvmeDrive: string;
  nvmePath: string;
  profile: UserProfile;
}

// ── Actions ──────────────────────────────────────────────────────────────────

interface SettingsActions {
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setSmbConfig: (config: Partial<SmbConfig>) => void;
  connectSmb: () => Promise<void>;
  disconnectSmb: () => void;
  refreshNvmeDrives: () => Promise<void>;
  setSelectedNvmeDrive: (device: string) => void;
  setProfile: (profile: Partial<UserProfile>) => void;
}

// ── Store ────────────────────────────────────────────────────────────────────

const DEFAULT_SMB_CONFIG: SmbConfig = {
  host: "192.168.1.100",
  share: "models",
  username: "",
  password: "",
  domain: "WORKGROUP",
  mountPoint: "/mnt/smb-models",
  port: 445,
};

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set, get) => ({
      // ── State defaults ───────────────────────────────────────────────────
      theme: "dark",
      language: "en",
      smbConfig: { ...DEFAULT_SMB_CONFIG },
      smbConnected: false,
      nvmeDrives: [],
      selectedNvmeDrive: "",
      nvmePath: "/mnt/nvme-models",
      profile: { name: "Local User", email: "", bio: "" },

      // ── Actions ──────────────────────────────────────────────────────────

      setTheme: (theme) => set({ theme }),

      setLanguage: (language) => set({ language }),

      setSmbConfig: (config) =>
        set((state) => ({
          smbConfig: { ...state.smbConfig, ...config },
        })),

      connectSmb: async () => {
        const { smbConfig } = get();

        if (!smbConfig.host || !smbConfig.share) {
          throw new Error("SMB host and share are required");
        }

        // In a real implementation this would invoke a backend/IPC call to
        // mount the SMB share via `mount -t cifs` or equivalent.
        // For now we optimistically mark the connection as established.
        set({ smbConnected: true });
      },

      disconnectSmb: () => {
        // In a real implementation this would invoke `umount` on the mount
        // point via backend/IPC.
        set({ smbConnected: false });
      },

      refreshNvmeDrives: async () => {
        // In a real implementation this would call a backend/IPC endpoint
        // that runs `lsblk` / `nvme list` and parses the output.
        // Placeholder: the array stays as-is until a backend is wired up.
        const { nvmeDrives } = get();
        set({ nvmeDrives: [...nvmeDrives] });
      },

      setSelectedNvmeDrive: (device) => set({ selectedNvmeDrive: device }),

      setProfile: (profile) =>
        set((state) => ({ profile: { ...state.profile, ...profile } })),
    }),
    {
      name: "atticlaw-settings",
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        smbConfig: state.smbConfig,
        selectedNvmeDrive: state.selectedNvmeDrive,
        nvmePath: state.nvmePath,
        profile: state.profile,
      }),
    },
  ),
);
