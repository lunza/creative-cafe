import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import writeAtomic from 'write-file-atomic';
import sanitize from 'sanitize-filename';
import { Group } from '../../../shared/types/groupChat.types';
import { UserDirectories } from '../storage.types';

export class GroupStorageService {
  private static instance: GroupStorageService;
  private groupsPath: string;
  private cache: Map<string, { group: Group; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60 * 1000;

  private constructor(directories: UserDirectories) {
    this.groupsPath = directories.groups;
    if (!fs.existsSync(this.groupsPath)) {
      fs.mkdirSync(this.groupsPath, { recursive: true });
    }
  }

  static getInstance(directories: UserDirectories): GroupStorageService {
    if (!GroupStorageService.instance) {
      GroupStorageService.instance = new GroupStorageService(directories);
    }
    return GroupStorageService.instance;
  }

  static resetInstance(): void {
    GroupStorageService.instance = null as any;
  }

  async getAllGroups(): Promise<Group[]> {
    const files = fs.readdirSync(this.groupsPath).filter((f) => f.endsWith('.json'));
    const groups: Group[] = [];

    for (const file of files) {
      try {
        const group = await this.getGroupFromFile(file);
        if (group) {
          groups.push(group);
        }
      } catch (error) {
        console.error(`Error loading group file ${file}:`, error);
      }
    }

    return groups.sort((a, b) => (b.date_added || 0) - (a.date_added || 0));
  }

  async getGroup(id: string): Promise<Group | null> {
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.group;
    }

    const groupPath = path.join(this.groupsPath, sanitize(`${id}.json`));
    if (!fs.existsSync(groupPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(groupPath, 'utf-8');
      const group = JSON.parse(content) as Group;
      this.cache.set(id, { group, timestamp: Date.now() });
      return group;
    } catch (error) {
      console.error(`Error reading group ${id}:`, error);
      return null;
    }
  }

  async createGroup(data: Partial<Group>): Promise<Group> {
    const now = Date.now();
    const group: Group = {
      id: String(now),
      name: data.name || 'New Group',
      members: data.members || [],
      avatar_url: data.avatar_url || '',
      allow_self_responses: data.allow_self_responses ?? false,
      activation_strategy: data.activation_strategy ?? 0,
      generation_mode: data.generation_mode ?? 0,
      disabled_members: data.disabled_members || [],
      fav: data.fav ?? false,
      chat_id: data.chat_id || this.generateChatId(),
      chats: data.chats || [],
      auto_mode_delay: data.auto_mode_delay ?? 5,
      generation_mode_join_prefix: data.generation_mode_join_prefix || '[{{char}}]',
      generation_mode_join_suffix: data.generation_mode_join_suffix || '',
      hideMutedSprites: data.hideMutedSprites ?? false,
      date_added: now,
      create_date: new Date().toISOString(),
      date_last_chat: now,
      chat_size: 0,
    };

    const groupPath = path.join(this.groupsPath, sanitize(`${group.id}.json`));
    await writeAtomic(groupPath, JSON.stringify(group, null, 2));

    this.cache.set(group.id, { group, timestamp: Date.now() });
    return group;
  }

  async editGroup(group: Group): Promise<boolean> {
    const groupPath = path.join(this.groupsPath, sanitize(`${group.id}.json`));

    if (!fs.existsSync(groupPath)) {
      return false;
    }

    await writeAtomic(groupPath, JSON.stringify(group, null, 2));
    this.cache.set(group.id, { group, timestamp: Date.now() });
    return true;
  }

  async deleteGroup(id: string): Promise<boolean> {
    const groupPath = path.join(this.groupsPath, sanitize(`${id}.json`));

    if (!fs.existsSync(groupPath)) {
      return false;
    }

    fs.unlinkSync(groupPath);
    this.cache.delete(id);
    return true;
  }

  private async getGroupFromFile(filename: string): Promise<Group | null> {
    const groupPath = path.join(this.groupsPath, filename);
    try {
      const content = fs.readFileSync(groupPath, 'utf-8');
      return JSON.parse(content) as Group;
    } catch {
      return null;
    }
  }

  private generateChatId(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}${minutes}${seconds}`;
  }
}
