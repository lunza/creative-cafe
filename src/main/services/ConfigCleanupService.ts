/**
 * 配置清理服务
 * 用于清理配置文件中错误存储的向量数据
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getStorageService } from './storageService';

// 禁止的数据字段（向量数据相关）
const FORBIDDEN_VECTOR_FIELDS = [
  'vectors', 'vectorData', 'embeddings', 'items', 'records',
  'vectorArray', 'vectors_data', 'data', 'entries'
];

// 合法配置字段白名单
const ALLOWED_VECTOR_CONFIG_FIELDS = [
  'embeddingMode', 'remoteModel', 'remoteApiUrl', 'remoteApiKey',
  'remoteApiKeyTransmission', 'localModel', 'vectorStoreMode',
  'cacheEnabled', 'cacheL1Size', 'cacheL1TTL', 'cacheL2TTL',
  'defaultTopK', 'minSimilarityScore', 'contextWindowTokens',
  'autoVectorizeWorldBook', 'autoVectorizeKnowledge',
  'autoRetrieveContext', 'contextTopK', 'contextMinScore',
  'dimension'
];

// 配置大小阈值（10KB）
const MAX_CONFIG_SIZE_BYTES = 10000;

export interface CleanupReport {
  originalSize: number;
  cleanedSize: number;
  sizeReduction: number;
  sizeReductionPercent: number;
  removedFields: string[];
  removedVectorCount: number;
  backupPath: string | null;
  success: boolean;
  errors: string[];
}

export class ConfigCleanupService {
  private settingsPath: string;
  private baseDataPath: string;

  constructor() {
    this.baseDataPath = path.join(app.getPath('userData'), 'data');
    this.settingsPath = path.join(this.baseDataPath, 'settings.json');
  }

  /**
   * 执行配置清理
   */
  async cleanupConfig(): Promise<CleanupReport> {
    const report: CleanupReport = {
      originalSize: 0,
      cleanedSize: 0,
      sizeReduction: 0,
      sizeReductionPercent: 0,
      removedFields: [],
      removedVectorCount: 0,
      backupPath: null,
      success: false,
      errors: []
    };

    try {
      // 检查配置文件是否存在
      if (!fs.existsSync(this.settingsPath)) {
        report.errors.push('配置文件不存在');
        return report;
      }

      // 读取原始配置
      const rawContent = fs.readFileSync(this.settingsPath, 'utf-8');
      report.originalSize = rawContent.length;

      // 解析配置
      let settings: any;
      try {
        settings = JSON.parse(rawContent);
      } catch (parseError) {
        report.errors.push('配置文件JSON解析失败');
        return report;
      }

      // 备份原始配置
      report.backupPath = await this.createBackup(settings);

      // 清理配置
      const cleanedSettings = this.sanitizeSettings(settings, report);

      // 计算清理后的大小
      const cleanedContent = JSON.stringify(cleanedSettings, null, 2);
      report.cleanedSize = cleanedContent.length;
      report.sizeReduction = report.originalSize - report.cleanedSize;
      report.sizeReductionPercent = report.originalSize > 0 
        ? (report.sizeReduction / report.originalSize * 100) 
        : 0;

      // 写入清理后的配置
      fs.writeFileSync(this.settingsPath, cleanedContent, 'utf-8');

      // 同步更新存储管理器
      try {
        const storageService = getStorageService();
        storageService.set('settings', cleanedSettings);
      } catch (syncError) {
        console.warn('[ConfigCleanupService] 同步存储管理器失败:', syncError);
      }

      report.success = true;

      console.log(`[ConfigCleanupService] 配置清理完成:`);
      console.log(`  原始大小: ${this.formatBytes(report.originalSize)}`);
      console.log(`  清理后大小: ${this.formatBytes(report.cleanedSize)}`);
      console.log(`  减少大小: ${this.formatBytes(report.sizeReduction)} (${report.sizeReductionPercent.toFixed(2)}%)`);
      console.log(`  移除字段: ${report.removedFields.join(', ')}`);
      console.log(`  移除向量数: ${report.removedVectorCount}`);

    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : '未知错误');
      console.error('[ConfigCleanupService] 配置清理失败:', error);
    }

    return report;
  }

  /**
   * 创建配置备份
   */
  private async createBackup(settings: any): Promise<string | null> {
    try {
      const backupDir = path.join(this.baseDataPath, 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `settings_backup_${timestamp}.json`);
      
      fs.writeFileSync(backupPath, JSON.stringify(settings, null, 2), 'utf-8');
      console.log(`[ConfigCleanupService] 配置已备份到: ${backupPath}`);
      return backupPath;
    } catch (backupError) {
      console.warn('[ConfigCleanupService] 创建备份失败:', backupError);
      return null;
    }
  }

  /**
   * 清理配置
   */
  private sanitizeSettings(settings: any, report: CleanupReport): any {
    const sanitized = { ...settings };

    // 1. 移除顶级向量数据字段
    for (const key of FORBIDDEN_VECTOR_FIELDS) {
      if (sanitized[key] && Array.isArray(sanitized[key])) {
        const vectorCount = sanitized[key].length;
        console.warn(`[ConfigCleanupService] 移除顶级向量数据字段 "${key}"，包含 ${vectorCount} 个向量`);
        report.removedFields.push(key);
        report.removedVectorCount += vectorCount;
        delete sanitized[key];
      }
    }

    // 2. 清理 vector 配置字段
    if (sanitized.vector) {
      const vectorConfig = sanitized.vector;
      const vectorConfigSize = JSON.stringify(vectorConfig).length;

      // 如果 vector 配置超过阈值，进行深度清理
      if (vectorConfigSize > MAX_CONFIG_SIZE_BYTES) {
        console.warn(`[ConfigCleanupService] vector配置异常大: ${this.formatBytes(vectorConfigSize)}，执行深度清理`);

        const cleanedVectorConfig: any = {};

        // 仅保留合法配置字段
        for (const field of ALLOWED_VECTOR_CONFIG_FIELDS) {
          if (field in vectorConfig) {
            cleanedVectorConfig[field] = vectorConfig[field];
          }
        }

        // 移除禁止的数据字段
        for (const key of FORBIDDEN_VECTOR_FIELDS) {
          if (cleanedVectorConfig[key]) {
            const vectorCount = Array.isArray(cleanedVectorConfig[key]) 
              ? cleanedVectorConfig[key].length 
              : 0;
            console.warn(`[ConfigCleanupService] 从vector配置中移除数据字段 "${key}"，包含 ${vectorCount} 个向量`);
            report.removedFields.push(`vector.${key}`);
            report.removedVectorCount += vectorCount;
            delete cleanedVectorConfig[key];
          }
        }

        // 检查是否还有嵌套的向量数据
        this.removeNestedVectorData(cleanedVectorConfig, 'vector', report);

        sanitized.vector = cleanedVectorConfig;
        const newSize = JSON.stringify(cleanedVectorConfig).length;
        console.log(`[ConfigCleanupService] vector配置已清理: ${this.formatBytes(vectorConfigSize)} -> ${this.formatBytes(newSize)}`);
      } else {
        // 即使配置大小正常，也要检查是否包含禁止字段
        for (const key of FORBIDDEN_VECTOR_FIELDS) {
          if (vectorConfig[key]) {
            const vectorCount = Array.isArray(vectorConfig[key]) 
              ? vectorConfig[key].length 
              : 0;
            console.warn(`[ConfigCleanupService] 从vector配置中移除数据字段 "${key}"，包含 ${vectorCount} 个向量`);
            report.removedFields.push(`vector.${key}`);
            report.removedVectorCount += vectorCount;
            delete vectorConfig[key];
          }
        }
      }
    }

    // 3. 检查其他可能包含向量数据的字段
    this.scanForVectorData(sanitized, '', report);

    return sanitized;
  }

  /**
   * 递归移除嵌套的向量数据
   */
  private removeNestedVectorData(obj: any, parentPath: string, report: CleanupReport): void {
    if (!obj || typeof obj !== 'object') return;

    for (const key of FORBIDDEN_VECTOR_FIELDS) {
      if (key in obj) {
        const value = obj[key];
        if (Array.isArray(value)) {
          console.warn(`[ConfigCleanupService] 移除嵌套向量数据: ${parentPath}.${key}，包含 ${value.length} 个向量`);
          report.removedFields.push(`${parentPath}.${key}`);
          report.removedVectorCount += value.length;
          delete obj[key];
        }
      }
    }
  }

  /**
   * 扫描配置中可能隐藏的向量数据
   */
  private scanForVectorData(obj: any, path: string, report: CleanupReport): void {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (Array.isArray(value)) {
        // 检查数组是否为向量数据
        if (value.length > 100 && value.every(item => 
          typeof item === 'object' && item !== null && ('vector' in item || 'embedding' in item)
        )) {
          console.warn(`[ConfigCleanupService] 检测到向量数据数组: ${currentPath}，包含 ${value.length} 个向量`);
          report.removedFields.push(currentPath);
          report.removedVectorCount += value.length;
          delete obj[key];
        }
      } else if (typeof value === 'object' && value !== null) {
        // 递归检查对象
        this.scanForVectorData(value, currentPath, report);
      }
    }
  }

  /**
   * 格式化字节数
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 检查配置是否需要清理
   */
  needsCleanup(): { needs: boolean; reason: string; currentSize: number } {
    try {
      if (!fs.existsSync(this.settingsPath)) {
        return { needs: false, reason: '配置文件不存在', currentSize: 0 };
      }

      const stats = fs.statSync(this.settingsPath);
      const content = fs.readFileSync(this.settingsPath, 'utf-8');
      
      // 检查文件大小
      if (stats.size > MAX_CONFIG_SIZE_BYTES) {
        return { 
          needs: true, 
          reason: `配置文件过大: ${this.formatBytes(stats.size)}`,
          currentSize: stats.size
        };
      }

      // 检查内容
      const settings = JSON.parse(content);
      
      // 检查是否包含向量数据字段
      for (const key of FORBIDDEN_VECTOR_FIELDS) {
        if (settings[key] && Array.isArray(settings[key]) && settings[key].length > 0) {
          return { 
            needs: true, 
            reason: `配置包含向量数据字段: ${key} (${settings[key].length} 个向量)`,
            currentSize: stats.size
          };
        }
      }

      // 检查 vector 配置
      if (settings.vector) {
        const vectorConfigSize = JSON.stringify(settings.vector).length;
        if (vectorConfigSize > MAX_CONFIG_SIZE_BYTES) {
          return { 
            needs: true, 
            reason: `vector配置过大: ${this.formatBytes(vectorConfigSize)}`,
            currentSize: stats.size
          };
        }

        for (const key of FORBIDDEN_VECTOR_FIELDS) {
          if (settings.vector[key] && Array.isArray(settings.vector[key]) && settings.vector[key].length > 0) {
            return { 
              needs: true, 
              reason: `vector配置包含向量数据: ${key} (${settings.vector[key].length} 个向量)`,
              currentSize: stats.size
            };
          }
        }
      }

      return { needs: false, reason: '配置正常', currentSize: stats.size };
    } catch (error) {
      return { 
        needs: true, 
        reason: error instanceof Error ? error.message : '配置检查失败',
        currentSize: 0
      };
    }
  }

  /**
   * 获取配置文件信息
   */
  getConfigInfo(): {
    path: string;
    exists: boolean;
    size: number;
    sizeFormatted: string;
    lastModified: string | null;
    needsCleanup: boolean;
    cleanupReason: string;
  } {
    const exists = fs.existsSync(this.settingsPath);
    let size = 0;
    let lastModified: string | null = null;

    if (exists) {
      const stats = fs.statSync(this.settingsPath);
      size = stats.size;
      lastModified = stats.mtime.toISOString();
    }

    const cleanupCheck = this.needsCleanup();

    return {
      path: this.settingsPath,
      exists,
      size,
      sizeFormatted: this.formatBytes(size),
      lastModified,
      needsCleanup: cleanupCheck.needs,
      cleanupReason: cleanupCheck.reason
    };
  }
}

export const configCleanupService = new ConfigCleanupService();
