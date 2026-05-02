// 初始化 @xenova/transformers 使用 WASM 后端而不是原生模块
// This prevents the "Could not dynamically require onnxruntime_binding.node" error
// in Electron + Vite environments

export function initTransformersWASM(): void {
  process.env.ORT_DISABLE_EXTERNAL_INITIALIZERS = '1';
  process.env.ORT_PROVIDERS = 'wasm';
  
  try {
    const { env } = require('@xenova/transformers');
    
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.backends.onnx.wasm.numThreads = 1;
    
    console.log('[TransformersWASM] Initialized with WASM backend');
  } catch (error) {
    console.error('[TransformersWASM] Failed to initialize:', error);
  }
}
