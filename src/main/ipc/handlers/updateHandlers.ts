import { ipcMain } from 'electron';
import { app } from 'electron';
import simpleGit from 'simple-git';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface CheckUpdateResult {
  success: boolean;
  message?: string;
  data?: {
    hasUpdate: boolean;
    currentVersion: string;
    latestVersion: string;
    commits: CommitInfo[];
  };
}

interface PullUpdateResult {
  success: boolean;
  message?: string;
  data?: {
    compiled: boolean;
    buildOutput: string[];
    changedFiles: string[];
  };
  logs?: string[];
}

function getProjectRoot(): string {
  const appPath = app.getAppPath();
  if (appPath.endsWith('.asar')) {
    return path.dirname(appPath);
  }
  return appPath;
}

export function updateHandlers() {
  ipcMain.handle('update:check', async (): Promise<CheckUpdateResult> => {
    try {
      const projectRoot = getProjectRoot();
      const git = simpleGit(projectRoot);

      // 验证是否为 Git 仓库
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return {
          success: false,
          message: '当前目录不是 Git 仓库，无法检查更新'
        };
      }

      // 获取当前分支
      const branchSummary = await git.branch();
      const currentBranch = branchSummary.current;

      // 执行 git fetch 获取远程信息
      await git.fetch();

      // 获取本地和远程的 commit hash
      const localHash = await git.revparse(['HEAD']);
      const remoteHash = await git.revparse([`origin/${currentBranch}`]);

      // 获取 commit 差异
      const logResult = await git.log({
        from: localHash,
        to: remoteHash,
        maxCount: 50
      });

      const commits: CommitInfo[] = logResult.all.map(commit => ({
        hash: commit.hash.substring(0, 7),
        message: commit.message,
        author: commit.author_name,
        date: commit.date
      }));

      const hasUpdate = localHash !== remoteHash;

      return {
        success: true,
        data: {
          hasUpdate,
          currentVersion: localHash.substring(0, 7),
          latestVersion: remoteHash.substring(0, 7),
          commits
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not a git repository') || message.includes('fatal')) {
        return {
          success: false,
          message: '当前目录不是 Git 仓库，无法检查更新'
        };
      }
      return {
        success: false,
        message: `检查更新失败: ${message}`
      };
    }
  });

  ipcMain.handle('update:pull', async (): Promise<PullUpdateResult> => {
    const logs: string[] = [];
    try {
      const projectRoot = getProjectRoot();
      const git = simpleGit(projectRoot);

      // 验证是否为 Git 仓库
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return {
          success: false,
          message: '当前目录不是 Git 仓库，无法更新',
          logs
        };
      }

      // 检查是否有未提交的更改
      const status = await git.status();
      if (!status.isClean()) {
        return {
          success: false,
          message: '存在未提交的本地更改，请先提交或暂存更改后再更新',
          logs
        };
      }

      // 执行 git pull
      logs.push('正在拉取最新代码...');
      const pullResult = await git.pull();
      
      if (pullResult.conflicts && pullResult.conflicts.length > 0) {
        return {
          success: false,
          message: '拉取失败: 存在代码冲突，请先处理本地更改',
          logs: [...logs, `冲突文件: ${pullResult.conflicts.join(', ')}`]
        };
      }

      logs.push('代码拉取成功');

      // 获取变更文件列表
      logs.push('正在获取变更文件列表...');
      const diffResult = await git.diff(['--name-only', 'HEAD@{1}', 'HEAD']);
      const changedFiles = diffResult.split('\n').filter(Boolean);

      // 执行 npm run build
      logs.push('正在重新编译项目...');
      const { stdout, stderr } = await execAsync('npm run build', {
        cwd: projectRoot,
        timeout: 120000
      });

      const buildOutput = (stdout || stderr).split('\n').filter(Boolean);

      if (stderr && !stderr.includes('warn') && !stderr.includes('Warning')) {
        logs.push('编译过程中出现警告或错误');
        return {
          success: true,
          data: {
            compiled: false,
            buildOutput,
            changedFiles
          },
          logs: [...logs, '编译失败，请查看输出日志'],
          message: '代码已更新，但编译失败，请查看日志'
        };
      }

      logs.push('编译成功');

      return {
        success: true,
        data: {
          compiled: true,
          buildOutput,
          changedFiles
        },
        logs
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logs.push(`错误: ${message}`);
      
      if (message.includes('timeout')) {
        return {
          success: false,
          message: '操作超时，请稍后重试',
          logs
        };
      }
      
      return {
        success: false,
        message: `更新失败: ${message}`,
        logs
      };
    }
  });
}
