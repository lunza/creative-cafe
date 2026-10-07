// 【确定性补丁脚本】渲染进程 AIService.tsx 流式监听器泄漏与跨请求串扰修复
// 策略：精确字符串替换 + 唯一性断言，任何一处匹配数不符立即中止（防编辑工具串改）
const fs = require('fs');
const FILE = 'g:/AI/creative-cafe/src/renderer/components/Common/AIService.tsx';
const raw = fs.readFileSync(FILE, 'utf8');
// 行尾自适应：文件为 CRLF 时把模式串同步为 CRLF
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const fix = (s) => s.replace(/\n/g, eol);
let src = raw;

const edits = [
  {
    name: 'R0-声明块（requestId/disposed/safetyTimer/isOwnEvent）',
    old: `      let receivedChunkCount = 0;
      let totalReceivedChars = 0;
      const streamListenerStartTime = Date.now();`,
    neo: `      let receivedChunkCount = 0;
      let totalReceivedChars = 0;
      const streamListenerStartTime = Date.now();

      // 【流式监听器泄漏与跨请求串扰修复 — 角色卡字段污染根因】
      // 背景：'ai:stream' / 'ai:stream:complete' 是按 webContents 广播的全局频道，原实现：
      // 1) 监听器不区分事件归属，清理依赖 complete 事件按时到达 + 各路径手工 off；
      // 2) complete 丢失/迟到（IPC 时序、异常路径）→ chunk 监听器永久滞留，
      //    后续请求的内容被旧监听器累积并写回旧字段（表现为"对 A 字段生成/翻译/润色时，
      //    其他字段内容也一同更新"）；下一请求的 complete 会误触发上一请求的 completeListener；
      // 3) 外层 catch（网络异常/invoke reject）完全不清理；
      // 4) errorListener 在 complete/error 路径均不移除自身，每次请求泄漏一个。
      // 修复：每次请求生成 requestId 贯穿主进程回传事件（chunk/complete/error 均携带），
      // 监听器按 requestId 过滤；清理收敛为单一 cleanup()（幂等）全路径调用，
      // 另加 30s 兜底定时器防 complete 丢失导致监听器滞留。
      const requestId = \`req-\${Date.now()}-\${Math.random().toString(36).substring(2, 10)}\`;
      let disposed = false;
      let safetyTimer: ReturnType<typeof setTimeout> | undefined = undefined;
      // 事件归属判断：主进程回传载荷带 requestId；无 requestId 的载荷（旧版主进程/其他发送方）按原行为放行
      const isOwnEvent = (payload: any): boolean =>
        !payload || typeof payload.requestId !== 'string' || payload.requestId === requestId;`,
    expect: 1
  },
  {
    name: 'R1-streamListener 签名 + 守卫',
    old: `      const streamListener = (data: { chunk: string; chunkIndex?: number; chunkSize?: number; accumulatedData: string }) => {
        // 防御性检查
        if (!data) {`,
    neo: `      const streamListener = (data: { chunk: string; chunkIndex?: number; chunkSize?: number; accumulatedData: string; requestId?: string }) => {
        // 【串扰防御】已清理或非本请求的 chunk 事件直接忽略（requestId 过滤）
        if (disposed || !isOwnEvent(data)) {
          return;
        }
        // 防御性检查
        if (!data) {`,
    expect: 1
  },
  {
    name: 'R2-completeListener 签名 + 守卫',
    old: `      const completeListener = (data: { data: any }) => {
        const totalElapsed = ((Date.now() - streamListenerStartTime) / 1000).toFixed(2);`,
    neo: `      const completeListener = (data: { data: any; requestId?: string }) => {
        // 【串扰防御】已清理或非本请求的 complete 事件直接忽略
        if (disposed || !isOwnEvent(data)) {
          return;
        }
        const totalElapsed = ((Date.now() - streamListenerStartTime) / 1000).toFixed(2);`,
    expect: 1
  },
  {
    name: 'R7-失败路径收敛 cleanup + 显式 return',
    old: `      if (!result.success) {
        // 清理监听器
        (window as any).electronAPI?.off?.('ai:stream', streamListener);
        (window as any).electronAPI?.off?.('ai:stream:complete', completeListener);
        (window as any).electronAPI?.off?.('ai:stream:error', errorListener);

        if (streamOptions.onError) {
          const aiError = AIErrorHandler.fromError(new Error(result.error || 'AI 流式请求失败'));
          streamOptions.onError(aiError);
        }
      }`,
    neo: `      if (!result.success) {
        // 清理监听器（单一幂等 cleanup，全路径调用）
        cleanup();

        if (streamOptions.onError) {
          const aiError = AIErrorHandler.fromError(new Error(result.error || 'AI 流式请求失败'));
          streamOptions.onError(aiError);
        }
        return;
      }`,
    expect: 1
  },
  {
    name: 'R3-两处手工 off 收敛为 cleanup()（complete + error 监听器内）',
    old: `        // 清理监听器
        (window as any).electronAPI?.off?.('ai:stream', streamListener);
        (window as any).electronAPI?.off?.('ai:stream:complete', completeListener);`,
    neo: `        // 清理监听器（收敛为单一幂等 cleanup，全路径调用）
        cleanup();`,
    expect: 2
  },
  {
    name: 'R4-errorListener 签名 + 守卫（自身移除由 cleanup 承担）',
    old: `      const errorListener = (error: { message: string; errorType: string }) => {`,
    neo: `      const errorListener = (error: { message: string; errorType: string; requestId?: string }) => {
        // 【串扰防御】已清理或非本请求的 error 事件直接忽略
        if (disposed || !isOwnEvent(error)) {
          return;
        }`,
    expect: 1
  },
  {
    name: 'R5-cleanup 幂等收敛函数（注册前插入）',
    old: `      // 注册事件监听
      (window as any).electronAPI?.on?.('ai:stream', streamListener);`,
    neo: `      /**
       * 【清理收敛 — 幂等】complete / error / 失败 / 异常 / 兜底定时器全路径调用。
       * 原实现清理依赖 complete 事件按时到达 + 各路径手工 off，任何路径偏差即泄漏：
       * chunk 监听器滞留后会把后续请求的流式内容累加进旧字段（角色卡字段污染根因）。
       */
      const cleanup = () => {
        if (disposed) {
          return;
        }
        disposed = true;
        if (safetyTimer) {
          clearTimeout(safetyTimer);
          safetyTimer = undefined;
        }
        (window as any).electronAPI?.off?.('ai:stream', streamListener);
        (window as any).electronAPI?.off?.('ai:stream:complete', completeListener);
        (window as any).electronAPI?.off?.('ai:stream:error', errorListener);
      };

      // 注册事件监听
      (window as any).electronAPI?.on?.('ai:stream', streamListener);`,
    expect: 1
  },
  {
    name: 'R6-invoke 携带 requestId + 兜底定时器',
    old: `        timeout: (this.config as any).timeout || undefined, // 未配置时由主进程读取用户设置的 request_timeout
        streaming: true
      });`,
    neo: `        timeout: (this.config as any).timeout || undefined, // 未配置时由主进程读取用户设置的 request_timeout
        streaming: true,
        requestId // 【串扰防御】贯穿主进程回传事件（chunk/complete/error 均携带），渲染进程据此过滤
      });

      // invoke 返回 = 主进程流已结束；兜底定时器防 complete 事件丢失/迟到导致监听器滞留
      safetyTimer = setTimeout(cleanup, 30000);`,
    expect: 1
  },
  {
    name: 'R8-外层 catch 补清理（全块 pattern 唯一锚定流式版 catch）',
    old: `    } catch (error) {
      let aiError: AIError;
      
      if (error instanceof Error) {
        const errMsg = error.message.toLowerCase();
        if (errMsg.includes('fetch') || errMsg.includes('network') || errMsg.includes('connect')) {
          aiError = AIErrorHandler.createNetworkError(
            '无法连接到 AI 服务。请检查：\\n1. API 地址是否正确\\n2. 网络连接是否正常\\n3. 防火墙是否阻止了请求'
          );
        } else {
          aiError = AIErrorHandler.fromError(error);
        }
      } else {
        aiError = AIErrorHandler.fromError(error);
      }
      
      if (streamOptions.onError) {
        streamOptions.onError(aiError);
      }`,
    neo: `    } catch (error) {
      // 【泄漏修复】外层 catch（网络异常/invoke reject）此前完全不清理监听器
      cleanup();
      
      let aiError: AIError;
      
      if (error instanceof Error) {
        const errMsg = error.message.toLowerCase();
        if (errMsg.includes('fetch') || errMsg.includes('network') || errMsg.includes('connect')) {
          aiError = AIErrorHandler.createNetworkError(
            '无法连接到 AI 服务。请检查：\\n1. API 地址是否正确\\n2. 网络连接是否正常\\n3. 防火墙是否阻止了请求'
          );
        } else {
          aiError = AIErrorHandler.fromError(error);
        }
      } else {
        aiError = AIErrorHandler.fromError(error);
      }
      
      if (streamOptions.onError) {
        streamOptions.onError(aiError);
      }`,
    expect: 1
  }
];

// 逐条断言 + 替换
for (const e of edits) {
  const oldS = fix(e.old);
  const count = src.split(oldS).length - 1;
  if (count !== e.expect) {
    console.error(`[FAIL] ${e.name}: 期望匹配 ${e.expect} 次，实际 ${count} 次 —— 中止，未写入任何更改`);
    process.exit(1);
  }
  src = src.split(oldS).join(fix(e.neo));
  console.log(`[OK] ${e.name} (${count} 处)`);
}

fs.writeFileSync(FILE, src, 'utf8');
console.log(`\n[DONE] 全部 ${edits.length} 处替换成功并已写盘: ${FILE}`);