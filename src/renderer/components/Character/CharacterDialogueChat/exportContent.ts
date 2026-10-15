/**
 * 【Phase 3 / L2 - conversation-mode-optimization-report】对话导出构建器重导出层（R3）。
 *
 * 构建器实现已迁移到 shared/utils/exportContent.ts（主进程+单测可共用），
 * 本文件仅做重导出，保持原有引用点（useChatExport / ExportDialog 等）零改动。
 * Phase 2 / M5 的注释（多格式导出构建器）见 shared/utils/exportContent.ts。
 */
export type { DialogueExportFormat, DialogueMessageLike } from '@shared/utils/exportContent';
export { EXPORT_FORMAT_EXTENSIONS, buildExportContent } from '@shared/utils/exportContent';
