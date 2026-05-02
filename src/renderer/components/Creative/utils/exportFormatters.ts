export interface CharacterCardV3 {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  tags: string[];
  spec: 'chara_card_v3';
  spec_version: '3.0';
  data: {
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
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
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

export function downloadCharacterCardPNG(characterCard: CharacterCardV3, filename: string) {
  const jsonContent = JSON.stringify(characterCard, null, 2);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    downloadFile(`${filename}.json`, jsonContent);
    return;
  }

  const img = new Image();
  const defaultSize = 512;

  img.onload = () => {
    canvas.width = img.width || defaultSize;
    canvas.height = img.height || defaultSize;

    ctx.drawImage(img, 0, 0);

    const textEncoder = new TextEncoder();
    const jsonData = textEncoder.encode(jsonContent);

    const dataView = new DataView(new ArrayBuffer(8));
    dataView.setUint32(0, 0x00000000, true);
    dataView.setUint32(4, jsonData.length, true);

    const pngChunk = new Uint8Array(
      new Uint8Array(dataView.buffer).buffer.byteLength + jsonData.length + 4
    );

    pngChunk.set(new Uint8Array(dataView.buffer), 0);
    pngChunk.set(jsonData, 8);

    const textChunk = new Uint8Array(4 + 4 + 4 + pngChunk.length + 4);
    const chunkDataLength = pngChunk.length;

    const lengthView = new DataView(textChunk.buffer, 0, 4);
    lengthView.setUint32(0, chunkDataLength, false);

    const typeBytes = new Uint8Array(4);
    typeBytes[0] = 116;
    typeBytes[1] = 101;
    typeBytes[2] = 120;
    typeBytes[3] = 116;
    textChunk.set(typeBytes, 4);

    textChunk.set(pngChunk, 8);

    const crc32 = calculateCRC32(typeBytes, pngChunk);
    const crcView = new DataView(textChunk.buffer, textChunk.length - 4, 4);
    crcView.setUint32(0, crc32, false);

    canvas.toBlob((blob) => {
      if (!blob) {
        downloadFile(`${filename}.json`, jsonContent);
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const pngData = new Uint8Array(reader.result as ArrayBuffer);

        const iendIndex = findIENDIndex(pngData);
        if (iendIndex === -1) {
          downloadFile(`${filename}.json`, jsonContent);
          return;
        }

        const newPngData = new Uint8Array(iendIndex + 4 + textChunk.length + (pngData.length - iendIndex));
        newPngData.set(pngData.slice(0, iendIndex), 0);
        newPngData.set(textChunk, iendIndex);
        newPngData.set(pngData.slice(iendIndex), iendIndex + textChunk.length);

        const finalBlob = new Blob([newPngData], { type: 'image/png' });
        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };
      reader.readAsArrayBuffer(blob);
    }, 'image/png');
  };

  img.onerror = () => {
    downloadFile(`${filename}.json`, jsonContent);
  };

  img.src = '';

  setTimeout(() => {
    downloadFile(`${filename}.json`, jsonContent);
  }, 100);
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
  const iendSignature = [0x49, 0x45, 0x4E, 0x44];

  for (let i = 0; i < data.length - 8; i++) {
    if (
      data[i] === iendSignature[0] &&
      data[i + 1] === iendSignature[1] &&
      data[i + 2] === iendSignature[2] &&
      data[i + 3] === iendSignature[3]
    ) {
      return i + 4;
    }
  }
  return -1;
}
