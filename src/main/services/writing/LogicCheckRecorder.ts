import fs from 'fs';
import path from 'path';
import { getUserDataPath } from '../../utils/appPath';
import { LogicCheckIssue, LOGIC_CONTRADICTION_TYPE_LABELS, ISSUE_SEVERITY_LABELS } from '../../../shared/types/writing.types';

const addLog = (message: string, level: 'info' | 'warn' | 'error' | 'debug' = 'info') => {
  console.log(`[LogicCheckRecorder][${level.toUpperCase()}] ${message}`);
};

interface LogicCheckRecord {
  '0': string;          // 流水号
  '1': string;          // 唯一id
  '2': string;          // 异常类型
  '3': string;          // 具体情节描述
  '4': string;          // 矛盾点分析
  '5': string;          // 章节信息
  '6': string;          // 严重程度
  '7': string;          // 改进建议
  '8': string;          // 检测时间
}

interface MemoryTableData {
  sheets: string[];
  data: Record<string, LogicCheckRecord[]>;
}

const TABLE_NAME = '逻辑矛盾记录';

export class LogicCheckRecorder {
  private dataDir: string;
  private readonly fileName = 'plot_logic_contradictions.json';

  constructor() {
    const userDataPath = getUserDataPath();
    this.dataDir = path.join(userDataPath, 'data', 'writing');
    this.ensureDirectories();
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private getFilePath(): string {
    return path.join(this.dataDir, this.fileName);
  }

  private readTableData(): MemoryTableData {
    const filePath = this.getFilePath();
    if (!fs.existsSync(filePath)) {
      const initialData: MemoryTableData = {
        sheets: [TABLE_NAME],
        data: { [TABLE_NAME]: [] }
      };
      this.saveTableData(initialData);
      return initialData;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      addLog(`读取表格数据失败: ${error}`, 'error');
      return { sheets: [TABLE_NAME], data: { [TABLE_NAME]: [] } };
    }
  }

  private saveTableData(data: MemoryTableData): void {
    const filePath = this.getFilePath();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 将逻辑检查结果记录到记忆表格
   */
  public async recordIssues(issues: LogicCheckIssue[], projectId: string, chapterIndex: number, chapterTitle?: string): Promise<{ success: boolean; recorded: number; errors: string[] }> {
    const result = { success: true, recorded: 0, errors: [] as string[] };

    if (!issues || issues.length === 0) {
      addLog('没有逻辑异常需要记录', 'debug');
      return result;
    }

    addLog(`开始记录 ${issues.length} 条逻辑异常`, 'info');

    try {
      const tableData = this.readTableData();
      if (!tableData.data[TABLE_NAME]) {
        tableData.data[TABLE_NAME] = [];
      }

      const existingRows = tableData.data[TABLE_NAME];
      let nextId = existingRows.length + 1;

      for (const issue of issues) {
        try {
          const record: LogicCheckRecord = {
            '0': String(nextId),
            '1': `${projectId}_${chapterIndex}_${issue.type}_${Date.now()}`,
            '2': LOGIC_CONTRADICTION_TYPE_LABELS[issue.type] || issue.type,
            '3': issue.description,
            '4': issue.analysis,
            '5': `第${chapterIndex + 1}章${chapterTitle ? `-${chapterTitle}` : ''}`,
            '6': ISSUE_SEVERITY_LABELS[issue.severity] || issue.severity,
            '7': issue.suggestion || '',
            '8': new Date().toLocaleString('zh-CN')
          };

          tableData.data[TABLE_NAME].push(record);
          nextId++;
          result.recorded++;
        } catch (err) {
          const errorMsg = `记录第 ${result.recorded + 1} 条异常失败: ${err}`;
          addLog(errorMsg, 'error');
          result.errors.push(errorMsg);
        }
      }

      this.saveTableData(tableData);
      addLog(`成功记录 ${result.recorded} 条逻辑异常`, 'info');
    } catch (error) {
      const errorMsg = `记录逻辑异常失败: ${error}`;
      addLog(errorMsg, 'error');
      result.success = false;
      result.errors.push(errorMsg);
    }

    return result;
  }

  /**
   * 获取所有逻辑检查记录
   */
  public getRecords(): { success: boolean; records: LogicCheckRecord[]; error?: string } {
    try {
      const tableData = this.readTableData();
      const records = tableData.data[TABLE_NAME] || [];
      return { success: true, records };
    } catch (error) {
      return { success: false, records: [], error: String(error) };
    }
  }

  /**
   * 清空所有逻辑检查记录
   */
  public clearRecords(): { success: boolean; error?: string } {
    try {
      const tableData = this.readTableData();
      tableData.data[TABLE_NAME] = [];
      this.saveTableData(tableData);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

export const logicCheckRecorder = new LogicCheckRecorder();