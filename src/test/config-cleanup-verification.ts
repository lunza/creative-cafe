/**
 * 配置清理验证测试脚本
 * 验证配置文件清理功能和向量数据分离机制
 */

import * as fs from 'fs';
import * as path from 'path';

// 模拟配置清理测试
export async function runConfigCleanupTests(): Promise<void> {
  console.log('========== 开始配置清理验证测试 ==========\n');

  // 测试1: 验证清理服务功能
  await testConfigCleanup();

  // 测试2: 验证配置管理器功能
  await testVectorConfigManager();

  // 测试3: 验证存储写入拦截器
  await testStorageInterceptor();

  console.log('\n========== 所有测试完成 ==========');
}

async function testConfigCleanup(): Promise<void> {
  console.log('[测试1] 配置清理服务验证');
  console.log('-----------------------------------');

  try {
    const { configCleanupService } = await import('../main/services/ConfigCleanupService');
    
    // 检查配置文件状态
    const configInfo = configCleanupService.getConfigInfo();
    console.log(`配置文件路径: ${configInfo.path}`);
    console.log(`配置文件存在: ${configInfo.exists}`);
    console.log(`配置文件大小: ${configInfo.sizeFormatted}`);
    console.log(`需要清理: ${configInfo.needsCleanup}`);
    console.log(`清理原因: ${configInfo.cleanupReason}`);

    // 如果需要清理，执行清理
    if (configInfo.needsCleanup) {
      console.log('\n执行配置清理...');
      const report = await configCleanupService.cleanupConfig();
      
      console.log(`清理成功: ${report.success}`);
      console.log(`原始大小: ${formatBytes(report.originalSize)}`);
      console.log(`清理后大小: ${formatBytes(report.cleanedSize)}`);
      console.log(`减少大小: ${formatBytes(report.sizeReduction)} (${report.sizeReductionPercent.toFixed(2)}%)`);
      console.log(`移除字段: ${report.removedFields.join(', ') || '无'}`);
      console.log(`移除向量数: ${report.removedVectorCount}`);
      console.log(`备份路径: ${report.backupPath || '无'}`);
      console.log(`错误: ${report.errors.join(', ') || '无'}`);
    } else {
      console.log('\n配置文件正常，无需清理');
    }
  } catch (error) {
    console.error('配置清理测试失败:', error);
  }
}

async function testVectorConfigManager(): Promise<void> {
  console.log('\n[测试2] 向量配置管理器验证');
  console.log('-----------------------------------');

  try {
    const { vectorConfigManager } = await import('../main/services/VectorConfigManager');
    
    // 获取配置统计
    const stats = vectorConfigManager.getConfigStats();
    console.log(`配置大小: ${stats.size} bytes`);
    console.log(`配置字段: ${stats.fields.join(', ')}`);
    console.log(`包含禁止字段: ${stats.hasForbiddenFields}`);
    console.log(`嵌入模式: ${stats.embeddingMode || '未设置'}`);

    // 验证配置合法性
    const config = vectorConfigManager.loadVectorConfig();
    const validation = vectorConfigManager.validateConfig(config);
    console.log(`配置验证: ${validation.valid ? '通过' : '失败'}`);
    if (!validation.valid) {
      console.log(`验证错误: ${validation.errors.join(', ')}`);
    }

    // 测试配置清理功能
    const testConfig = {
      embeddingMode: 'remote' as const,
      remoteModel: 'text-embedding-3-small',
      remoteApiUrl: 'https://api.openai.com/v1/embeddings',
      remoteApiKey: 'sk-test123',
      localModel: 'Xenova/all-MiniLM-L6-v2',
      cacheEnabled: true,
      cacheL1Size: 2000,
      cacheL1TTL: 600,
      cacheL2TTL: 7200,
      defaultTopK: 8,
      minSimilarityScore: 0.6,
      contextWindowTokens: 8192,
      autoVectorizeWorldBook: true,
      autoVectorizeKnowledge: true,
      dimension: 1536,
      // 模拟错误添加的数据字段
      vectors: Array(1000).fill(null).map((_, i) => ({
        id: `test_${i}`,
        vector: new Array(1536).fill(0.1),
        metadata: { text: 'test' }
      })),
      vectorData: Array(500).fill({ embedding: new Array(1024).fill(0) })
    };

    const cleanedConfig = vectorConfigManager['sanitizeConfig'](testConfig);
    const cleanedSize = JSON.stringify(cleanedConfig).length;
    
    console.log(`\n测试配置清理:`);
    console.log(`原始配置大小: ${JSON.stringify(testConfig).length} bytes`);
    console.log(`清理后大小: ${cleanedSize} bytes`);
    console.log(`是否移除vectors字段: ${!('vectors' in cleanedConfig)}`);
    console.log(`是否移除vectorData字段: ${!('vectorData' in cleanedConfig)}`);
    console.log(`清理后字段: ${Object.keys(cleanedConfig).join(', ')}`);
  } catch (error) {
    console.error('向量配置管理器测试失败:', error);
  }
}

async function testStorageInterceptor(): Promise<void> {
  console.log('\n[测试3] 存储写入拦截器验证');
  console.log('-----------------------------------');

  try {
    const { getStorageService } = await import('../main/services/storageService');
    const storageService = getStorageService();

    // 测试包含向量数据的配置写入
    const testSettingsWithVectors = {
      aiEngines: [{
        id: 'default',
        name: '测试引擎',
        api_url: 'http://test.com',
        api_key: 'test-key',
        model_name: 'test-model'
      }],
      activeEngineId: 'default',
      logLevel: 'info',
      // 错误地包含向量数据
      vectors: Array(100).fill(null).map((_, i) => ({
        id: `vector_${i}`,
        vector: new Array(768).fill(0.5),
        metadata: { source: 'test' }
      })),
      vector: {
        embeddingMode: 'remote',
        remoteModel: 'test-model',
        remoteApiUrl: 'https://test.com/v1/embeddings',
        remoteApiKey: 'sk-test',
        // 错误地包含向量数据
        vectors: Array(200).fill(null).map((_, i) => ({
          id: `vec_${i}`,
          vector: new Array(768).fill(0.3),
          metadata: { text: 'test data' }
        })),
        cacheEnabled: true,
        defaultTopK: 5
      }
    };

    const originalSize = JSON.stringify(testSettingsWithVectors).length;
    console.log(`测试配置原始大小: ${formatBytes(originalSize)}`);
    console.log(`包含向量数据: ${testSettingsWithVectors.vectors?.length || 0} + ${(testSettingsWithVectors.vector as any).vectors?.length || 0}`);

    // 尝试写入配置
    try {
      storageService.setSettings(testSettingsWithVectors);
      console.log('配置写入成功');
    } catch (writeError) {
      console.log('配置写入被拦截:', writeError instanceof Error ? writeError.message : String(writeError));
    }

    // 验证写入后的配置
    const savedSettings = storageService.getSettings();
    if (savedSettings) {
      const savedSize = JSON.stringify(savedSettings).length;
      const hasTopLevelVectors = 'vectors' in savedSettings;
      const hasVectorConfigVectors = savedSettings.vector && 'vectors' in savedSettings.vector;

      console.log(`\n保存后配置大小: ${formatBytes(savedSize)}`);
      console.log(`包含顶级vectors: ${hasTopLevelVectors}`);
      console.log(`包含vector.vectors: ${hasVectorConfigVectors}`);
      console.log(`配置字段: ${Object.keys(savedSettings).join(', ')}`);
      console.log(`vector字段: ${savedSettings.vector ? Object.keys(savedSettings.vector).join(', ') : '无'}`);

      if (!hasTopLevelVectors && !hasVectorConfigVectors) {
        console.log('✅ 拦截器工作正常：向量数据已被移除');
      } else {
        console.log('❌ 拦截器未能移除向量数据');
      }
    }
  } catch (error) {
    console.error('存储写入拦截器测试失败:', error);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 导出测试函数
export { testConfigCleanup, testVectorConfigManager, testStorageInterceptor };
