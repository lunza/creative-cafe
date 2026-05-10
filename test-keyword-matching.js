/**
 * 世界书关键词匹配测试脚本
 * 
 * 使用方法：
 * 1. 启动应用后，打开开发者工具（F12）
 * 2. 在 Console 中粘贴此脚本
 * 3. 运行脚本查看测试结果
 */

async function testKeywordMatching() {
  console.log('=== 世界书关键词匹配测试 ===\n');

  // 测试文本
  const testTexts = [
    '打印朱迪的详细信息',
    '朱迪和尼克是好朋友',
    '动物城里的故事',
    '兔子朱迪很勇敢',
  ];

  // 获取可用的世界书列表
  console.log('1️⃣ 获取世界书列表...');
  try {
    const worldBooks = await window.electronAPI.worldbook.list();
    console.log('世界书列表:', worldBooks);

    if (!worldBooks || worldBooks.length === 0) {
      console.warn('⚠️ 没有可用的世界书，请先导入世界书文件');
      return;
    }

    // 测试每个世界书的关键词匹配
    for (const book of worldBooks) {
      console.log(`\n2️⃣ 测试世界书: ${book.name}`);
      
      for (const text of testTexts) {
        console.log(`\n  测试文本: "${text}"`);
        
        const result = await window.electronAPI.worldbook.matchKeywords(
          text,
          [book.path],
          {
            caseSensitive: false,
            matchWholeWords: true,
            maxResults: 5,
          }
        );

        if (result.success && result.matches.length > 0) {
          console.log(`  ✅ 匹配成功 (${result.count} 个结果):`);
          result.matches.forEach((match, i) => {
            console.log(`    ${i + 1}. ${match.comment || match.name}`);
            console.log(`       匹配关键词: ${match.matchedKeys.join(', ')}`);
            console.log(`       匹配类型: ${match.matchType}`);
            console.log(`       匹配分数: ${match.matchScore}`);
            console.log(`       内容: ${match.content.substring(0, 50)}...`);
          });
        } else {
          console.log('  ❌ 无匹配结果');
        }
      }
    }

    // 测试扫描深度功能
    console.log('\n3️⃣ 测试扫描深度功能...');
    const conversation = [
      { role: 'user', content: '你知道朱迪吗？' },
      { role: 'assistant', content: '是的，朱迪是疯狂动物城的角色' },
      { role: 'user', content: '她是个什么样的角色？' },
    ];

    const contextResult = await window.electronAPI.context.retrieveWithKeywords(
      conversation,
      {
        scopeIds: worldBooks.map(b => b.path),
        topK: 5,
        minScore: 0.5,
      },
      true,  // enableKeywordMatch
      4      // scanDepth
    );

    if (contextResult.success) {
      console.log(`✅ 综合检索结果:`);
      console.log(`   向量匹配: ${contextResult.vectorItems?.length || 0} 个`);
      console.log(`   关键词匹配: ${contextResult.keywordItems?.length || 0} 个`);
      console.log(`   总计: ${contextResult.items?.length || 0} 个`);
      
      if (contextResult.keywordItems && contextResult.keywordItems.length > 0) {
        console.log('   关键词匹配详情:');
        contextResult.keywordItems.forEach((item, i) => {
          console.log(`     ${i + 1}. ${item.metadata?.entryName || '未命名'}`);
          console.log(`        触发关键词: ${item.metadata?.matchedKeys?.join(', ') || 'N/A'}`);
        });
      }
    } else {
      console.error('❌ 综合检索失败:', contextResult.error);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
  }

  console.log('\n=== 测试完成 ===');
}

// 运行测试
testKeywordMatching();
