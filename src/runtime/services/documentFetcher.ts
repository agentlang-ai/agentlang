import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.js';
import { parseAndEvaluateStatement } from '../interpreter.js';
import { CoreAIModuleName } from '../modules/ai.js';
import { TtlCache } from '../state.js';

// Provider-specific configurations
export interface S3Config {
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

// Generic retrieval configuration for any storage provider
export interface RetrievalConfig {
  provider: 's3' | 'box' | 'gdrive' | 'azure' | 'onedrive' | string;
  config: S3Config | Record<string, any>;
}

export interface EmbeddingConfig {
  provider?: string;
  model?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface DocumentConfig {
  title: string;
  url: string;
  retrievalConfig?: RetrievalConfig;
  embeddingConfig?: EmbeddingConfig;
}

export interface FetchedDocument {
  title: string;
  content: string;
  url: string;
  format: string;
  fetchedAt: Date;
  embeddingConfig?: EmbeddingConfig;
}

class DocumentFetcherService {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private documentCache = new TtlCache<FetchedDocument>(DocumentFetcherService.CACHE_TTL_MS);
  private s3Clients = new Map<string, any>();

  async fetchDocument(config: DocumentConfig): Promise<FetchedDocument | null> {
    const cacheKey = `${config.title}:${config.url}`;
    const cached = this.documentCache.get(cacheKey);

    if (cached) {
      logger.debug('Returning cached document', { title: config.title });
      return cached;
    }

    try {
      let content: string;

      if (config.url.startsWith('s3://')) {
        content = await this.fetchFromS3(config);
      } else if (config.url.startsWith('http://') || config.url.startsWith('https://')) {
        content = await this.fetchFromUrl(config.url);
      } else {
        // Local file path
        content = await this.fetchFromLocal(config.url);
      }

      const document: FetchedDocument = {
        title: config.title,
        content,
        url: config.url,
        format: this.inferFormat(config.url),
        fetchedAt: new Date(),
        embeddingConfig: config.embeddingConfig,
      };

      this.documentCache.set(cacheKey, document);

      // Auto-create Document entity from fetched content
      await this.createDocumentEntity(document);

      return document;
    } catch (error) {
      logger.error('Failed to fetch document', {
        title: config.title,
        url: config.url,
        error,
      });
      return null;
    }
  }

  async fetchDocumentByTitle(title: string): Promise<FetchedDocument | null> {
    // First check if we have it in cache
    // Note: TtlCache doesn't have a way to search by prefix, so we'll fetch directly

    try {
      // Try to find in loaded config
      const doc = this.findDocumentInConfig(title);
      if (doc) {
        return this.fetchDocument(doc);
      }

      logger.warn('Document not found in config', { title });
      return null;
    } catch (error) {
      logger.error('Failed to fetch document by title', { title, error });
      return null;
    }
  }

  private findDocumentInConfig(title: string): DocumentConfig | null {
    // This method should be called during config loading
    // The documents are stored when the config is parsed
    const docs = getConfiguredDocuments();
    return docs.find(d => d.title === title) || null;
  }

  private async fetchFromS3(config: DocumentConfig): Promise<string> {
    const s3Config = this.parseS3Url(config.url, config.retrievalConfig);
    const client = await this.getOrCreateS3Client(s3Config);

    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: s3Config.bucket,
          Key: s3Config.key,
        })
      );

      if (!response.Body) {
        throw new Error('S3 object has no body');
      }

      const body = response.Body as any;

      if (body.transformToString) {
        return await body.transformToString('utf-8');
      }

      if (body.transformToByteArray) {
        const bytes = await body.transformToByteArray();
        return Buffer.from(bytes).toString('utf-8');
      }

      // Fallback for streams
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf-8');
    } catch (error) {
      logger.error('S3 fetch failed', { url: config.url, error });
      throw new Error(`Failed to fetch from S3: ${error}`);
    }
  }

  private async fetchFromUrl(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const body = await response.arrayBuffer();
      const maxSize = 50 * 1024 * 1024;
      if (body.byteLength > maxSize) {
        throw new Error(`Response too large: ${body.byteLength} bytes`);
      }

      return Buffer.from(body).toString('utf-8');
    } catch (error) {
      logger.error('URL fetch failed', { url, error });
      throw new Error(`Failed to fetch from URL: ${error}`);
    }
  }

  private async fetchFromLocal(filePath: string): Promise<string> {
    try {
      const resolvedPath = path.resolve(filePath);
      const content = await readFile(resolvedPath, 'utf-8');
      return content;
    } catch (error) {
      logger.error('Local file read failed', { path: filePath, error });
      throw new Error(`Failed to read local file: ${error}`);
    }
  }

  private parseS3Url(
    url: string,
    retrievalConfig?: RetrievalConfig
  ): {
    bucket: string;
    key: string;
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
  } {
    // Parse s3://bucket/key format
    if (!url.startsWith('s3://')) {
      throw new Error('Invalid S3 URL format. Expected: s3://bucket/key');
    }

    const withoutProtocol = url.slice(5);
    const firstSlash = withoutProtocol.indexOf('/');

    if (firstSlash === -1) {
      throw new Error('Invalid S3 URL format. Expected: s3://bucket/key');
    }

    const bucket = withoutProtocol.slice(0, firstSlash);
    const key = withoutProtocol.slice(firstSlash + 1);

    // Get S3-specific config from retrievalConfig if provider is s3
    let s3SpecificConfig: S3Config = {};
    if (retrievalConfig?.provider === 's3' && retrievalConfig.config) {
      s3SpecificConfig = retrievalConfig.config as S3Config;
    }

    return {
      bucket,
      key,
      region: s3SpecificConfig.region || process.env.AWS_REGION || 'us-east-1',
      endpoint: s3SpecificConfig.endpoint,
      accessKeyId: s3SpecificConfig.accessKeyId || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: s3SpecificConfig.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
      forcePathStyle: s3SpecificConfig.forcePathStyle,
    };
  }

  private async getOrCreateS3Client(config: {
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
  }): Promise<any> {
    const clientKey = `${config.region}:${config.endpoint || 'default'}:${config.accessKeyId || 'default'}`;

    if (!this.s3Clients.has(clientKey)) {
      const client = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        credentials:
          config.accessKeyId && config.secretAccessKey
            ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              }
            : undefined,
      });

      this.s3Clients.set(clientKey, client);
    }

    return this.s3Clients.get(clientKey)!;
  }

  private async createDocumentEntity(document: FetchedDocument): Promise<void> {
    try {
      // Build the Document entity attributes
      let docAttrs = `{title "${document.title}", content "${this.escapeContent(document.content)}"`;

      // Add embeddingConfig if present
      if (document.embeddingConfig) {
        const configStr = JSON.stringify(document.embeddingConfig).replace(/"/g, '\\"');
        docAttrs += `, embeddingConfig "${configStr}"`;
      }

      docAttrs += '}';

      // Upsert to database
      await parseAndEvaluateStatement(`{${CoreAIModuleName}/Document ${docAttrs}, @upsert}`);

      logger.debug('Created Document entity', {
        title: document.title,
        url: document.url,
        hasEmbeddingConfig: !!document.embeddingConfig,
      });
    } catch (error) {
      logger.error('Failed to create Document entity', {
        title: document.title,
        error,
      });
    }
  }

  private escapeContent(content: string): string {
    return content
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  private inferFormat(url: string): string {
    const parts = url.split('.');
    if (parts.length > 1) {
      return parts[parts.length - 1].toLowerCase();
    }
    return 'txt';
  }

  clearCache(title?: string): void {
    if (title) {
      // Note: TtlCache doesn't expose keys, clear all for now
      this.documentCache.clear();
    } else {
      this.documentCache.clear();
    }
  }
}

// Store configured documents from config.al
let configuredDocuments: DocumentConfig[] = [];

export function registerConfiguredDocument(doc: DocumentConfig): void {
  // Check if already registered
  const existing = configuredDocuments.find(d => d.title === doc.title);
  if (!existing) {
    configuredDocuments.push(doc);
    logger.debug('Registered configured document', { title: doc.title, url: doc.url });
  }
}

export function getConfiguredDocuments(): DocumentConfig[] {
  return [...configuredDocuments];
}

export function clearConfiguredDocuments(): void {
  configuredDocuments = [];
}

export const documentFetcher = new DocumentFetcherService();
export default documentFetcher;
