/**
 * 知识库管理（编排层）
 *
 * 本文件原为单一巨型组件（~1488 行），按 Tab 拆分为三个子组件后仅承担：
 * - Tabs 切换的容器与编排
 * - 跨 Tab 共享的本地 UI 分页大小（pageSize）状态
 *
 * 拆分映射：
 * - "向量化知识库" Tab → <KnowledgeItemList />（含已向量化文档树 + 知识项 Modal）
 * - "文档上传" Tab → <UploadDocumentModal />（含已处理文档列表 + 详情/分块 Modal）
 * - "向量测试" Tab → <VectorSearchPanel />（含相似性查询 + 向量化测试）
 *
 * 行为与原组件保持一致；所有 IPC channel 名与 store 调用入口未变更。
 */
import React, { useState } from 'react';
import { Card, Tabs } from 'antd';
import { FileTextOutlined, ExperimentOutlined } from '@ant-design/icons';
import KnowledgeItemList from './KnowledgeItemList';
import UploadDocumentModal from './UploadDocumentModal';
import VectorSearchPanel from './VectorSearchPanel';

export const KnowledgeBaseManager: React.FC = () => {
  // pageSize 为 Table 显示分页大小（UI 状态），与 store 的 currentPageSize（API 分页）语义不同；
  // 此处集中持有以便 3 个子 Tab 共享，避免各自维护导致切换时丢失
  const [pageSize, setPageSize] = useState(20);

  const tabItems = [
    {
      key: 'list',
      label: '向量化知识库',
      children: <KnowledgeItemList pageSize={pageSize} />,
    },
    {
      key: 'upload',
      label: (
        <span><FileTextOutlined /> 文档上传</span>
      ),
      children: <UploadDocumentModal pageSize={pageSize} onPageSizeChange={setPageSize} />,
    },
    {
      key: 'search',
      label: (
        <span><ExperimentOutlined /> 向量测试</span>
      ),
      children: <VectorSearchPanel />,
    },
  ];

  return (
    <Card title="知识库管理" size="small">
      <Tabs items={tabItems} />
    </Card>
  );
};

export default KnowledgeBaseManager;
