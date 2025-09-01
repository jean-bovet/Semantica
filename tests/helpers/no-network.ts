import { beforeAll, afterAll } from 'vitest';

export function installNoNetwork() {
  const originalFetch = global.fetch;
  const originalHttps = require('https');
  const originalHttp = require('http');
  
  beforeAll(() => {
    global.fetch = () => {
      throw new Error('Network access is disabled in tests');
    };
    
    const blockRequest = () => {
      throw new Error('Network access is disabled in tests');
    };
    
    require('https').request = blockRequest;
    require('https').get = blockRequest;
    require('http').request = blockRequest;
    require('http').get = blockRequest;
  });
  
  afterAll(() => {
    global.fetch = originalFetch;
    require('https').request = originalHttps.request;
    require('https').get = originalHttps.get;
    require('http').request = originalHttp.request;
    require('http').get = originalHttp.get;
  });
}