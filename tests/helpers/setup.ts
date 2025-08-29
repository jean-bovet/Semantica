import { beforeAll, afterAll } from 'vitest';
import { setEmbedImpl } from '../../src/shared/embeddings/local';
import { mockEmbed } from './mock-embeddings';
import { installNoNetwork } from './no-network';

beforeAll(() => {
  setEmbedImpl(async (texts: string[]) => mockEmbed(texts));
});

afterAll(() => {
  setEmbedImpl(null as any);
});

installNoNetwork();