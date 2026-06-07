# 检查清单

- [x] 事件监听器 useEffect 依赖从 `[outline]` 改为 `[]`
- [x] 添加 outlineRef 并在独立的 useEffect 中同步更新
- [x] onStreamComplete 回调中通过 outlineRef.current 访问 outline
- [x] onStreamChunk 回调正常工作（无需修改，不依赖 outline）
- [x] onStreamError 回调正常工作（无需修改，不依赖 outline）
- [ ] 快速生成第1章只触发一次内容生成（需运行时测试）
- [ ] 快速生成第2章只触发一次内容生成（需运行时测试）
- [ ] 快速生成第3章只触发一次内容生成（需运行时测试）
- [ ] 各章节生成字数与用户设定一致（需运行时测试）
- [ ] 停止功能正确清理状态并保留已生成内容（需运行时测试）
- [ ] 重新生成功能正常工作（需运行时测试）
- [ ] 组件卸载时监听器正确清理（useEffect cleanup 保持不变）
