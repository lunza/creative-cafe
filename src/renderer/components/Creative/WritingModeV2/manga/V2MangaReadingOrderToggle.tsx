/**
 * 漫画解析：阅读顺序切换
 *
 * Spec: integrate-comic-parsing-mode / Requirement「阅读顺序配置」
 *
 * - 提供「从左到右」/「从右到左」两种模式 Radio 切换
 * - 切换即时生效（影响缩略图排列 + AI 分析提示词）
 */
import React from 'react';
import { Radio } from 'antd';
import type { MangaReadingOrder } from '../../../../../shared/types/writing-v2.types';

interface Props {
  value: MangaReadingOrder;
  onChange: (order: MangaReadingOrder) => void;
  disabled?: boolean;
}

const V2MangaReadingOrderToggle: React.FC<Props> = ({ value, onChange, disabled }) => (
  <Radio.Group
    size="small"
    value={value}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value as MangaReadingOrder)}
  >
    <Radio.Button value="leftToRight">从左到右</Radio.Button>
    <Radio.Button value="rightToLeft">从右到左</Radio.Button>
  </Radio.Group>
);

export default V2MangaReadingOrderToggle;
