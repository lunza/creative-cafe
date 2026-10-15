/**
 * 全局设置文件 - 主进程和渲染进程共享
 *
 * Spec: settings-feature-optimization-report / M-6（FL-7 双默认设置合一）
 *
 * 【重点标记 - 双默认定义合一】此前本文件的 defaultSetting 与主进程
 * storageService.initializeDefaultData 各维护一份顶层默认定义且已漂移：
 * - 本文件含 vector/sdWebui/tagAutocomplete/tagRag/forbiddenWords 等配置域，
 *   但缺主进程实存的 *Path 五键与 fallbackProviders，且漏定义 webSearch 域；
 * - 主进程侧含 *Path/fallbackProviders，但缺全部配置域。
 * 文件缺失/损坏恢复时渲染与主进程对「默认」的理解不同，初始化行为取决于启动时序。
 *
 * 现两份定义均收敛到 shared/settingDefaults.buildDefaultSetting() 单一来源
 * （键集以磁盘实存键为准），本文件仅保留应用元信息 + defaultSetting 透传。
 */
import { buildDefaultSetting } from './settingDefaults';

export const AppSetting = {
  version: '1.0.0',
  name: 'Creative Café',
  description: '创想咖啡厅 - SillyTavern 管理工具',
  defaultSetting: buildDefaultSetting(),
};
