import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorRegistryService, VectorSourceType } from './VectorRegistryService';
import { VectorStoreService } from './VectorStoreService';
import { getStorageService } from './storageService';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';

describe('VectorRegistryService', () => {
  let registryService: VectorRegistryService;

  beforeEach(async () => {
    registryService = new VectorRegistryService();
    await registryService.initialize();
    // Clean registry for each test
    await registryService.cleanupDeletedEntries();
  });

  afterEach(async () => {
    // Clean up after each test
    const entries = await registryService.getAllActiveEntries();
    for (const entry of entries) {
      await registryService.deleteVectorFile(entry.id);
    }
  });

  it('should initialize and load registry', async () => {
    expect(registryService.isInitialized).toBe(true);
  });

  it('should register a new vector file', async () => {
    const id = await registryService.registerVectorFile({
      vectorFileId: 'test_doc_001',
      sourceType: VectorSourceType.DOCUMENT,
      sourceId: 'doc_001',
      sourceName: 'test.txt',
      vectorCount: 10,
      status: 'active',
    });

    expect(id).toBeDefined();
    const entry = await registryService.getVectorFileById(id);
    expect(entry).not.toBeNull();
    expect(entry?.vectorFileId).toBe('test_doc_001');
    expect(entry?.sourceType).toBe(VectorSourceType.DOCUMENT);
  });

  it('should update an existing vector file', async () => {
    const id = await registryService.registerVectorFile({
      vectorFileId: 'test_kb_001',
      sourceType: VectorSourceType.KNOWLEDGE,
      sourceId: 'kb_001',
      sourceName: 'knowledge.json',
      vectorCount: 50,
      status: 'active',
    });

    await registryService.updateVectorFile(id, {
      vectorCount: 100,
    });

    const entry = await registryService.getVectorFileById(id);
    expect(entry?.vectorCount).toBe(100);
  });

  it('should delete a vector file', async () => {
    const id = await registryService.registerVectorFile({
      vectorFileId: 'test_wb_001',
      sourceType: VectorSourceType.WORLDBOOK,
      sourceId: 'worldbook_001',
      sourceName: 'worldbook.json',
      vectorCount: 25,
      status: 'active',
    });

    await registryService.deleteVectorFile(id);
    const entry = await registryService.getVectorFileById(id);
    expect(entry?.status).toBe('deleted');
  });

  it('should get vector files by source type', async () => {
    await registryService.registerVectorFile({
      vectorFileId: 'test_kb_001',
      sourceType: VectorSourceType.KNOWLEDGE,
      sourceId: 'kb_001',
      sourceName: 'knowledge1.json',
      vectorCount: 10,
    });

    await registryService.registerVectorFile({
      vectorFileId: 'test_kb_002',
      sourceType: VectorSourceType.KNOWLEDGE,
      sourceId: 'kb_002',
      sourceName: 'knowledge2.json',
      vectorCount: 20,
    });

    await registryService.registerVectorFile({
      vectorFileId: 'test_doc_001',
      sourceType: VectorSourceType.DOCUMENT,
      sourceId: 'doc_001',
      sourceName: 'test.txt',
      vectorCount: 15,
    });

    const knowledgeEntries = await registryService.getVectorFilesBySource(VectorSourceType.KNOWLEDGE);
    expect(knowledgeEntries.length).toBe(2);
    expect(knowledgeEntries.every(e => e.sourceType === VectorSourceType.KNOWLEDGE)).toBe(true);
  });

  it('should get correct statistics', async () => {
    await registryService.registerVectorFile({
      vectorFileId: 'test_kb_001',
      sourceType: VectorSourceType.KNOWLEDGE,
      sourceId: 'kb_001',
      sourceName: 'knowledge.json',
      vectorCount: 50,
    });

    await registryService.registerVectorFile({
      vectorFileId: 'test_wb_001',
      sourceType: VectorSourceType.WORLDBOOK,
      sourceId: 'wb_001',
      sourceName: 'worldbook.json',
      vectorCount: 25,
    });

    const stats = await registryService.getStatistics();
    expect(stats.activeEntries).toBe(2);
    expect(stats.totalVectorCount).toBe(75);
    expect(stats.bySourceType[VectorSourceType.KNOWLEDGE]?.count).toBe(1);
    expect(stats.bySourceType[VectorSourceType.KNOWLEDGE]?.vectorCount).toBe(50);
  });

  it('should cleanup deleted entries', async () => {
    const id1 = await registryService.registerVectorFile({
      vectorFileId: 'test_kb_001',
      sourceType: VectorSourceType.KNOWLEDGE,
      sourceId: 'kb_001',
      sourceName: 'knowledge1.json',
      vectorCount: 10,
    });

    const id2 = await registryService.registerVectorFile({
      vectorFileId: 'test_kb_002',
      sourceType: VectorSourceType.KNOWLEDGE,
      sourceId: 'kb_002',
      sourceName: 'knowledge2.json',
      vectorCount: 20,
    });

    await registryService.deleteVectorFile(id1);
    const removed = await registryService.cleanupDeletedEntries();
    expect(removed).toBe(1);

    const entries = await registryService.getAllActiveEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe(id2);
  });
});

describe('VectorStoreService Multi-Source Routing', () => {
  let vectorStoreService: VectorStoreService;

  beforeEach(async () => {
    vectorStoreService = new VectorStoreService();
    // Set to vecstore mode for testing
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const vectorConfig = (settings?.vector || {}) as any;
    vectorConfig.vectorStoreMode = 'vecstore';
    storageService.setSettings({ ...settings, vector: vectorConfig });
  });

  afterEach(async () => {
    // Reset to json mode
    const storageService = getStorageService();
    const settings = storageService.getSettings();
    const vectorConfig = (settings?.vector || {}) as any;
    vectorConfig.vectorStoreMode = 'json';
    storageService.setSettings({ ...settings, vector: vectorConfig });
  });

  it('should route add() to correct source store', async () => {
    await vectorStoreService.initialize();
    
    // Add vector with knowledge source
    await vectorStoreService.add('test_kb_001', new Array(384).fill(0.01), {
      text: 'Test knowledge content',
      source: 'knowledge',
    });

    // Add vector with worldbook source
    await vectorStoreService.add('test_wb_001', new Array(384).fill(0.02), {
      text: 'Test worldbook content',
      source: 'worldbook',
    });

    // Verify vectors are stored in different sources
    const testResult = await vectorStoreService.testStorageConnection();
    expect(testResult.success).toBe(true);
    expect(testResult.vectorCount).toBe(2);
  });

  it('should persist all source stores', async () => {
    await vectorStoreService.initialize();
    
    // Add vectors to multiple sources
    await vectorStoreService.add('test_kb_001', new Array(384).fill(0.01), {
      text: 'Knowledge 1',
      source: 'knowledge',
    });
    
    await vectorStoreService.add('test_wb_001', new Array(384).fill(0.02), {
      text: 'Worldbook 1',
      source: 'worldbook',
    });

    // Persist should save all stores
    await vectorStoreService.persist();

    // Verify persistence worked
    const count = await vectorStoreService.count();
    expect(count).toBe(2);
  });

  it('should delete from all stores when sourceType not specified', async () => {
    await vectorStoreService.initialize();
    
    await vectorStoreService.add('test_kb_001', new Array(384).fill(0.01), {
      text: 'Knowledge 1',
      source: 'knowledge',
    });

    await vectorStoreService.delete('test_kb_001');
    
    const count = await vectorStoreService.count();
    expect(count).toBe(1); // Only default store remains
  });

  it('should search with aggregate option', async () => {
    await vectorStoreService.initialize();
    
    // Add vectors to multiple sources
    await vectorStoreService.add('test_kb_001', new Array(384).fill(0.01), {
      text: 'Knowledge about animals',
      source: 'knowledge',
    });

    await vectorStoreService.add('test_wb_001', new Array(384).fill(0.02), {
      text: 'Worldbook about animals',
      source: 'worldbook',
    });

    // Search with aggregate option
    const query = new Array(384).fill(0.015);
    const results = await vectorStoreService.search(query, 10, undefined, { aggregate: true });
    
    expect(results.length).toBeGreaterThan(0);
  });
});
