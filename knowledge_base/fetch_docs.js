#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// 知识库目录
const BASE_DIR = path.join(__dirname);

// 文档配置
const DOCS_CONFIG = [
  {
    name: 'ant-design-x',
    version: '2.4.0',
    docs: [
      { url: 'https://x.ant.design', path: 'index.md' },
      { url: 'https://x.ant.design/changelog', path: 'changelog.md' },
      { url: 'https://x.ant.design/docs', path: 'docs/index.md' }
    ]
  },
  {
    name: 'vercel-ai-sdk',
    version: '6.0.0',
    docs: [
      { url: 'https://sdk.vercel.ai', path: 'index.md' },
      { url: 'https://sdk.vercel.ai/docs', path: 'docs/index.md' },
      { url: 'https://sdk.vercel.ai/docs/react', path: 'docs/react.md' }
    ]
  }
];

// 日志函数
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 获取文档内容
async function fetchDoc(url) {
  try {
    log(`Fetching ${url}...`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    log(`Error fetching ${url}: ${error.message}`);
    return `Error fetching document: ${error.message}`;
  }
}

// 保存文档
function saveDoc(content, filePath) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  log(`Saved document to ${filePath}`);
}

// 生成版本信息
function generateVersionInfo(packageName, version) {
  return {
    package: packageName,
    version: version,
    timestamp: new Date().toISOString(),
    source: 'official documentation'
  };
}

// 主函数
async function main() {
  log('Starting documentation fetch process...');
  
  for (const config of DOCS_CONFIG) {
    log(`Processing ${config.name} version ${config.version}...`);
    
    const packageDir = path.join(BASE_DIR, config.name);
    ensureDir(packageDir);
    
    // 保存版本信息
    const versionInfo = generateVersionInfo(config.name, config.version);
    const versionPath = path.join(packageDir, 'version.json');
    saveDoc(JSON.stringify(versionInfo, null, 2), versionPath);
    
    // 保存文档
    for (const doc of config.docs) {
      const content = await fetchDoc(doc.url);
      const docPath = path.join(packageDir, doc.path);
      saveDoc(content, docPath);
    }
    
    log(`Completed processing ${config.name}`);
  }
  
  log('Documentation fetch process completed!');
}

// 运行主函数
main().catch(error => {
  log(`Error: ${error.message}`);
  process.exit(1);
});
