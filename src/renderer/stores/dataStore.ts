import { create } from 'zustand';

interface AvailablePlugin {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dependencies?: { [key: string]: string };
  downloadUrl?: string;
  source: 'official' | 'custom';
}

interface InstalledPlugin {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dependencies?: { [key: string]: string };
  path: string;
  enabled: boolean;
  size: number;
  modified: Date;
}

interface DataState {
  characters: any[];
  avatars: any[];
  availablePlugins: AvailablePlugin[];
  installedPlugins: InstalledPlugin[];
  loading: boolean;
  loadingAvailablePlugins: boolean;
  loadingInstalledPlugins: boolean;
  checkingPluginUpdates: boolean;
  updatingPluginDescriptions: boolean;
  installingPlugin: boolean;
  uninstallingPlugin: boolean;
  error: string | null;
  setCharacters: (characters: any[]) => void;
  setAvatars: (avatars: any[]) => void;
  setAvailablePlugins: (plugins: AvailablePlugin[]) => void;
  setInstalledPlugins: (plugins: InstalledPlugin[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  fetchCharacters: () => Promise<void>;
  fetchAvatars: () => Promise<void>;
  fetchAvailablePlugins: (forceRefresh?: boolean) => Promise<void>;
  fetchInstalledPlugins: () => Promise<void>;
  togglePlugin: (pluginId: string, enabled: boolean) => Promise<void>;
  uninstallPlugin: (pluginId: string) => Promise<void>;
  checkPluginUpdates: () => Promise<void>;
  updatePluginDescriptions: (translatedPlugins: AvailablePlugin[]) => Promise<void>;
  installPlugin: (url: string, branch?: string) => Promise<void>;
  uninstallPluginById: (pluginId: string) => Promise<void>;
  optimizeCharacter: (path: string) => Promise<void>;
}

export const useDataStore = create<DataState>((set, get) => ({
  characters: [],
  avatars: [],
  availablePlugins: [],
  installedPlugins: [],
  loading: false,
  loadingAvailablePlugins: false,
  loadingInstalledPlugins: false,
  checkingPluginUpdates: false,
  updatingPluginDescriptions: false,
  installingPlugin: false,
  uninstallingPlugin: false,
  error: null,
  setCharacters: (characters) => set({ characters }),
  setAvatars: (avatars) => set({ avatars }),
  setAvailablePlugins: (plugins) => set({ availablePlugins: plugins }),
  setInstalledPlugins: (plugins) => set({ installedPlugins: plugins }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  fetchCharacters: async () => {
    set({ loading: true, error: null });
    try {
      const characters = await window.electronAPI.character.list();
      set({ characters, loading: false });
    } catch (error) {
      set({ error: 'Failed to fetch characters', loading: false });
    }
  },
  fetchAvatars: async () => {
    set({ loading: true, error: null });
    try {
      const avatars = await window.electronAPI.avatar.list();
      set({ avatars, loading: false });
    } catch (error) {
      set({ error: 'Failed to fetch avatars', loading: false });
    }
  },
  fetchAvailablePlugins: async (forceRefresh?: boolean) => {
    set({ loadingAvailablePlugins: true, error: null });
    try {
      const plugins = await window.electronAPI.plugin.getAvailable(forceRefresh);
      set({ availablePlugins: plugins, loadingAvailablePlugins: false });
    } catch (error) {
      set({ error: 'Failed to fetch available plugins', loadingAvailablePlugins: false });
    }
  },
  fetchInstalledPlugins: async () => {
    set({ loadingInstalledPlugins: true, error: null });
    try {
      const plugins = await window.electronAPI.plugin.getInstalled();
      set({ installedPlugins: plugins, loadingInstalledPlugins: false });
    } catch (error) {
      set({ error: 'Failed to fetch installed plugins', loadingInstalledPlugins: false });
    }
  },
  togglePlugin: async (pluginId: string, enabled: boolean) => {
    set({ loadingInstalledPlugins: true, error: null });
    try {
      const result = await window.electronAPI.plugin.toggle(pluginId, enabled);
      if (result.success) {
        await get().fetchInstalledPlugins();
      } else {
        throw new Error(result.error || 'Failed to toggle plugin');
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to toggle plugin', loadingInstalledPlugins: false });
    }
  },
  uninstallPlugin: async (pluginId: string) => {
    set({ loadingInstalledPlugins: true, error: null });
    try {
      const result = await window.electronAPI.plugin.uninstall(pluginId);
      if (result.success) {
        await get().fetchInstalledPlugins();
      } else {
        throw new Error(result.error || 'Failed to uninstall plugin');
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to uninstall plugin', loadingInstalledPlugins: false });
    }
  },
  optimizeCharacter: async (path) => {
    set({ loading: true, error: null });
    try {
      set({ loading: false });
    } catch (error) {
      set({ error: 'Failed to optimize character', loading: false });
    }
  },
  checkPluginUpdates: async () => {
    set({ checkingPluginUpdates: true, error: null });
    try {
      const result = await window.electronAPI.plugin.checkUpdates();
      if (result.success && result.plugins) {
        set({ availablePlugins: result.plugins, checkingPluginUpdates: false });
      } else {
        throw new Error(result.error || 'Failed to check updates');
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to check plugin updates', checkingPluginUpdates: false });
      throw error;
    }
  },
  updatePluginDescriptions: async (translatedPlugins: AvailablePlugin[]) => {
    set({ updatingPluginDescriptions: true, error: null });
    try {
      const result = await window.electronAPI.plugin.updateDescriptions(translatedPlugins);
      if (result.success) {
        set({ availablePlugins: translatedPlugins, updatingPluginDescriptions: false });
      } else {
        throw new Error(result.error || 'Failed to update descriptions');
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update plugin descriptions', updatingPluginDescriptions: false });
      throw error;
    }
  },
  installPlugin: async (url: string, branch?: string): Promise<any> => {
    set({ installingPlugin: true, error: null });
    try {
      const result = await window.electronAPI.plugin.install(url, branch);
      if (result.success) {
        await get().fetchInstalledPlugins();
        set({ installingPlugin: false });
        return result;
      } else {
        throw new Error(result.error || 'Failed to install plugin');
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to install plugin', installingPlugin: false });
      throw error;
    }
  },
  uninstallPluginById: async (pluginId: string) => {
    set({ uninstallingPlugin: true, error: null });
    try {
      const result = await window.electronAPI.plugin.uninstallById(pluginId);
      if (result.success) {
        await get().fetchInstalledPlugins();
        set({ uninstallingPlugin: false });
      } else {
        throw new Error(result.error || 'Failed to uninstall plugin');
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to uninstall plugin', uninstallingPlugin: false });
      throw error;
    }
  }
}));
