/**
 * 敏感信息日志脱敏（Spec: settings-feature-optimization-report / H-1）
 *
 * 背景：设置保存链路 14 处将含 api_key 的全量设置/请求头 JSON.stringify 后写入日志
 * （Settings.tsx:100/103/176、useAIEngineSettings.ts:147、settingStore.ts:56/91/95、
 * useWorldBookAIOperations.ts 7 处 Authorization 头），日志可检索即泄漏全部引擎 API Key。
 *
 * 纯字符串工具，无依赖，主进程/渲染进程均可用。
 */

/**
 * 将文本中的敏感字段值替换为 ***。
 * 覆盖三类形态（含 JSON.stringify 后 key 带引号的形态）：
 * 1. JSON 字段值："api_key": "xxx" / "apiKey": "xxx" / "novelai_api_key" / "ai_horde_api_key" / "remoteApiKey"
 * 2. 请求头：Authorization: Bearer xxx / "Authorization":"Bearer xxx"（JSON 形态）
 * 3. 查询参数：api_key=xxx
 *
 * 非字符串输入原样返回；空字符串直接返回。
 */
export function redactSecrets(text: string): string {
  if (!text) {
    return text;
  }
  return text
    .replace(/("(?:api_key|apiKey|novelai_api_key|ai_horde_api_key|remoteApiKey)"\s*:\s*")([^"]*)(")/gi, '$1***$3')
    .replace(/(Authorization"?\s*[:=]\s*)("?)(Bearer\s+)?([A-Za-z0-9\-_~+.\/=]+)/gi, (_m, p1: string, p2: string, p3: string) => `${p1}${p2}${p3 ? 'Bearer ' : ''}***`)
    .replace(/(api_key=)([^&\s]+)/gi, '$1***');
}
