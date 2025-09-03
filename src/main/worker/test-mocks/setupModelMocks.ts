import { MockAgent, setGlobalDispatcher } from 'undici';

/**
 * Setup mock responses for model downloads with deterministic delays
 * This is only loaded when E2E_MOCK_DOWNLOADS=true
 */
export function setupModelDownloadMocks(): void {
  console.log('[MOCK] Setting up model download mocks with MockAgent');
  
  const mockAgent = new MockAgent();
  
  // Disable all network connections except mocked ones
  mockAgent.disableNetConnect();
  
  const mockClient = mockAgent.get('https://huggingface.co');
  
  // Mock each model file with 1 second delay for sequential testing
  const files = [
    {
      name: 'config.json',
      path: '/Xenova/multilingual-e5-small/resolve/main/config.json',
      body: JSON.stringify({
        model_type: 'bert',
        hidden_size: 384,
        num_attention_heads: 12,
        num_hidden_layers: 12
      }),
      contentType: 'application/json'
    },
    {
      name: 'tokenizer_config.json', 
      path: '/Xenova/multilingual-e5-small/resolve/main/tokenizer_config.json',
      body: JSON.stringify({
        do_lower_case: false,
        model_max_length: 512
      }),
      contentType: 'application/json'
    },
    {
      name: 'tokenizer.json',
      path: '/Xenova/multilingual-e5-small/resolve/main/tokenizer.json',
      body: JSON.stringify({
        version: '1.0',
        truncation: null,
        padding: null,
        model: { type: 'BPE', unk_token: '[UNK]' }
      }),
      contentType: 'application/json'
    },
    {
      name: 'special_tokens_map.json',
      path: '/Xenova/multilingual-e5-small/resolve/main/special_tokens_map.json',
      body: JSON.stringify({
        cls_token: '[CLS]',
        eos_token: '[SEP]',
        mask_token: '[MASK]',
        pad_token: '[PAD]',
        sep_token: '[SEP]',
        unk_token: '[UNK]'
      }),
      contentType: 'application/json'
    },
    {
      name: 'model_quantized.onnx',
      path: '/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx',
      body: Buffer.alloc(1000, 0x42), // 1KB of dummy binary data
      contentType: 'application/octet-stream'
    }
  ];
  
  // Set up mock for each file
  for (const file of files) {
    console.log(`[MOCK] Mocking ${file.name} with 1 second delay`);
    
    mockClient
      .intercept({
        path: file.path,
        method: 'GET'
      })
      .reply(200, async function* () {
        // Add 1 second delay before responding
        console.log(`[MOCK] Delaying response for ${file.name}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Yield the file content in chunks to simulate streaming
        const chunkSize = 100;
        const content = typeof file.body === 'string' 
          ? Buffer.from(file.body) 
          : file.body;
        
        for (let i = 0; i < content.length; i += chunkSize) {
          yield content.slice(i, Math.min(i + chunkSize, content.length));
          // Small delay between chunks for more realistic streaming
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        console.log(`[MOCK] Completed response for ${file.name}`);
      }, {
        headers: {
          'content-type': file.contentType,
          'content-length': file.body.length.toString()
        }
      })
      .persist(); // Allow multiple requests to the same endpoint
  }
  
  // Set this mock agent as the global dispatcher
  setGlobalDispatcher(mockAgent);
  
  console.log('[MOCK] Model download mocks configured');
}