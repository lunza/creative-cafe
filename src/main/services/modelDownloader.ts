import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

const HF_MIRROR = 'https://hf-mirror.com';
const HF_OFFICIAL = 'https://huggingface.co';
const MODELSCOPE = 'https://modelscope.cn/api/v1/models';

const MODEL_FILES = [
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
  'special_tokens_map.json',
  'vocab.txt',
  'onnx/model_quantized.onnx',
  'onnx/model.onnx'
];

export async function downloadModelFromHF(
  modelName: string,
  localPath: string,
  onProgress?: (progress: number, status: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!fs.existsSync(localPath)) {
      fs.mkdirSync(localPath, { recursive: true });
    }

    onProgress?.(0, 'trying model sources...');

    let downloadedFiles = 0;
    const totalFiles = MODEL_FILES.length;
    const sources = [
      { name: 'HF Mirror', buildUrl: (m: string, f: string) => `${HF_MIRROR}/${m}/resolve/main/${f}`, timeout: 15000 },
      { name: 'HuggingFace', buildUrl: (m: string, f: string) => `${HF_OFFICIAL}/${m}/resolve/main/${f}`, timeout: 15000 }
    ];

    for (const file of MODEL_FILES) {
      const localFilePath = path.join(localPath, file);
      const localFileDir = path.dirname(localFilePath);

      if (!fs.existsSync(localFileDir)) {
        fs.mkdirSync(localFileDir, { recursive: true });
      }

      if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).size > 0) {
        downloadedFiles++;
        const progress = Math.round((downloadedFiles / totalFiles) * 100);
        onProgress?.(progress, `existing: ${file}`);
        continue;
      }

      let fileDownloaded = false;
      for (const source of sources) {
        const fileUrl = source.buildUrl(modelName, file);
        onProgress?.(Math.round((downloadedFiles / totalFiles) * 100), `downloading ${file} from ${source.name}...`);
        try {
          await downloadFile(fileUrl, localFilePath, source.timeout);
          downloadedFiles++;
          onProgress?.(Math.round((downloadedFiles / totalFiles) * 100), `done: ${file}`);
          fileDownloaded = true;
          break;
        } catch (error) {
          console.warn(`[ModelDownloader] ${source.name} failed for ${file}:`, error);
        }
      }

      if (!fileDownloaded) {
        onProgress?.(Math.round((downloadedFiles / totalFiles) * 100), `failed: ${file} (all sources)`);
      }
    }

    if (downloadedFiles >= 4) {
      onProgress?.(100, 'completed');
      return { success: true };
    } else {
      return { success: false, error: `Only ${downloadedFiles}/${totalFiles} files downloaded. Try setting HTTPS_PROXY.` };
    }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

function downloadFile(url: string, outputPath: string, timeout: number = 30000, maxRedirects: number = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;

    const req = client.request(url, {
      method: 'GET',
      timeout: timeout,
      headers: {
        'Accept': 'application/json, application/octet-stream, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (response) => {
      const redirectCodes = [301, 302, 303, 307, 308];
      if (redirectCodes.includes(response.statusCode || 0)) {
        const redirectUrl = response.headers.location;
        if (redirectUrl && maxRedirects > 0) {
          response.resume();
          const finalUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, url).href;
          downloadFile(finalUrl, outputPath, timeout, maxRedirects - 1)
            .then(resolve)
            .catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const contentType = response.headers['content-type'] || '';
      if (contentType.includes('text/html')) {
        reject(new Error(`Server returned HTML instead of file (got: ${contentType})`));
        response.resume();
        return;
      }

      const file = fs.createWriteStream(outputPath);
      let validated = false;

      response.on('data', (chunk: Buffer) => {
        if (!validated) {
          const head = chunk.toString('utf-8', 0, Math.min(chunk.length, 200));
          if (head.includes('<!DOCTYPE') || head.includes('<html')) {
            response.destroy();
            file.close();
            fs.unlink(outputPath, () => {});
            reject(new Error('Server returned HTML error page'));
            return;
          }
          validated = true;
        }
        file.write(chunk);
      });

      response.on('end', () => {
        file.end();
      });

      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    req.on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });

    req.setTimeout(timeout, () => {
      req.destroy();
      fs.unlink(outputPath, () => {});
      reject(new Error('timeout'));
    });

    req.end();
  });
}
