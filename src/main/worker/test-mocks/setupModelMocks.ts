const { MockAgent, setGlobalDispatcher } = require('undici');

/**
 * Setup mock responses for model downloads
 * This runs inside the worker thread/process to intercept fetch calls
 */
export function setupModelDownloadMocks(): void {
  console.log('[MOCK] ========== SETTING UP MODEL DOWNLOAD MOCKS ==========');
  console.log('[MOCK] Creating MockAgent...');
  
  const mockAgent = new MockAgent();
  
  // CRITICAL: Set the mock agent as the global dispatcher FIRST
  console.log('[MOCK] Setting MockAgent as global dispatcher...');
  setGlobalDispatcher(mockAgent);
  
  // Then disable network connections
  console.log('[MOCK] Disabling network connections...');
  mockAgent.disableNetConnect();
  
  console.log('[MOCK] MockAgent configured successfully');
  
  const mockPool = mockAgent.get('https://huggingface.co');
  
  // Mock all model files
  const files = [
    { name: 'config.json', path: '/Xenova/multilingual-e5-small/resolve/main/config.json' },
    { name: 'tokenizer_config.json', path: '/Xenova/multilingual-e5-small/resolve/main/tokenizer_config.json' },
    { name: 'tokenizer.json', path: '/Xenova/multilingual-e5-small/resolve/main/tokenizer.json' },
    { name: 'special_tokens_map.json', path: '/Xenova/multilingual-e5-small/resolve/main/special_tokens_map.json' },
    { name: 'model_quantized.onnx', path: '/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx' }
  ];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`[MOCK] Mocking ${file.name}`);
    
    // Create mock content
    const content = file.name.endsWith('.onnx') 
      ? Buffer.alloc(1000, 0x42) // 1KB of dummy binary data
      : Buffer.from(JSON.stringify({ mock: true, file: file.name }));
    
    mockPool
      .intercept({ path: file.path, method: 'GET' })
      .reply(200, content, {
        headers: {
          'content-type': file.name.endsWith('.onnx') ? 'application/octet-stream' : 'application/json',
          'content-length': content.length.toString()
        }
      })
      .delay(1000) // 1 second delay before sending response
      .persist(); // Allow multiple requests
    
    console.log(`[MOCK] File ${file.name} will be delayed by 1000ms`);
  }
  
  console.log('[MOCK] All model file mocks configured');
}