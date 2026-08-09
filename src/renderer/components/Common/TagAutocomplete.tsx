/**
 * TagAutocomplete — 标签自动推荐输入框（Spec: implement-local-tag-autocomplete / Task 5）
 *
 * 来源：spec: implement-local-tag-autocomplete §Task 5
 *
 * 职责：
 *  1. 基于 antd AutoComplete 提供实时标签输入推荐（debounce 150ms → IPC tag:search）
 *  2. 下拉项渲染：tag name（等宽字体）+ category 彩色 Tag + count 值右对齐
 *  3. 排序规则切换（Dropdown 按钮，3 项：匹配度 / 使用频率 / 字母顺序），持久化到 settingStore
 *  4. 无匹配结果提示（notFoundContent = "未找到匹配的标签"）
 *  5. 加载中提示（标签库未加载时 "标签库加载中..." / 未配置时引导提示）
 *  6. 选中后清空输入框 + 触发 onTagSelect(tag) 回调（传完整 TagSearchResult）
 *  7. 开关关闭（setting.tagAutocomplete.enabled=false）时降级为普通 Input
 *
 * 集成点：AssetGenerateModal.tsx 的"输入临时标签" Input（Task 7 替换）。
 *
 * 【设计决策 - 受控组件 + onSearch 单向同步】
 * antd AutoComplete 在选中选项后会先触发 onSelect，再触发内部 onChange（携带选中值）。
 * 若同时绑定 onSearch（内含 onChange?.(query)）与 AutoComplete 的 onChange，选中后内部 onChange
 * 会用选中值覆盖我们在 onSelect 中设置的 ''，导致输入框无法清空。
 * 故本组件仅在 onSearch 中同步输入值到父组件，AutoComplete 不绑定 onChange；
 * 选中清空逻辑由 onSelect 独占处理，避免双写竞争。
 *
 * 【设计决策 - query state + queryRef 双轨】
 * notFoundContent 需根据当前 query 是否为空决定提示文案，而 ref 变更不触发重渲染。
 * 故维护 query state（驱动渲染）+ queryRef（供 sortBy useEffect 读取最新值，避免把 query 列入依赖造成搜索抖动）。
 *
 * 【设计决策 - 排序持久化】
 * spec 要求排序规则持久化到 settingStore。切换排序时构造完整 setting 副本调用 saveSetting，
 * 持久化失败仅 console.warn，不阻塞 UI（与 webSearch 配置块降级策略一致）。
 *
 * 约束：
 *  - 禁用 any（所有类型对齐 src/shared/types/tag.types.ts 与 src/renderer/types/setting.ts）
 *  - 所有 IPC 调用 try/catch，失败不阻塞 UI
 *  - 仅使用项目已安装的 antd / @ant-design/icons，不引入新依赖
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AutoComplete, Input, Tag, Button, Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { SortAscendingOutlined } from '@ant-design/icons';
import { useSettingStore } from '../../stores/settingStore';
import type {
  TagSearchResult,
  TagSortBy,
  TagLoadStatus,
} from '../../../shared/types/tag.types';

// ==================== Props 接口 ====================

export interface TagAutocompleteProps {
  /** 当前输入值（受控） */
  value?: string;
  /** 输入变更回调 */
  onChange?: (value: string) => void;
  /** 选中 tag 后的回调（参数为完整的 TagSearchResult） */
  onTagSelect?: (tag: TagSearchResult) => void;
  /** placeholder */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 自定义样式（width / fontSize 等） */
  style?: React.CSSProperties;
  /** size，与 antd 一致（默认 'small'） */
  size?: 'small' | 'middle' | 'large';
  /** 是否允许清空 */
  allowClear?: boolean;
  /** 输入框旁边的排序按钮是否显示（默认 true；父组件可关闭以简化 UI） */
  showSortButton?: boolean;
  /**
   * 回车键回调（透传给内嵌 Input；用于替换原 Input 的 onPressEnter）。
   *
   * 设计动机：Spec implement-local-tag-autocomplete / Task 7 集成到 AssetGenerateModal
   * 「输入临时标签」位置时，原 Input 依赖 onPressEnter 触发 handleConfirmAddTrait
   * （将自定义文本作为新 trait 追加并退出新增模式）。TagAutocomplete 内部嵌套 Input
   * 但不暴露 onPressEnter，故扩展此 prop 透传，保持向后兼容（用户输入自定义 tag 后
   * 按 Enter 仍可添加）。降级模式（tagAutocomplete.enabled=false）下也透传，避免
   * 关闭推荐时 Enter / Escape 失效。
   */
  onPressEnter?: () => void;
  /**
   * 键盘事件回调（透传给内嵌 Input；用于处理 Escape 等键）。
   *
   * 设计动机：与 onPressEnter 同源——原 Input 通过 onKeyDown 拦截 Escape 退出新增模式。
   * 透传到内嵌 Input 与降级 Input，确保键位行为在启用 / 降级两种渲染路径下一致。
   */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /**
   * 是否自动聚焦（透传给内嵌 Input 的 autoFocus）。
   *
   * 设计动机：Spec implement-local-tag-autocomplete / Task 7 集成时，原 Input 设置了
   * `autoFocus` 让用户点击「新增临时标签」后无需再次点击输入框即可键入。透传此 prop
   * 保持原有交互体验。降级模式下同样透传，确保启用 / 降级两路径行为一致。
   */
  autoFocus?: boolean;
}

// ==================== 常量映射 ====================

/**
 * Danbooru/e621 分类编号 → antd Tag 颜色。
 * 编号来源：src/shared/types/tag.types.ts TagInfo.category 注释。
 */
const CATEGORY_COLOR_MAP: Record<number, string> = {
  0: 'blue', // general
  1: 'purple', // artist
  3: 'gold', // copyright
  4: 'green', // character
  5: 'default', // meta（灰）
  7: 'orange', // e621
};

/** 分类编号 → 中文/英文标签（下拉项 Tag 文本） */
const CATEGORY_LABEL_MAP: Record<number, string> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
  5: 'meta',
  7: 'e621',
};

/** 排序选项（Dropdown 菜单项 + 当前排序 Tooltip 文案来源） */
const SORT_OPTIONS: Array<{ value: TagSortBy; label: string }> = [
  { value: 'relevance', label: '匹配度' },
  { value: 'count', label: '使用频率' },
  { value: 'alphabetical', label: '字母顺序' },
];

/** 搜索 debounce 延迟（ms）—— spec 要求 150ms */
const SEARCH_DEBOUNCE_MS = 150;

/** 单次查询返回上限（与主进程 TagAutocompleteService 一致，最大 50） */
const SEARCH_LIMIT = 50;

// ==================== 组件实现 ====================

const TagAutocomplete: React.FC<TagAutocompleteProps> = ({
  value,
  onChange,
  onTagSelect,
  placeholder = '输入标签...',
  disabled = false,
  style,
  size = 'small',
  allowClear = false,
  showSortButton = true,
  onPressEnter,
  onKeyDown,
  autoFocus,
}) => {
  const setting = useSettingStore(s => s.setting);
  const saveSetting = useSettingStore(s => s.saveSetting);

  // 降级开关：setting.tagAutocomplete 缺失时默认启用（旧配置兼容）
  const enabled = setting?.tagAutocomplete?.enabled ?? true;
  // 初始排序：从 setting 读取，缺失时 'relevance'
  const initialSortBy = setting?.tagAutocomplete?.sortBy ?? 'relevance';

  // 搜索结果列表
  const [options, setOptions] = useState<TagSearchResult[]>([]);
  // 搜索中标志（控制 notFoundContent "搜索中..." 与下拉 loading 动画）
  const [loading, setLoading] = useState(false);
  // 当前排序规则（用户切换后立即生效，并持久化到 settingStore）
  const [sortBy, setSortBy] = useState<TagSortBy>(initialSortBy);
  // 标签库加载状态（组件 mount 时调用一次 tag.getLoadStatus）
  const [tagLoadStatus, setTagLoadStatus] = useState<TagLoadStatus | null>(null);
  // 当前查询字符串（驱动 notFoundContent 渲染；ref 版本供 sortBy effect 读取最新值）
  const [query, setQuery] = useState('');
  const queryRef = useRef<string>('');
  // 本次搜索匹配总数（result.total，可能 > SEARCH_LIMIT；用于底部"已搜到 X / 共 Y"小字）
  const [matchedCount, setMatchedCount] = useState(0);

  // debounce timer（输入变化时清旧 timer 设新 timer）
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------- 副作用 ----------------

  // 初始化：检查标签库加载状态（仅在启用时）
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    window.electronAPI.tag
      .getLoadStatus()
      .then((status) => {
        if (!cancelled) setTagLoadStatus(status);
      })
      .catch(() => {
        // IPC 失败不阻塞 UI，tagLoadStatus 保持 null（notFoundContent 降级为不提示）
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // 排序变更时：若当前有 query，立即按新排序重新搜索
  useEffect(() => {
    if (queryRef.current) {
      void doSearch(queryRef.current);
    }
    // 仅依赖 sortBy：query 通过 ref 读取，避免 query 变化触发重复搜索
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  // 卸载时清空 debounce timer，避免内存泄漏与卸载后 setState
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  // ---------------- 回调 ----------------

  /**
   * 执行标签搜索（已过 debounce）。
   * query 为空 → 清空 options 直接返回。
   * IPC 失败 → 清空 options，不抛错（UI 降级为无推荐）。
   */
  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setOptions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await window.electronAPI.tag.search({
          query: q,
          sortBy,
          limit: SEARCH_LIMIT,
        });
        if (result.success) {
          // IPC 返回的 inline 类型与 TagSearchResult 结构一致，安全断言
          setOptions(result.results as TagSearchResult[]);
          setMatchedCount(result.total);
          // 刷新标签库加载状态：组件 mount 时获取的 tagLoadStatus 可能还是 loaded=false
          //（标签库延迟加载，首次 search 才触发 ensureLoaded），search 成功后需重新获取
          // 以更新 loaded=true + totalCount，否则底部「已搜到 X / 共 Y」小字不显示。
          window.electronAPI.tag
            .getLoadStatus()
            .then((status) => setTagLoadStatus(status))
            .catch(() => {
              /* 刷新失败不阻塞 UI */
            });
        } else {
          setOptions([]);
          setMatchedCount(0);
        }
      } catch {
        setOptions([]);
        setMatchedCount(0);
      } finally {
        setLoading(false);
      }
    },
    [sortBy],
  );

  /**
   * 输入搜索回调（用户每次按键触发）。
   * 1. 同步 value 到父组件（受控输入框显示）
   * 2. 更新 query state + ref
   * 3. 清旧 debounce timer，设新 timer 150ms 后触发 doSearch
   */
  const handleSearch = useCallback(
    (q: string) => {
      onChange?.(q);
      setQuery(q);
      queryRef.current = q;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        void doSearch(q);
      }, SEARCH_DEBOUNCE_MS);
    },
    [doSearch, onChange],
  );

  /**
   * 选中下拉项回调。
   * 1. 从 options 中按 name 恢复完整 TagSearchResult（onTagSelect 需 matchType/category/count 等）
   * 2. 触发 onTagSelect 回调
   * 3. 清空输入框 + options + query（spec 要求选中后清空）
   * 注意：AutoComplete 未绑定 onChange，故此处 onChange?.('') 不会被内部 onChange 覆盖。
   */
  const handleSelect = useCallback(
    (selectedName: string) => {
      const selected = options.find((t) => t.name === selectedName);
      if (selected) {
        onTagSelect?.(selected);
      }
      onChange?.('');
      setOptions([]);
      setQuery('');
      queryRef.current = '';
    },
    [options, onTagSelect, onChange],
  );

  /**
   * 切换排序规则。
   * 1. 更新本地 state（触发 sortBy useEffect → 重新搜索）
   * 2. 持久化到 settingStore.tagAutocomplete.sortBy
   *    持久化失败仅 console.warn，不阻塞 UI（与 webSearch 配置块降级策略一致）。
   */
  const handleSortChange = useCallback(
    async (newSortBy: TagSortBy) => {
      setSortBy(newSortBy);
      if (!setting) return;
      const currentTagConfig = setting.tagAutocomplete ?? {
        enabled: true,
        csvPath: '',
        sortBy: 'relevance' as TagSortBy,
      };
      const newSetting = {
        ...setting,
        tagAutocomplete: {
          ...currentTagConfig,
          sortBy: newSortBy,
        },
      };
      try {
        await saveSetting(newSetting);
      } catch {
        // 持久化失败不阻塞 UI：本地 state 已更新，当前会话排序仍生效
        console.warn('[TagAutocomplete] 排序规则持久化失败');
      }
    },
    [setting, saveSetting],
  );

  // ---------------- 渲染辅助 ----------------

  /** 降级开关关闭 → 渲染普通 Input，不调用任何 IPC */
  if (!enabled) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={style}
        size={size}
        allowClear={allowClear}
        onPressEnter={onPressEnter}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
      />
    );
  }

  /** AutoComplete options 渲染：name + category Tag + count */
  const autoCompleteOptions = options.map((tag) => ({
    value: tag.name,
    label: (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 0',
        }}
      >
        <span
          style={{
            fontFamily: 'Consolas, "Courier New", monospace',
            fontSize: 12,
            color: 'var(--text-primary, #e2e8f0)',
          }}
        >
          {tag.name}
        </span>
        <Tag
          color={CATEGORY_COLOR_MAP[tag.category] ?? 'default'}
          style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}
        >
          {CATEGORY_LABEL_MAP[tag.category] ?? `cat:${tag.category}`}
        </Tag>
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--text-tertiary, #6b7280)',
            fontSize: 10,
          }}
        >
          {tag.count.toLocaleString()}
        </span>
      </div>
    ),
  }));

  /**
   * notFoundContent 文案优先级：
   * 1. 标签库加载中 → "标签库加载中..."
   * 2. 标签库未配置（loaded=false 且有 error）→ 引导提示
   * 3. 搜索中 → "搜索中..."
   * 4. 有 query 但无结果 → "未找到匹配的标签"
   * 5. query 为空 → null（不展示下拉）
   */
  const notFoundContent: React.ReactNode = useMemo(() => {
    if (tagLoadStatus?.loading) return '标签库加载中...';
    if (!tagLoadStatus?.loaded && tagLoadStatus?.error) {
      return '标签库未配置，请在设置中指定 CSV 文件路径';
    }
    if (loading) return '搜索中...';
    if (query.trim()) return '未找到匹配的标签';
    return null;
  }, [tagLoadStatus, loading, query]);

  /** 排序 Dropdown 菜单配置 */
  const sortMenu: MenuProps = {
    items: SORT_OPTIONS.map((opt) => ({
      key: opt.value,
      label: (
        <span style={{ fontWeight: sortBy === opt.value ? 600 : 400 }}>
          {opt.label}
          {sortBy === opt.value ? ' ✓' : ''}
        </span>
      ),
    })),
    onClick: (info) => {
      void handleSortChange(info.key as TagSortBy);
    },
  };

  /** 当前排序的中文文案（Tooltip 展示） */
  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? '匹配度';

  // ---------------- 渲染 ----------------

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <AutoComplete
          value={value}
          options={autoCompleteOptions}
          onSearch={handleSearch}
          onSelect={handleSelect}
          placeholder={placeholder}
          disabled={disabled}
          size={size}
          allowClear={allowClear}
          notFoundContent={notFoundContent}
          style={{ flex: 1 }}
          // 下拉宽度固定 400px，确保 name + category + count 三列完整展示
          popupMatchSelectWidth={400}
        >
          <Input
            size={size}
            onPressEnter={onPressEnter}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
          />
        </AutoComplete>
        {showSortButton && (
          <Dropdown menu={sortMenu} trigger={['click']} disabled={disabled}>
            <Tooltip title={`排序规则：${currentSortLabel}`}>
              <Button
                size={size}
                icon={<SortAscendingOutlined />}
                disabled={disabled}
              />
            </Tooltip>
          </Dropdown>
        )}
      </div>
      {query.trim() && !loading && tagLoadStatus?.loaded && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--text-tertiary, #6b7280)',
            textAlign: 'right',
            paddingRight: 4,
            lineHeight: '16px',
            marginTop: 2,
            userSelect: 'none',
          }}
        >
          已搜到 {matchedCount.toLocaleString()} 条 / 共{' '}
          {(tagLoadStatus?.totalCount ?? 0).toLocaleString()} 条
        </div>
      )}
    </div>
  );
};

export default TagAutocomplete;
