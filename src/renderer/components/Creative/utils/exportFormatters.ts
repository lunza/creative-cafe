export interface CharacterCardV3 {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  tags?: string[];
  spec?: 'chara_card_v3';
  spec_version?: '3.0';
  data: {
    name?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    first_mes?: string;
    mes_example?: string;
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    tags?: string[];
    creator?: string;
    character_version?: string;
    alternate_greetings?: string[];
    character_book?: any;
    assets?: any;
    nickname?: string;
    creator_notes_multilingual?: any;
    source?: string;
    group_only_greetings?: any;
    creation_date?: string;
    modification_date?: string;
    extensions: Record<string, any>;
  };
}

export interface WorldBookEntry {
  uid: number;
  key: string[];
  content: string;
  comment: string;
  constant: boolean;
  selective: boolean;
  order: number;
}

export interface WorldBookJSON {
  entries: WorldBookEntry[];
  metadata: {
    name: string;
    description: string;
    format_version: '1.0';
  };
}

export function formatCharacterCardV3(characterName: string, characterContent: string, tags: string[] = []): CharacterCardV3 {
  const parsedContent = parseMarkdownContent(characterContent);

  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: parsedContent.name || characterName,
      description: parsedContent.description || '',
      personality: parsedContent.personality || '',
      scenario: parsedContent.scenario || '',
      first_mes: parsedContent.firstMessage || '',
      mes_example: parsedContent.messageExample || '',
      creator_notes: parsedContent.creatorNotes || '',
      system_prompt: parsedContent.systemPrompt || '',
      post_history_instructions: parsedContent.postHistoryInstructions || '',
      tags,
      extensions: {}
    }
  };
}

function parseMarkdownContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');

  let currentKey = '';
  let currentValue = '';

  const keyMap: Record<string, string> = {
    '角色名称': 'name',
    '角色描述': 'description',
    '角色性格': 'personality',
    '场景设定': 'scenario',
    '第一条消息': 'firstMessage',
    '对话示例': 'messageExample',
    '创作者备注': 'creatorNotes',
    '系统提示': 'systemPrompt',
    '历史后指令': 'postHistoryInstructions',
    'name': 'name',
    'description': 'description',
    'personality': 'personality',
    'scenario': 'scenario',
    'first_mes': 'firstMessage',
    'mes_example': 'messageExample',
    'creator_notes': 'creatorNotes',
    'system_prompt': 'systemPrompt',
    'post_history_instructions': 'postHistoryInstructions'
  };

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      if (currentKey && currentValue) {
        const mappedKey = keyMap[currentKey] || currentKey;
        result[mappedKey] = currentValue.trim();
      }
      currentKey = headerMatch[1].trim();
      currentValue = '';
    } else {
      currentValue += (currentValue ? '\n' : '') + line;
    }
  }

  if (currentKey && currentValue) {
    const mappedKey = keyMap[currentKey] || currentKey;
    result[mappedKey] = currentValue.trim();
  }

  return result;
}

export function formatWorldBookJSON(worldBookName: string, worldBookDescription: string, entries: { key: string; content: string; comment?: string }[]): WorldBookJSON {
  const formattedEntries: WorldBookEntry[] = entries.map((entry, index) => ({
    uid: index + 1,
    key: entry.key ? [entry.key] : [],
    content: entry.content,
    comment: entry.comment || '',
    constant: false,
    selective: true,
    order: index
  }));

  return {
    entries: formattedEntries,
    metadata: {
      name: worldBookName,
      description: worldBookDescription,
      format_version: '1.0'
    }
  };
}

export function downloadFile(filename: string, content: string, mimeType: string = 'application/json') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCharacterCardPNG(characterCard: CharacterCardV3, filename: string, imageBase64?: string) {
  console.log('[PNG Export] Starting export...', { filename, hasImage: !!imageBase64 });
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    message.error('无法创建canvas');
    return;
  }

  const defaultSize = 512;
  canvas.width = defaultSize;
  canvas.height = defaultSize;

  const processAndDownload = () => {
    console.log('[PNG Export] Converting canvas to blob...');
    canvas.toBlob((blob) => {
      if (!blob) {
        console.error('[PNG Export] canvas.toBlob returned null');
        message.error('无法生成PNG');
        return;
      }
      console.log('[PNG Export] Blob created, size:', blob.size, 'type:', blob.type);

      blob.arrayBuffer().then((pngBuffer) => {
        const pngData = new Uint8Array(pngBuffer);
        console.log('[PNG Export] PNG data length:', pngData.length);

        // 转换为base64并调用主进程处理PNG chunks
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const base64Png = reader.result as string;
            
            // 调用主进程正确处理PNG chunks（使用png-chunks-extract和encode）
            const result = await (window as any).electronAPI.character.exportCharacterCard({
              base64Image: base64Png,
              filename: characterCard.name || 'character_card',
              characterData: characterCard
            });

            if (result.success) {
              console.log('[PNG Export] Character card processed successfully');
              
              // 下载处理后的PNG
              const link = document.createElement('a');
              link.href = result.base64Png;
              link.download = `${characterCard.name || 'character_card'}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            } else {
              console.error('[PNG Export] Failed to process:', result.error);
              message.error(`导出失败：${result.error}`);
            }
          } catch (error) {
            console.error('[PNG Export] Error:', error);
            message.error('导出失败');
          }
        };
        reader.readAsDataURL(blob);
      }).catch((error) => {
        console.error('[PNG Export] Error reading blob:', error);
        message.error('导出失败');
      });
    }, 'image/png');
  };

  if (imageBase64) {
    console.log('[PNG Export] Loading image from base64...');
    const img = new Image();
    img.onload = () => {
      console.log('[PNG Export] Image loaded, size:', img.width, 'x', img.height);
      canvas.width = img.width || defaultSize;
      canvas.height = img.height || defaultSize;
      ctx.drawImage(img, 0, 0);
      processAndDownload();
    };
    img.onerror = (e) => {
      console.error('[PNG Export] Image load failed:', e);
      drawDefaultCard();
      processAndDownload();
    };
    img.src = imageBase64;
  } else {
    console.log('[PNG Export] No image provided, using default card');
    drawDefaultCard();
    processAndDownload();
  }

  function drawDefaultCard() {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(characterCard.name || 'Character Card', canvas.width / 2, canvas.height / 2 - 20);
    
    ctx.font = '16px Arial';
    ctx.fillStyle = '#cccccc';
    ctx.fillText('SillyTavern V3', canvas.width / 2, canvas.height / 2 + 20);
  }
}

function calculateCRC32(typeBytes: Uint8Array, data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  const table = getCRC32Table();

  for (let i = 0; i < typeBytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ typeBytes[i]) & 0xFF];
  }
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function getCRC32Table(): number[] {
  const table: number[] = [];
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
    table[i] = crc >>> 0;
  }
  return table;
}

function findIENDIndex(data: Uint8Array): number {
  // PNG IEND chunk结构：
  // 4字节长度(00 00 00 00) + 4字节类型(49 45 4E 44="IEND") + 4字节CRC
  // IEND是PNG的最后一个chunk，所以从末尾往前找更可靠
  
  // 从文件末尾往前搜索完整的IEND chunk标识：00 00 00 00 49 45 4E 44
  for (let i = data.length - 12; i >= 0; i--) {
    if (data[i] === 0 && data[i+1] === 0 && data[i+2] === 0 && data[i+3] === 0 &&
        data[i+4] === 73 && data[i+5] === 69 && data[i+6] === 78 && data[i+7] === 68) {
      return i; // 返回IEND chunk的起始位置（长度字段）
    }
  }
  
  return -1;
}
