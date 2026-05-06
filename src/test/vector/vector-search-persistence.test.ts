/**
 * 向量搜索与持久化问题诊断测试脚本
 * 
 * 测试目标：
 * 1. 验证世界书数据完整向量化
 * 2. 验证 VecStore 持久化机制
 * 3. 验证向量搜索相关性
 * 
 * 测试数据：
 * - 世界书文件: src/test/vector/data/狼人杀1.0_修复版.json
 * - 配置文件: src/test/vector/data/settings.json
 * 
 * 测试环境：
 * - 向量化模型: text-embedding-qwen3-embedding-8b
 * - 向量存储: VecStore (vecstore-wasm)
 */

import * as fs from 'fs';
import * as path from 'path';

// 测试结果接口
interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
  timestamp: number;
}

// 测试报告
interface TestReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
  startTime: number;
  endTime: number;
}

// 世界书条目接口
interface WorldBookEntry {
  uid: number;
  name: string;
  content: string;
  key?: string[];
  [key: string]: any;
}

// 世界书数据接口
interface WorldBookData {
  entries?: Record<string, WorldBookEntry>;
  [key: string]: any;
}

// 测试结果收集器
class TestRunner {
  private results: TestResult[] = [];
  private startTime: number = Date.now();

  addResult(name: string, status: 'pass' | 'fail' | 'skip', detail: string): void {
    console.log(`[${status.toUpperCase()}] ${name}: ${detail}`);
    this.results.push({
      name,
      status,
      detail,
      timestamp: Date.now()
    });
  }

  getReport(): TestReport {
    return {
      total: this.results.length,
      passed: this.results.filter(r => r.status === 'pass').length,
      failed: this.results.filter(r => r.status === 'fail').length,
      skipped: this.results.filter(r => r.status === 'skip').length,
      results: this.results,
      startTime: this.startTime,
      endTime: Date.now()
    };
  }

  printSummary(): void {
    const report = this.getReport();
    console.log('\n' + '='.repeat(80));
    console.log('测试报告摘要');
    console.log('='.repeat(80));
    console.log(`总测试数: ${report.total}`);
    console.log(`通过: ${report.passed}`);
    console.log(`失败: ${report.failed}`);
    console.log(`跳过: ${report.skipped}`);
    console.log(`耗时: ${(report.endTime - report.startTime) / 1000}s`);
    console.log('='.repeat(80));
    console.log('\n详细结果:');
    this.results.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.status.toUpperCase()}] ${r.name}`);
      console.log(`     ${r.detail}`);
    });
  }
}

// 测试脚本主函数
async function runTests(): Promise<void> {
  const runner = new TestRunner();
  
  console.log('='.repeat(80));
  console.log('开始向量搜索与持久化问题诊断测试');
  console.log('='.repeat(80));

  // Task 1: 世界书数据向量化测试
  await testWorldBookVectorization(runner);
  
  // Task 2: 向量搜索测试
  await testVectorSearch(runner);
  
  // Task 3: 持久化验证测试
  await testPersistence(runner);

  // 打印测试报告
  runner.printSummary();
}

/**
 * Task 1: 世界书数据向量化测试
 */
async function testWorldBookVectorization(runner: TestRunner): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('Task 1: 世界书数据向量化测试');
  console.log('='.repeat(80));

  const worldBookPath = path.join(__dirname, 'data', '狼人杀1.0_修复版.json');
  const settingsPath = path.join(__dirname, 'data', 'settings.json');

  // SubTask 1.1: 读取世界书数据文件
  try {
    console.log('\n[SubTask 1.1] 读取世界书数据文件...');
    console.log(`  文件路径: ${worldBookPath}`);
    
    const content = await fs.promises.readFile(worldBookPath, 'utf-8');
    const worldBookData: WorldBookData = JSON.parse(content);
    
    const entryCount = worldBookData.entries ? Object.keys(worldBookData.entries).length : 0;
    console.log(`  世界书条目数量: ${entryCount}`);
    
    runner.addResult(
      '读取世界书数据文件',
      entryCount > 0 ? 'pass' : 'fail',
      `成功读取 ${entryCount} 个条目`
    );

    // 验证条目内容完整性
    let validEntries = 0;
    let emptyEntries = 0;
    const entryNames: string[] = [];
    
    if (worldBookData.entries) {
      for (const [key, entry] of Object.entries(worldBookData.entries)) {
        entryNames.push(entry.name || `Entry ${key}`);
        if (entry.content && entry.content.trim().length > 0) {
          validEntries++;
        } else {
          emptyEntries++;
        }
      }
    }
    
    console.log(`  有效条目: ${validEntries}`);
    console.log(`  空条目: ${emptyEntries}`);
    console.log(`  前10个条目: ${entryNames.slice(0, 10).join(', ')}`);
    
    runner.addResult(
      '验证条目内容完整性',
      validEntries > 0 ? 'pass' : 'fail',
      `${validEntries} 个有效条目, ${emptyEntries} 个空条目`
    );

    // SubTask 1.2: 验证配置文件
    console.log('\n[SubTask 1.2] 验证配置文件...');
    const settingsContent = await fs.promises.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);
    
    const vectorConfig = settings.vector;
    console.log(`  向量化模式: ${vectorConfig?.embeddingMode}`);
    console.log(`  远程模型: ${vectorConfig?.remoteModel}`);
    console.log(`  远程API地址: ${vectorConfig?.remoteApiUrl}`);
    console.log(`  向量存储模式: vecstore (唯一模式)`);
    
    const hasValidConfig = vectorConfig?.remoteModel === 'text-embedding-qwen3-embedding-8b' &&
                          vectorConfig?.embeddingMode === 'remote';
    
    runner.addResult(
      '验证配置文件',
      hasValidConfig ? 'pass' : 'fail',
      hasValidConfig ? '配置正确' : '配置不正确'
    );

    // SubTask 1.3: 检查世界书中是否包含"疯狂动物城"相关条目
    console.log('\n[SubTask 1.3] 检查世界书内容...');
    let hasZootopiaEntry = false;
    const zootopiaEntries: string[] = [];
    
    if (worldBookData.entries) {
      for (const [key, entry] of Object.entries(worldBookData.entries)) {
        const searchText = `${entry.name || ''} ${entry.content || ''}`.toLowerCase();
        if (searchText.includes('疯狂动物城') || searchText.includes('zootopia')) {
          hasZootopiaEntry = true;
          zootopiaEntries.push(entry.name || `Entry ${key}`);
        }
      }
    }
    
    console.log(`  包含"疯狂动物城"相关条目: ${hasZootopiaEntry}`);
    if (zootopiaEntries.length > 0) {
      console.log(`  相关条目名称: ${zootopiaEntries.join(', ')}`);
    }
    
    runner.addResult(
      '检查世界书是否包含"疯狂动物城"相关内容',
      hasZootopiaEntry ? 'pass' : 'skip',
      hasZootopiaEntry 
        ? `找到 ${zootopiaEntries.length} 个相关条目: ${zootopiaEntries.join(', ')}` 
        : '世界书中未找到"疯狂动物城"相关条目，搜索测试可能需要跳过'
    );

  } catch (error) {
    console.error('  读取文件失败:', error);
    runner.addResult(
      '读取世界书数据文件',
      'fail',
      `读取失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Task 2: 向量搜索测试
 */
async function testVectorSearch(runner: TestRunner): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('Task 2: 向量搜索测试');
  console.log('='.repeat(80));

  // SubTask 2.1: 验证搜索功能
  try {
    console.log('\n[SubTask 2.1] 测试向量搜索功能...');
    
    // 导入主进程服务
    const { worldBookService } = await import('../../main/services/WorldBookService');
    const { vectorStoreService } = await import('../../main/services/VectorStoreService');
    const { embeddingService } = await import('../../main/services/EmbeddingService');
    
    // 初始化服务
    console.log('  初始化服务...');
    await embeddingService.initialize();
    await vectorStoreService.initialize();
    
    console.log(`  向量存储模式: ${vectorStoreService.getMode()}`);
    console.log(`  向量存储中向量数量: ${await vectorStoreService.count()}`);

    // 测试搜索"疯狂动物城"
    const searchQuery = '疯狂动物城';
    console.log(`\n  搜索查询: "${searchQuery}"`);
    
    const embedResult = await embeddingService.generateEmbedding(searchQuery);
    if (embedResult.success && embedResult.vector) {
      console.log(`  向量化成功，维度: ${embedResult.dimension}`);
      runner.addResult(
        '查询文本向量化',
        'pass',
        `成功生成 ${embedResult.dimension} 维向量`
      );
      
      // 执行搜索
      const searchResults = await vectorStoreService.search(embedResult.vector, 5);
      console.log(`  搜索结果数量: ${searchResults.length}`);
      
      if (searchResults.length > 0) {
        console.log('\n  搜索结果详情:');
        searchResults.forEach((result, index) => {
          console.log(`    ${index + 1}. 分数: ${result.score.toFixed(6)}`);
          console.log(`       来源: ${result.metadata?.source || 'unknown'}`);
          console.log(`       内容: ${(result.metadata?.text || '').substring(0, 100)}...`);
        });
        
        // 验证排序
        let isSorted = true;
        for (let i = 0; i < Math.min(searchResults.length - 1, 3); i++) {
          if (searchResults[i].score < searchResults[i + 1].score) {
            isSorted = false;
            break;
          }
        }
        
        runner.addResult(
          '搜索结果排序验证',
          isSorted ? 'pass' : 'fail',
          isSorted ? '结果按分数降序排列' : '结果排序不正确'
        );
        
        // 验证相关性阈值
        const avgScore = searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length;
        const threshold = 0.3;
        runner.addResult(
          '相关性阈值验证',
          avgScore >= threshold ? 'pass' : 'fail',
          `平均分数: ${avgScore.toFixed(6)}, 阈值: ${threshold}`
        );
        
        // 验证 Top 3 结果得分依次递减
        if (searchResults.length >= 3) {
          let top3Decreasing = true;
          for (let i = 0; i < 2; i++) {
            if (searchResults[i].score < searchResults[i + 1].score) {
              top3Decreasing = false;
              break;
            }
          }
          runner.addResult(
            'Top 3 结果得分依次递减',
            top3Decreasing ? 'pass' : 'fail',
            top3Decreasing 
              ? `Top 3 得分: ${searchResults[0].score.toFixed(6)} > ${searchResults[1].score.toFixed(6)} > ${searchResults[2].score.toFixed(6)}`
              : 'Top 3 得分不是依次递减'
          );
        }
        
      } else {
        runner.addResult(
          '搜索结果数量',
          'fail',
          '未返回任何搜索结果'
        );
      }
    } else {
      runner.addResult(
        '查询文本向量化',
        'fail',
        embedResult.error || '向量化失败'
      );
    }

  } catch (error) {
    console.error('  搜索测试失败:', error);
    runner.addResult(
      '向量搜索测试',
      'fail',
      `测试失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Task 3: 持久化验证测试
 */
async function testPersistence(runner: TestRunner): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('Task 3: 持久化验证测试');
  console.log('='.repeat(80));

  // SubTask 3.1: 检查持久化文件存在性
  try {
    console.log('\n[SubTask 3.1] 检查持久化文件存在性...');
    
    const { app } = await import('electron');
    const userDataPath = app.getPath('userData');
    const storeFilePath = path.join(userDataPath, 'vecstore.json');
    const metadataFilePath = path.join(userDataPath, 'vecstore_metadata.json');
    
    console.log(`  存储路径: ${userDataPath}`);
    console.log(`  vecstore.json 路径: ${storeFilePath}`);
    console.log(`  vecstore_metadata.json 路径: ${metadataFilePath}`);
    
    const storeFileExists = fs.existsSync(storeFilePath);
    const metadataFileExists = fs.existsSync(metadataFilePath);
    
    console.log(`  vecstore.json 存在: ${storeFileExists}`);
    console.log(`  vecstore_metadata.json 存在: ${metadataFileExists}`);
    
    runner.addResult(
      'vecstore.json 文件存在性',
      storeFileExists ? 'pass' : 'fail',
      storeFileExists ? '文件存在' : '文件不存在'
    );
    
    runner.addResult(
      'vecstore_metadata.json 文件存在性',
      metadataFileExists ? 'pass' : 'fail',
      metadataFileExists ? '文件存在' : '文件不存在'
    );

    // SubTask 3.2: 验证文件大小和内容
    if (storeFileExists) {
      const stats = fs.statSync(storeFilePath);
      console.log(`\n  vecstore.json 大小: ${stats.size} bytes`);
      
      const content = await fs.promises.readFile(storeFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      const vectorCount = Array.isArray(parsed) ? parsed.length : 
                         (typeof parsed === 'object' ? Object.keys(parsed).length : 0);
      console.log(`  vecstore.json 向量数量: ${vectorCount}`);
      
      runner.addResult(
        'vecstore.json 内容验证',
        vectorCount > 0 ? 'pass' : 'fail',
        `包含 ${vectorCount} 个向量`
      );
    }

    if (metadataFileExists) {
      const stats = fs.statSync(metadataFilePath);
      console.log(`\n  vecstore_metadata.json 大小: ${stats.size} bytes`);
      
      const content = await fs.promises.readFile(metadataFilePath, 'utf-8');
      const parsed = JSON.parse(content);
      const metadataCount = Object.keys(parsed).length;
      console.log(`  vecstore_metadata.json 元数据数量: ${metadataCount}`);
      
      runner.addResult(
        'vecstore_metadata.json 内容验证',
        metadataCount > 0 ? 'pass' : 'fail',
        `包含 ${metadataCount} 个元数据条目`
      );
    }

    // SubTask 3.3: 验证向量化数据完整性
    console.log('\n[SubTask 3.3] 验证向量化数据完整性...');
    
    // 导入服务
    const { vectorStoreService } = await import('../../main/services/VectorStoreService');
    
    const count = await vectorStoreService.count();
    console.log(`  VecStore 中的向量数量: ${count}`);
    
    runner.addResult(
      '向量化数据完整性',
      count > 0 ? 'pass' : 'fail',
      `VecStore 中有 ${count} 个向量`
    );

  } catch (error) {
    console.error('  持久化测试失败:', error);
    runner.addResult(
      '持久化验证测试',
      'fail',
      `测试失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// 导出测试函数，供 Electron 主进程调用
export { runTests, TestRunner };
