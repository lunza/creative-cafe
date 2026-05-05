import type { TestLog, TestReport } from '../types/vectorTest';

export const runEmbeddingTests = async (
  onLog: (log: TestLog) => void,
): Promise<TestReport> => {
  onLog({ timestamp: Date.now(), level: 'info', message: '正在初始化向量化测试...' });
  
  try {
    const result = await window.electronAPI.vector.testEmbedding();
    
    for (const log of result.logs) {
      onLog({ timestamp: Date.now(), level: log.level as any, message: log.message });
    }
    
    onLog({ timestamp: Date.now(), level: 'success', message: `向量化测试完成: ${result.report.results.length} 个用例` });
    
    return result.report;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog({ timestamp: Date.now(), level: 'error', message: `测试执行失败: ${msg}` });
    throw error;
  }
};

export const runStorageTests = async (
  onLog: (log: TestLog) => void,
): Promise<TestReport> => {
  onLog({ timestamp: Date.now(), level: 'info', message: '正在初始化存储测试...' });
  
  try {
    const result = await window.electronAPI.vector.testStorage();
    
    onLog({ timestamp: Date.now(), level: result.success ? 'success' : 'error', message: result.details || result.error || '存储测试完成' });
    
    const report: TestReport = {
      startTime: Date.now(),
      endTime: Date.now(),
      total: 1,
      passed: result.success ? 1 : 0,
      failed: result.success ? 0 : 1,
      skipped: 0,
      results: [{
        id: 'storage_test_1',
        name: '存储连接测试',
        status: result.success ? 'pass' : 'fail',
        detail: result.details || result.error || '测试完成',
        duration: 0,
      }],
      totalDuration: 0,
    };
    
    return report;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog({ timestamp: Date.now(), level: 'error', message: `测试执行失败: ${msg}` });
    throw error;
  }
};

export const runDocumentTests = async (
  onLog: (log: TestLog) => void,
): Promise<TestReport> => {
  onLog({ timestamp: Date.now(), level: 'info', message: '========== 开始文档向量化测试 ==========' });
  
  try {
    const result = await window.electronAPI.vector.testAll();
    
    const allLogs = [
      ...(result.embedding?.logs || []),
      ...(result.storage?.logs || []),
    ];
    
    for (const log of allLogs) {
      onLog({ timestamp: Date.now(), level: log.level as any, message: log.message });
    }
    
    const combinedResults = [
      ...(result.embedding?.report?.results || []),
      ...(result.storage?.report?.results || []),
    ];
    
    const combinedReport: TestReport = {
      id: `doc_${Date.now()}`,
      name: '文档向量化综合测试',
      status: result.embedding?.report?.failed === 0 && result.storage?.report?.failed === 0 ? 'pass' : 'fail',
      total: combinedResults.length,
      passed: (result.embedding?.report?.passed || 0) + (result.storage?.report?.passed || 0),
      failed: (result.embedding?.report?.failed || 0) + (result.storage?.report?.failed || 0),
      skipped: (result.embedding?.report?.skipped || 0) + (result.storage?.report?.skipped || 0),
      results: combinedResults,
      totalDuration: (result.embedding?.report?.totalDuration || 0) + (result.storage?.report?.totalDuration || 0),
      startTime: result.embedding?.report?.startTime || Date.now(),
      endTime: result.storage?.report?.endTime || Date.now(),
    };
    
    onLog({ timestamp: Date.now(), level: 'success', message: `文档向量化测试完成: ${combinedResults.length} 个用例` });
    
    return combinedReport;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog({ timestamp: Date.now(), level: 'error', message: `文档向量化测试失败: ${msg}` });
    throw error;
  }
};

export const runAllTests = async (
  onLog: (log: TestLog) => void,
): Promise<TestReport[]> => {
  onLog({ timestamp: Date.now(), level: 'info', message: '========== 开始全部测试 ==========' });
  
  const reports: TestReport[] = [];
  
  try {
    const embeddingReport = await runEmbeddingTests(onLog);
    reports.push(embeddingReport);
    
    const storageReport = await runStorageTests(onLog);
    reports.push(storageReport);
    
    onLog({ timestamp: Date.now(), level: 'success', message: '========== 全部测试完成 ==========' });
    
    return reports;
  } catch (error) {
    onLog({ timestamp: Date.now(), level: 'error', message: `测试过程中发生错误: ${error instanceof Error ? error.message : String(error)}` });
    throw error;
  }
};

export const runAllWithDocumentTests = async (
  onLog: (log: TestLog) => void,
): Promise<TestReport[]> => {
  onLog({ timestamp: Date.now(), level: 'info', message: '========== 开始包含文档的全部测试 ==========' });
  
  const reports: TestReport[] = [];
  
  try {
    const embeddingReport = await runEmbeddingTests(onLog);
    reports.push(embeddingReport);
    
    const storageReport = await runStorageTests(onLog);
    reports.push(storageReport);
    
    const documentReport = await runDocumentTests(onLog);
    reports.push(documentReport);
    
    onLog({ timestamp: Date.now(), level: 'success', message: '========== 包含文档的全部测试完成 ==========' });
    
    return reports;
  } catch (error) {
    onLog({ timestamp: Date.now(), level: 'error', message: `测试过程中发生错误: ${error instanceof Error ? error.message : String(error)}` });
    throw error;
  }
};
