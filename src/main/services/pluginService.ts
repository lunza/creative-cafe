import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import https from 'https';
import simpleGit from 'simple-git';
import sanitize from 'sanitize-filename';
import { pathService } from './pathService';
import { getUserDataPath } from '../utils/appPath';

interface PluginMetadata {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
  dependencies?: { [key: string]: string };
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

class PluginService {
  private pluginDir: string;
  private availablePluginsCache: AvailablePlugin[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30分钟
  private localPluginsDataPath: string;
  private rawPluginsDataPath: string;

  constructor() {
    // 从 pathService 获取解析后的插件路径
    this.pluginDir = pathService.getCustomPath('plugin');
    // 本地插件数据存储路径 - 使用用户数据目录
    const userDataPath = getUserDataPath();
    this.localPluginsDataPath = path.join(userDataPath, 'data', 'plugins-local.json');
    this.rawPluginsDataPath = path.join(userDataPath, 'data', 'plugins-raw.json');
    console.log('Plugin directory:', this.pluginDir);
    console.log('Local plugins data path:', this.localPluginsDataPath);
  }

  private async ensureDataDir(): Promise<void> {
    const dataDir = path.dirname(this.localPluginsDataPath);
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }
  }

  private async loadLocalRawData(): Promise<any> {
    try {
      const data = await fs.readFile(this.rawPluginsDataPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.log('No local raw data found:', error);
      return null;
    }
  }

  private async saveLocalRawData(data: any): Promise<void> {
    await this.ensureDataDir();
    await fs.writeFile(this.rawPluginsDataPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async loadLocalPluginsData(): Promise<AvailablePlugin[] | null> {
    try {
      const data = await fs.readFile(this.localPluginsDataPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.log('No local plugins data found:', error);
      return null;
    }
  }

  private async saveLocalPluginsData(plugins: AvailablePlugin[]): Promise<void> {
    await this.ensureDataDir();
    await fs.writeFile(this.localPluginsDataPath, JSON.stringify(plugins, null, 2), 'utf-8');
  }

  private translateDescription(description: string): string {
    const translations: Record<string, string> = {
      'Extension Manager': '插件管理器',
      'Manage and install third-party extensions': '管理和安装第三方插件',
      'Memory Extension': '记忆插件',
      'Adds long-term memory capabilities to characters': '为角色添加长期记忆功能',
      'Character Expressions': '角色表情',
      'Add custom expressions to characters': '为角色添加自定义表情',
      'ST Memory Enhancement': 'ST记忆增强',
      'Enhanced memory system with better recall': '增强的记忆系统，具有更好的回忆能力',
      'Quick Replies': '快速回复',
      'Add quick reply buttons to chat': '为聊天添加快速回复按钮',
      'Stable Diffusion': 'Stable Diffusion',
      'Image generation using Stable Diffusion': '使用Stable Diffusion生成图片',
      'Text to Speech': '文本转语音',
      'Add TTS capabilities to chat': '为聊天添加TTS功能',
      'World Info': '世界信息',
      'Advanced world information management': '高级世界信息管理',
      'Chat Backgrounds': '聊天背景',
      'Custom backgrounds for chat interface': '聊天界面的自定义背景',
      'API Connections': 'API连接',
      'Manage multiple API connections': '管理多个API连接',
      'Group Chats': '群组聊天',
      'Multi-character group chat support': '多角色群组聊天支持',
      'Character Gallery': '角色画廊',
      'Character image gallery viewer': '角色图片画廊查看器',
      'Theme Manager': '主题管理器',
      'Custom themes and styling': '自定义主题和样式',
      'Macro System': '宏系统',
      'Advanced macro and template system': '高级宏和模板系统',
      'Context Manager': '上下文管理器',
      'Advanced context management': '高级上下文管理',
      'Prompt Manager': '提示词管理器',
      'Advanced prompt template management': '高级提示词模板管理'
    };
    
    for (const [en, zh] of Object.entries(translations)) {
      if (description.toLowerCase().includes(en.toLowerCase())) {
        return zh;
      }
    }
    
    return description;
  }

  private extractAuthorFromUrl(url?: string): string | null {
    if (!url) return null;
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.host === 'github.com') {
        const pathSegments = parsedUrl.pathname.split('/').filter(s => s.length > 0);
        if (pathSegments.length >= 1) {
          return pathSegments[0];
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  async getAvailablePlugins(forceRefresh: boolean = false): Promise<AvailablePlugin[]> {
    const now = Date.now();
    
    if (!forceRefresh && 
        this.availablePluginsCache && 
        (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      console.log('Returning cached available plugins');
      return this.availablePluginsCache;
    }
    
    try {
      if (!forceRefresh) {
        // 先尝试读取本地数据
        const localPlugins = await this.loadLocalPluginsData();
        if (localPlugins && localPlugins.length > 0) {
          console.log('Returning local plugins data');
          this.availablePluginsCache = localPlugins;
          this.cacheTimestamp = now;
          return localPlugins;
        }
      }
      
      // 如果没有本地数据或者强制刷新，从 GitHub 获取
      console.log('Fetching available plugins from GitHub...');
      const plugins = await this.fetchAvailablePluginsFromGitHub();
      
      // 保存到本地
      await this.saveLocalPluginsData(plugins);
      
      this.availablePluginsCache = plugins;
      this.cacheTimestamp = now;
      return plugins;
    } catch (error) {
      console.error('Failed to fetch available plugins:', error);
      if (this.availablePluginsCache) {
        console.log('Returning cached plugins as fallback');
        return this.availablePluginsCache;
      }
      return [];
    }
  }

  async checkAndUpdatePlugins(): Promise<{ success: boolean; plugins?: AvailablePlugin[]; error?: string }> {
    try {
      console.log('Checking for plugin updates...');
      
      // 先从 GitHub 获取原始数据并保存
      const rawData = await this.fetchRawPluginsDataFromGitHub();
      await this.saveLocalRawData(rawData);
      
      // 解析插件数据
      const plugins = this.parseRawPluginsData(rawData);
      
      // 保存解析后的插件数据
      await this.saveLocalPluginsData(plugins);
      
      this.availablePluginsCache = plugins;
      this.cacheTimestamp = Date.now();
      
      console.log('Plugins updated successfully');
      return { success: true, plugins };
    } catch (error) {
      console.error('Failed to check and update plugins:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async updatePluginDescriptions(translatedPlugins: AvailablePlugin[]): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Updating plugin descriptions...');
      
      // 保存翻译后的插件数据
      await this.saveLocalPluginsData(translatedPlugins);
      
      this.availablePluginsCache = translatedPlugins;
      this.cacheTimestamp = Date.now();
      
      console.log('Plugin descriptions updated successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to update plugin descriptions:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private async fetchRawPluginsDataFromGitHub(): Promise<any> {
    const url = 'https://raw.githubusercontent.com/SillyTavern/SillyTavern-Content/main/index.json';
    
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (error) {
            console.error('Failed to parse plugins JSON:', error);
            reject(error);
          }
        });
      }).on('error', (error) => {
        console.error('Failed to fetch plugins:', error);
        reject(error);
      });
    });
  }

  private parseRawPluginsData(rawData: any): AvailablePlugin[] {
    const plugins: AvailablePlugin[] = [];
    
    if (Array.isArray(rawData)) {
      let index = 0;
      rawData.forEach((item: any) => {
        if (item.type === 'extension') {
          const repoUrl = item.repository || item.url;
          const authorFromUrl = this.extractAuthorFromUrl(repoUrl);
          const author = item.author || authorFromUrl;
          
          const isOfficial = author && (
            author.toLowerCase() === 'sillytavern' ||
            author.toLowerCase() === '@sillytavern' ||
            (repoUrl && repoUrl.toLowerCase().includes('sillytavern'))
          );
          
          const originalDescription = item.description || '';
          const translatedDescription = this.translateDescription(originalDescription);
          
          plugins.push({
            id: `official-${index}`,
            name: item.name || item.display_name || item.id || `plugin-${index}`,
            displayName: item.display_name || item.name || item.id || `Plugin ${index}`,
            description: translatedDescription || originalDescription,
            version: item.version || '1.0.0',
            author: author,
            homepage: item.homepage,
            repository: repoUrl,
            keywords: item.keywords,
            dependencies: item.dependencies,
            downloadUrl: item.download_url || repoUrl,
            source: isOfficial ? 'official' : 'custom'
          });
          index++;
        }
      });
    }
    
    console.log('Parsed plugins:', plugins.length);
    return plugins;
  }

  private async fetchAvailablePluginsFromGitHub(): Promise<AvailablePlugin[]> {
    const rawData = await this.fetchRawPluginsDataFromGitHub();
    return this.parseRawPluginsData(rawData);
  }

  async getInstalledPlugins(): Promise<InstalledPlugin[]> {
    try {
      console.log('Scanning installed plugins:', this.pluginDir);
      
      try {
        await fs.access(this.pluginDir);
      } catch {
        console.log('Plugin directory does not exist, returning empty list');
        return [];
      }
      
      const files = await fs.readdir(this.pluginDir, { withFileTypes: true });
      const pluginDirs = files.filter(f => f.isDirectory());
      
      const plugins: InstalledPlugin[] = [];
      
      for (const dir of pluginDirs) {
        const pluginPath = path.join(this.pluginDir, dir.name);
        const metadataPath = path.join(pluginPath, 'manifest.json');
        
        let metadata: PluginMetadata = {
          name: dir.name,
          displayName: dir.name,
          description: '',
          version: '1.0.0'
        };
        
        try {
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          metadata = JSON.parse(metadataContent);
        } catch (error) {
          console.log(`No manifest.json found for plugin ${dir.name}, using defaults`);
        }
        
        const stats = await fs.stat(pluginPath);
        const enabled = await this.isPluginEnabled(dir.name);
        
        const originalDescription = metadata.description || '';
        const translatedDescription = this.translateDescription(originalDescription);
        
        plugins.push({
          id: `installed-${dir.name}`,
          name: metadata.name || dir.name,
          displayName: metadata.displayName || metadata.name || dir.name,
          description: translatedDescription || originalDescription,
          version: metadata.version || '1.0.0',
          author: metadata.author,
          homepage: metadata.homepage,
          repository: metadata.repository,
          keywords: metadata.keywords,
          dependencies: metadata.dependencies,
          path: pluginPath,
          enabled,
          size: stats.size,
          modified: stats.mtime
        });
      }
      
      console.log('Installed plugins found:', plugins.length);
      return plugins;
    } catch (error) {
      console.error('Failed to list installed plugins:', error);
      return [];
    }
  }

  private async isPluginEnabled(pluginName: string): Promise<boolean> {
    try {
      const disabledPath = path.join(this.pluginDir, pluginName, '.disabled');
      await fs.access(disabledPath);
      return false;
    } catch {
      return true;
    }
  }

  async installPlugin(url: string, branch?: string): Promise<{ 
    success: boolean; 
    plugin?: InstalledPlugin; 
    error?: string;
    displayName?: string;
    version?: string;
    author?: string;
  }> {
    try {
      console.log('Installing plugin from:', url);
      
      if (!fsSync.existsSync(this.pluginDir)) {
        await fs.mkdir(this.pluginDir, { recursive: true });
      }

      // 确保 URL 以 .git 结尾
      let gitUrl = url;
      if (!gitUrl.endsWith('.git')) {
        gitUrl = gitUrl.endsWith('/') ? `${gitUrl.slice(0, -1)}.git` : `${gitUrl}.git`;
      }
      
      const folderName = sanitize(path.basename(gitUrl, '.git'));
      const extensionPath = path.join(this.pluginDir, folderName);

      if (fsSync.existsSync(extensionPath)) {
        return { success: false, error: `Directory already exists at ${extensionPath}` };
      }

      const git = simpleGit();
      
      // 构建 git clone 命令参数
      const args = ['clone', '--depth', '1'];
      if (branch) {
        args.push('--branch', branch);
      }
      args.push(gitUrl, extensionPath);
      
      console.log('Executing git command:', args.join(' '));
      await git.raw(args);
      console.log(`Plugin cloned to: ${extensionPath}`);

      const manifestPath = path.join(extensionPath, 'manifest.json');
      let metadata: PluginMetadata = {
        name: folderName,
        displayName: folderName,
        description: '',
        version: '1.0.0'
      };

      try {
        const metadataContent = await fs.readFile(manifestPath, 'utf-8');
        const rawMetadata = JSON.parse(metadataContent);
        metadata = {
          name: rawMetadata.name || folderName,
          displayName: rawMetadata.display_name || rawMetadata.name || folderName,
          description: rawMetadata.description || '',
          version: rawMetadata.version || '1.0.0',
          author: rawMetadata.author,
          homepage: rawMetadata.homepage,
          repository: rawMetadata.repository,
          keywords: rawMetadata.keywords,
          dependencies: rawMetadata.dependencies
        };
      } catch (error) {
        console.log('No manifest.json found, using defaults');
      }

      const stats = await fs.stat(extensionPath);
      
      const installedPlugin: InstalledPlugin = {
        id: `installed-${folderName}`,
        name: metadata.name || folderName,
        displayName: metadata.displayName || metadata.name || folderName,
        description: this.translateDescription(metadata.description || ''),
        version: metadata.version || '1.0.0',
        author: metadata.author,
        homepage: metadata.homepage,
        repository: metadata.repository,
        keywords: metadata.keywords,
        dependencies: metadata.dependencies,
        path: extensionPath,
        enabled: true,
        size: stats.size,
        modified: stats.mtime
      };

      console.log('Plugin installed successfully:', installedPlugin.displayName);
      return { 
        success: true, 
        plugin: installedPlugin,
        displayName: installedPlugin.displayName,
        version: installedPlugin.version,
        author: installedPlugin.author
      };
    } catch (error) {
      console.error('Failed to install plugin:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async uninstallPluginById(pluginId: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('Uninstalling plugin:', pluginId);
      
      const plugins = await this.getInstalledPlugins();
      const plugin = plugins.find(p => p.id === pluginId);
      
      if (!plugin) {
        return { success: false, error: 'Plugin not found' };
      }

      console.log('Deleting plugin directory:', plugin.path);
      
      await fs.rm(plugin.path, { recursive: true, force: true });
      
      console.log('Plugin uninstalled successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async togglePlugin(pluginId: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
    try {
      const plugins = await this.getInstalledPlugins();
      const plugin = plugins.find(p => p.id === pluginId);
      
      if (!plugin) {
        return { success: false, error: 'Plugin not found' };
      }
      
      const disabledPath = path.join(plugin.path, '.disabled');
      
      if (enabled) {
        try {
          await fs.unlink(disabledPath);
        } catch {
          // 文件不存在，不做处理
        }
      } else {
        await fs.writeFile(disabledPath, '');
      }
      
      return { success: true };
    } catch (error) {
      console.error('Failed to toggle plugin:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async uninstallPlugin(pluginId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const plugins = await this.getInstalledPlugins();
      const plugin = plugins.find(p => p.id === pluginId);
      
      if (!plugin) {
        return { success: false, error: 'Plugin not found' };
      }
      
      console.log('Uninstalling plugin:', plugin.path);
      
      const rimraf = await import('rimraf');
      await rimraf.rimraf(plugin.path);
      
      return { success: true };
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  getPluginDir() {
    return this.pluginDir;
  }

  setPluginDir(dir: string) {
    let resolvedPath = dir;
    if (!path.isAbsolute(dir)) {
      const appRootDir = process.cwd();
      resolvedPath = path.resolve(appRootDir, dir);
    }
    this.pluginDir = path.normalize(resolvedPath);
    console.log('Plugin directory set to:', this.pluginDir);
  }
}

export const pluginService = new PluginService();
