import * as fs from 'fs/promises';
import * as path from 'path';
import { getEmbeddingService } from './EmbeddingService';
import { vectorStoreService } from './VectorStoreService';
import { vectorRegistryService, VectorSourceType } from './VectorRegistryService';
import type { VectorItem, VectorSourceTypeStorageConfig } from '../types/vectorConfig';
import { VectorSourceTypeStorageConfig } from '../types/vectorConfig';

export type DocumentFileType = 'pdf' | 'docx' | 'doc' | 'xlsx' | 'xls' | 'txt' | 'md' | 'json';

export interface DocumentMetadata {
  id: string;
  fileName: string;
  fileType: DocumentFileType;
  fileSize: number;
  uploadedAt: number;
  processedAt: number;
  chunkCount: number;
  totalChars: number;
  isWorldBook?: boolean;
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
  embeddings?: number[][];
  chunks?: DocumentChunk[];
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
const SUPPORTED_EXTENSIONS = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'md', 'json'] as const;

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

  async storeDocumentVectors(docId: string, fileName: string, fileType: DocumentFileType, chunks: DocumentChunk[], embeddings: number[][], isWorldBook = false): Promise<boolean> {
    try {
      const sourceType = isWorldBook ? VectorSourceType.WORLDBOOK : VectorSourceType.KNOWLEDGE;
      const storageConfig = VectorSourceTypeStorageConfig[sourceType];
      
      const itemsToStore: VectorItem[] = chunks.map((chunk, i) => ({
        id: `doc:${docId}:${i}`,
        vector: embeddings[i],
        metadata: {
          text: chunk.text,
          source: sourceType,
          sourceId: docId,
          docId,
          chunkIndex: i,
          chunkText: chunk.text.slice(0, 200),
          fileName,
          fileType,
          isWorldBook,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      }));

      await vectorStoreService.addBatchNoPersist(itemsToStore);
      await vectorStoreService.persist();
      
      // 注册到向量注册表
      try {
        await vectorRegistryService.registerVectorFile({
          vectorFileId: docId,
          sourceType,
          sourceId: docId,
          sourceName: fileName,
          vectorCount: chunks.length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: 'active',
          additionalMetadata: {
            fileName,
            fileType,
            chunkCount: chunks.length,
            isWorldBook,
          }
        });
        console.log(`[DocumentProcessorService] Registered as ${sourceType} (isWorldBook: ${isWorldBook})`);
      } catch (error) {
        console.error('[DocumentProcessorService] storeDocumentVectors: failed to register to registry:', error);
      }
      
      return true;
    } catch (error) {
      console.error(`[DocumentProcessorService] storeDocumentVectors failed:`, error);
      return false;
    }
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

  async getDocumentChunks(docId: string): Promise<DocumentChunk[]> {
    console.log(`[DocumentProcessorService] getDocumentChunks("${docId}"): starting...`);
    const count = await vectorStoreService.countByPrefix(`doc:${docId}:`);
    console.log(`[DocumentProcessorService] Found ${count} vectors for docId: ${docId}`);
    
    const chunks: DocumentChunk[] = [];
    for (let i = 0; i < count; i++) {
      const itemId = `doc:${docId}:${i}`;
      console.log(`[DocumentProcessorService] Fetching chunk ${i}: ${itemId}`);
      
      const item = await vectorStoreService.getById(itemId);
      
      if (item && item.metadata) {
        const text = item.metadata.text || item.metadata.chunkText || '';
        console.log(`[DocumentProcessorService] Chunk ${i} found, text length: ${text.length}`);
        chunks.push({
          index: i,
          text: text,
        });
      } else {
        console.warn(`[DocumentProcessorService] Chunk ${i} (${itemId}) not found or has no metadata`);
        console.log(`[DocumentProcessorService] Item:`, JSON.stringify(item));
      }
    }
    
    console.log(`[DocumentProcessorService] getDocumentChunks("${docId}"): returning ${chunks.length} chunks`);
    return chunks;
  }

  async searchDocumentVectors(queryText: string, topK: number = 5, docId?: string): Promise<Array<{ id: string; score: number; metadata: Record<string, any> }>> {
    const embeddingService = getEmbeddingService();
    const embeddingResult = await embeddingService.generateEmbedding(queryText);
    if (!embeddingResult.success || !embeddingResult.vector) {
      throw new Error(`查询文本向量化失败: ${embeddingResult.error}`);
    }

    const filter = docId ? { docId } : undefined;
    const results = await vectorStoreService.search(embeddingResult.vector, topK, filter);
    return results.map(r => ({
      id: r.id,
      score: r.score,
      metadata: r.metadata,
    }));
  }

  async getVectorStats(): Promise<{ totalVectors: number; documentCount: number; documents: Array<{ docId: string; fileName: string; vectorCount: number }> }> {
    const allDocs = await this.listDocuments();
    const totalVectors = await vectorStoreService.count();
    const documents = allDocs.map(doc => ({
      docId: doc.documentId,
      fileName: doc.metadata.fileName,
      vectorCount: doc.chunkCount,
    }));
    return {
      totalVectors,
      documentCount: allDocs.length,
      documents,
    };
  }

  async deleteDocument(docId: string): Promise<boolean> {
    const metaPath = this.getDocMetaPath(docId);
    try {
      console.log(`[DocumentProcessorService] deleteDocument: starting deletion for docId=${docId}`);
      
      // Step 1: 从向量注册表查找条目
      // 支持两种 docId 格式：
      //   - 注册表 ID（如 reg_1777917018256_xxx）：直接通过 id 查找
      //   - 源 ID（如 狼人杀1.0_修复版）：通过 sourceId 查找
      let registryEntries: VectorRegistryEntry[] = await vectorRegistryService.getVectorFilesBySourceId(docId);
      
      // 如果按 sourceId 没找到，尝试按注册表 ID 查找
      // 注意：getVectorFileById 返回单个对象或 null，不是数组
      if (registryEntries.length === 0) {
        const singleEntry = await vectorRegistryService.getVectorFileById(docId);
        if (singleEntry) {
          registryEntries = [singleEntry];
        }
      }
      
      console.log(`[DocumentProcessorService] deleteDocument: found ${registryEntries.length} registry entries for docId=${docId}`);
      
      let totalDeleted = 0;
      
      // Step 2: 从向量存储中删除向量数据
      if (registryEntries.length > 0) {
        for (const entry of registryEntries) {
          console.log(`[DocumentProcessorService] deleteDocument: deleting from sourceType=${entry.sourceType}, sourceId=${entry.sourceId}`);
          
          // 根据 entry 中的 vectorFileId 或 sourceId 构建删除前缀
          // worldbook 类型使用 wb_{vectorFileId}_ 前缀
          // knowledge 类型使用 doc:{sourceId}: 前缀
          let prefix: string;
          if (entry.sourceType === 'worldbook') {
            prefix = `wb_${entry.vectorFileId}_`;
          } else {
            prefix = `doc:${entry.sourceId}:`;
          }
          
          const deleted = await vectorStoreService.deleteByPrefix(prefix, {
            sourceType: entry.sourceType,
            sourceId: entry.sourceId,
          });
          totalDeleted += deleted;
          console.log(`[DocumentProcessorService] deleteDocument: deleted ${deleted} vectors using prefix "${prefix}" from ${entry.sourceType}:${entry.sourceId}`);
          
          // Step 2.5: 更新注册表中的向量计数并清理文件
          const remainingCount = await vectorStoreService.countByPrefix(prefix);
          if (remainingCount === 0) {
            console.log(`[DocumentProcessorService] deleteDocument: removing registry entry ${entry.id} and deleting vecstore files`);
            
            // 物理删除注册表条目（已改为物理删除而非软删除）
            await vectorRegistryService.deleteVectorFile(entry.id);
            
            // 物理删除 vecstore.json 和 vecstore_metadata.json 文件
            try {
              const store = vectorStoreService.getVecstoreStoreForSource(entry.sourceType, entry.sourceId);
              if (store) {
                await store.destroyAndDeleteFiles();
                console.log(`[DocumentProcessorService] deleteDocument: vecstore files deleted for ${entry.sourceType}:${entry.sourceId}`);
              }
            } catch (err) {
              console.warn(`[DocumentProcessorService] deleteDocument: failed to delete vecstore files for ${entry.sourceType}:${entry.sourceId}`, err);
            }
          } else {
            console.log(`[DocumentProcessorService] deleteDocument: updating vectorCount to ${remainingCount}`);
            await vectorRegistryService.updateVectorFile(entry.id, { vectorCount: remainingCount });
          }
        }
      } else {
        // 注册表中没有条目，回退到全局删除
        console.log(`[DocumentProcessorService] deleteDocument: no registry entries, falling back to global delete`);
        // 尝试两种前缀
        const deleted1 = await vectorStoreService.deleteByPrefix(`doc:${docId}:`);
        const deleted2 = await vectorStoreService.deleteByPrefix(`wb_${docId}_`);
        totalDeleted = deleted1 + deleted2;
        console.log(`[DocumentProcessorService] deleteDocument: deleted ${totalDeleted} vectors from all stores`);
      }
      
      // Step 3: 删除文档元数据文件
      try {
        await fs.unlink(metaPath);
        console.log(`[DocumentProcessorService] deleteDocument: deleted meta file ${metaPath}`);
      } catch (err) {
        console.warn(`[DocumentProcessorService] deleteDocument: meta file not found (may already be deleted): ${metaPath}`);
      }
      
      console.log(`[DocumentProcessorService] deleteDocument: completed, totalDeleted=${totalDeleted}`);
      return true;
    } catch (error) {
      console.error(`[DocumentProcessorService] deleteDocument failed for docId=${docId}:`, error);
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
      const chunks = this.chunkText(text, fileType);

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

      progress('store', 95, '存储元数据...');
      
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

      await this.saveDocMeta(docId, metadata);

      progress('done', 100, '处理完成');

      return {
        success: true,
        documentId: docId,
        metadata,
        chunkCount: chunks.length,
        embeddings,
        chunks,
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
      case 'json':
        return this.extractJson(filePath);
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

  private async extractJson(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`JSON 读取失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检测文本是否为世界书JSON格式
   */
  private isWorldBookFormat(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed.entries === 'object' && parsed.entries !== null;
    } catch {
      return false;
    }
  }

  /**
   * 世界书条目分块 - 每个条目作为一个完整的分块，不进行500字符分割
   */
  private chunkWorldBookEntries(text: string): DocumentChunk[] {
    const worldBookData = JSON.parse(text);
    const chunks: DocumentChunk[] = [];
    const entries = Object.entries(worldBookData.entries || {});

    for (const [key, entry] of entries) {
      const e = entry as any;
      const entryUid = e.uid || key;

      // 跳过被禁用的条目
      if (e.disable || e.enabled === false) continue;

      // 跳过空内容条目
      if (!e.content || e.content.trim().length === 0) continue;

      // 每个条目作为一个完整的分块（不分割）
      const entryText = `## ${e.comment || e.name || `条目 ${entryUid}`}
关键词：${(e.key || []).join(', ')}${e.keysecondary && e.keysecondary.length > 0 ? ', ' + (e.keysecondary as string[]).join(', ') : ''}
${e.content}`;

      chunks.push({
        index: chunks.length,
        text: entryText,
      });
    }

    return chunks.length > 0 ? chunks : [{ index: 0, text: text }];
  }

  /**
   * 标准文本分块 - 按500字符分割
   */
  private chunkStandardText(text: string): DocumentChunk[] {
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
          
          const chunkText2 = remaining.slice(0, splitPoint).trim();
          chunks.push({ index: chunkIndex++, text: chunkText2 });
          
          const overlapStart = Math.max(0, splitPoint - CHUNK_OVERLAP);
          const newRemaining = remaining.slice(overlapStart).trimStart();
          
          if (newRemaining.length >= remaining.length) {
            remaining = remaining.slice(Math.min(splitPoint + 1, remaining.length));
          } else {
            remaining = newRemaining;
          }
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

  /**
   * 文本分块 - 根据文件类型自动选择分块策略
   * 世界书JSON文件按条目分块，其他文件按500字符分块
   */
  private chunkText(text: string, fileType?: DocumentFileType): DocumentChunk[] {
    // 检测世界书JSON格式
    if (fileType === 'json' || this.isWorldBookFormat(text)) {
      return this.chunkWorldBookEntries(text);
    }
    
    // 标准500字符分块
    return this.chunkStandardText(text);
  }
}

export const documentProcessorService = new DocumentProcessorService();
