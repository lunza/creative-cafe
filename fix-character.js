const fs = require('fs/promises');
const { CharacterCard } = require('@lenml/char-card-reader');

async function fixCharacterCard() {
  try {
    const damagedFilePath = 'g:\\AI\\travenManager\\main_ceroba-ketsukane-deltarune-yellow-27191f94b087_spec_v2.png';
    const fixedFilePath = 'g:\\AI\\travenManager\\main_ceroba-ketsukane-deltarune-yellow-27191f94b087_spec_v2_fixed.json';
    
    console.log('Reading damaged character card:', damagedFilePath);
    
    // 读取损坏的文件内容（JSON 格式）
    const content = await fs.readFile(damagedFilePath, 'utf-8');
    console.log('File read successfully');
    
    // 解析 JSON 数据
    const jsonData = JSON.parse(content);
    console.log('JSON parsed successfully');
    
    // 保存为 JSON 文件
    await fs.writeFile(fixedFilePath, JSON.stringify(jsonData, null, 2), 'utf-8');
    console.log('Fixed character card saved to:', fixedFilePath);
    
    console.log('Fix completed successfully!');
  } catch (error) {
    console.error('Error:', error);
  }
}

// 调用修复函数
fixCharacterCard();