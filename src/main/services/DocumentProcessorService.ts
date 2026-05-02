import * as fs from 'fs/promises';
import * as path from 'path';
import { getEmbeddingService } from './EmbeddingService';
import { vectorStoreService } from './VectorStoreService';

export type DocumentFileType = 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'txt' | 'md';

export interface DocumentMetadata {
  id: string;
  fileName: string;
  fileType: DocumentFileType;
  fileSize: number;
  uploadedAt: number;
  processedAt: number;
  chunkCount: number;
  totalChars: number;
}

export interface DocumentChunk {
  index: number;
  text: string;
}

export interface DocumentProcessingResult {
  success: boolean;
  documentId: string;
  metadata: DocumentMetadata;
  chunkCount: number;
  error?: string;
}

export interface DocumentInfo {
  documentId: string;
  metadata: DocumentMetadata;
  chunkCount: number;
  storedAt: number;
}

export interface ProcessingProgress {
  step: string;
  progress: number;
  message: string;
}

const MAX_CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'md'] as const;

export class DocumentProcessorService {
  private docsStorePath: string;

  constructor() {
    this.docsStorePath = path.join(process.env.APPDATA || '', 'creative-cafe', 'data', 'vector-docs');
  }

  private async ensureDocsDir(): Promise<void> {
    await fs.mkdir(this.docsStorePath, { recursive: true });
  }

  private getDocMetaPath(docId: string): string {
    return path.join(this.docsStorePath, `${docId}.meta.json`);
  }

  private async saveDocMeta(docId: string, metadata: DocumentMetadata): Promise<void> {
    await this.ensureDocsDir();
    await fs.writeFile(this.getDocMetaPath(docId), JSON.stringify(metadata, null, 2), 'utf-8');
  }

  private async getDocMeta(docId: string): Promise<DocumentMetadata | null> {
    try {
      const data = await fs.readFile(this.getDocMetaPath(docId), 'utf-8');
      return JSON.parse(data) as DocumentMetadata;
    } catch {
      return null;
    }
  }

  async listDocuments(): Promise<DocumentInfo[]> {
    await this.ensureDocsDir();
    const files = await fs.readdir(this.docsStorePath);
    const metaFiles = files.filter(f => f.endsWith('.meta.json'));
    
    const results: DocumentInfo[] = [];
    for (const metaFile of metaFiles) {
      const docId = metaFile.replace('.meta.json', '');
      const metadata = await this.getDocMeta(docId);
      if (metadata) {
        const itemCount = await vectorStoreService.countByPrefix(`doc:${docId}:`);
        results.push({
          documentId: docId,
          metadata,
          chunkCount: itemCount,
          storedAt: metadata.processedAt,
        });
      }
    }
    return results;
  }

  async getDocumentInfo(docId: string): Promise<DocumentInfo | null> {
    const metadata = await this.getDocMeta(docId);
    if (!metadata) return null;
    const itemCount = await vectorStoreService.countByPrefix(`doc:${docId}:`);
    return {
      documentId: docId,
      metadata,
      chunkCount: itemCount,
      storedAt: metadata.processedAt,
    };
  }

  async deleteDocument(docId: string): Promise<boolean> {
    const metaPath = this.getDocMetaPath(docId);
    try {
      await vectorStoreService.deleteByPrefix(`doc:${docId}:`);
      await fs.unlink(metaPath);
      return true;
    } catch {
      return false;
    }
  }

  async processDocument(
    filePath: string,
    onProgress?: (progress: ProcessingProgress) => void,
  ): Promise<DocumentProcessingResult> {
    const startTime = Date.now();
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).slice(1).toLowerCase();
    const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const progress = (step: string, pct: number, message: string) => {
      if (onProgress) onProgress({ step, progress: pct, message });
    };

    try {
      progress('validate', 5, '验证文件格式...');
      
      const fileType = this.validateFileType(fileName);
      if (!fileType) {
        throw new Error(`不支持的文件格式: ${ext}。支持: ${SUPPORTED_EXTENSIONS.join(', ')}`);
      }

      const stats = await fs.stat(filePath);
      if (stats.size > 50 * 1024 * 1024) {
        throw new Error('文件大小超过 50MB 限制');
      }

      progress('extract', 10, '提取文本内容...');
      const text = await this.extractText(filePath, fileType);
      
      if (!text || text.trim().length === 0) {
        throw new Error('文件中未找到有效文本内容');
      }

      progress('chunk', 40, '文本分块处理...');
      const chunks = this.chunkText(text);

      progress('vectorize', 50, `向量化处理 (${chunks.length} 个分块)...`);
      const embeddingService = getEmbeddingService();
      const texts = chunks.map(c => c.text);
      
      let embeddings: number[][];
      const batchSize = 10;
      const allEmbeddings: number[][] = [];
      
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const result = await embeddingService.generateBatchEmbeddings(batch);
        if (!result.success) {
          throw new Error(`向量化失败: ${result.error}`);
        }
        allEmbeddings.push(...(result.vectors || []));
        const vecProgress = 50 + Math.round(((i + batchSize) / texts.length) * 40);
        progress('vectorize', Math.min(vecProgress, 90), `向量化进度: ${i + batchSize}/${texts.length}`);
      }
      embeddings = allEmbeddings;

      if (embeddings.length !== chunks.length) {
        throw new Error(`向量数量与分块数量不匹配: ${embeddings.length} !== ${chunks.length}`);
      }

      progress('store', 95, '存储向量数据...');
      
      const metadata: DocumentMetadata = {
        id: docId,
        fileName,
        fileType,
        fileSize: stats.size,
        uploadedAt: startTime,
        processedAt: Date.now(),
        chunkCount: chunks.length,
        totalChars: text.length,
      };

      for (let i = 0; i < chunks.length; i++) {
        await vectorStoreService.add(
          `doc:${docId}:${i}`,
          embeddings[i],
          {
            docId,
            chunkIndex: i,
            chunkText: chunks[i].text.slice(0, 200),
            fileName,
            fileType,
          },
        );
      }

      await this.saveDocMeta(docId, metadata);

      progress('done', 100, '处理完成');

      return {
        success: true,
        documentId: docId,
        metadata,
        chunkCount: chunks.length,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      progress('error', 0, `处理失败: ${msg}`);
      return {
        success: false,
        documentId: docId,
        metadata: {
          id: docId,
          fileName,
          fileType: ext as DocumentFileType,
          fileSize: 0,
          uploadedAt: startTime,
          processedAt: Date.now(),
          chunkCount: 0,
          totalChars: 0,
        },
        chunkCount: 0,
        error: msg,
      };
    }
  }

  private validateFileType(fileName: string): DocumentFileType | null {
    const ext = path.extname(fileName).slice(1).toLowerCase();
    if (SUPPORTED_EXTENSIONS.includes(ext as any)) {
      return ext as DocumentFileType;
    }
    return null;
  }

  private async extractText(filePath: string, fileType: DocumentFileType): Promise<string> {
    switch (fileType) {
      case 'pdf':
        return this.extractPdf(filePath);
      case 'docx':
        return this.extractDocx(filePath);
      case 'doc':
        return this.extractDoc(filePath);
      case 'xlsx':
      case 'xls':
        return this.extractExcel(filePath);
      case 'txt':
        return this.extractTxt(filePath);
      case 'md':
        return this.extractMd(filePath);
      default:
        throw new Error(`不支持的格式: ${fileType}`);
    }
  }

  private async extractPdf(filePath: string): Promise<string> {
    try {
      const pdfParse = require('pdf-parse');
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text || '';
    } catch (error) {
      throw new Error(`PDF 提取失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async extractDocx(filePath: string): Promise<string> {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    } catch (error) {
      throw new Error(`DOCX 提取失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async extractDoc(filePath: string): Promise<string> {
    throw new Error('.doc 格式需要转换为 .docx 后处理，请使用 Word 另存为 .docx 格式');
  }

  private async extractExcel(filePath: string): Promise<string> {
    try {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(filePath);
      const texts: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        for (const row of json) {
          if (Array.isArray(row)) {
            const rowText = row.map(c => String(c ?? '')).filter(Boolean).join(' ');
            if (rowText.trim()) texts.push(rowText);
          }
        }
      }
      return texts.join('\n');
    } catch (error) {
      throw new Error(`Excel 提取失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async extractTxt(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`TXT 读取失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async extractMd(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`MD 读取失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private chunkText(text: string): DocumentChunk[] {
    const cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const paragraphs = cleaned.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    const chunks: DocumentChunk[] = [];
    let currentChunk = '';
    let chunkIndex = 0;

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      
      if (trimmedPara.length > MAX_CHUNK_SIZE) {
        if (currentChunk) {
          chunks.push({ index: chunkIndex++, text: currentChunk.trim() });
          currentChunk = '';
        }
        
        let remaining = trimmedPara;
        while (remaining.length > 0) {
          if (remaining.length <= MAX_CHUNK_SIZE) {
            chunks.push({ index: chunkIndex++, text: remaining });
            break;
          }
          
          let splitPoint = MAX_CHUNK_SIZE;
          const lastSpace = remaining.lastIndexOf(' ', MAX_CHUNK_SIZE);
          if (lastSpace > MAX_CHUNK_SIZE * 0.3) {
            splitPoint = lastSpace;
          }
          
          chunks.push({ index: chunkIndex++, text: remaining.slice(0, splitPoint).trim() });
          remaining = remaining.slice(Math.max(0, splitPoint - CHUNK_OVERLAP));
        }
      } else {
        if (currentChunk.length + trimmedPara.length + 2 > MAX_CHUNK_SIZE && currentChunk) {
          chunks.push({ index: chunkIndex++, text: currentChunk.trim() });
          currentChunk = trimmedPara;
        } else {
          currentChunk += (currentChunk ? '\n' : '') + trimmedPara;
        }
      }
    }

    if (currentChunk.trim()) {
      chunks.push({ index: chunkIndex++, text: currentChunk.trim() });
    }

    return chunks.length > 0 ? chunks : [{ index: 0, text: cleaned.trim() }];
  }
}

export const documentProcessorService = new DocumentProcessorService();
