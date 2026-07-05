/**
 * 游戏画廊对话框（Task 10 / SubTask 10.4）
 *
 * 职责：
 * - 首期为空状态占位组件，预留接口供后续从模板读取 gallery items
 * - 使用 antd Modal + Empty，与 GameSaveDialog / GameOptionsDialog 风格一致
 *
 * 设计要点：
 * - open 与 onClose 由父组件（GameDetailPage）控制，通过 gameUIStore.showGalleryDialog 显隐
 * - Modal 不强制销毁子节点（destroyOnClose 默认 false），保留滚动位置
 * - Empty 文案明确告知用户"该功能正在开发中"，避免误以为是数据加载失败
 *
 * 后续扩展：
 * - 从模板的 GameTypeTemplate 中读取 gallery items（CG 图列表）
 * - 渲染 antd Image.PreviewGroup 支持点击预览
 * - 按章节 / 角色分类筛选
 */

import { Modal, Empty } from 'antd';

export interface GameGalleryDialogProps {
  /** 对话框是否可见 */
  open: boolean;
  /** 关闭对话框回调 */
  onClose: () => void;
}

export const GameGalleryDialog: React.FC<GameGalleryDialogProps> = ({ open, onClose }) => {
  return (
    <Modal
      title="画廊"
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose={false}
    >
      {/* TODO: 后续从模板读取 gallery items */}
      <Empty
        description="暂无 CG，该功能正在开发中"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    </Modal>
  );
};

export default GameGalleryDialog;
