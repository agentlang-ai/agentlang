import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.js';
import { parseAndEvaluateStatement } from '../interpreter.js';
import { CoreAIModuleName } from '../modules/ai.js';
import { TtlCache } from '../state.js';
import { preprocessRawConfig } from '../util.js';
import { marked } from 'marked';
import { isNodeEnv } from '../../utils/runtime.js';

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
  private pdfParser: any = null;

  async fetchDocument(config: DocumentConfig): Promise<FetchedDocument | null> {
    this.ensureNodeEnv();
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
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Re-throw the error so the caller knows what happened
      throw error;
    }
  }

  async fetchDocumentByTitle(title: string): Promise<FetchedDocument | null> {
    this.ensureNodeEnv();
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
      const bodyBuffer = await this.readS3BodyToBuffer(response.Body as any);
      const contentType = (response.ContentType || '').toLowerCase();
      const lowerKey = s3Config.key.toLowerCase();
      const isPdf = contentType.includes('application/pdf') || lowerKey.endsWith('.pdf');
      const isMarkdown =
        contentType.includes('text/markdown') ||
        lowerKey.endsWith('.md') ||
        lowerKey.endsWith('.markdown') ||
        lowerKey.endsWith('.mdown');
      if (isPdf) {
        return await this.parsePdfBuffer(bodyBuffer);
      }
      if (isMarkdown) {
        return this.parseMarkdownText(bodyBuffer.toString('utf-8'));
      }
      return bodyBuffer.toString('utf-8');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('S3 fetch failed', {
        url: config.url,
        bucket: s3Config.bucket,
        key: s3Config.key,
        region: s3Config.region,
        hasAccessKey: !!s3Config.accessKeyId,
        error: errorMessage,
        stack: errorStack,
      });
      throw new Error(
        `Failed to fetch from S3 (bucket: ${s3Config.bucket}, key: ${s3Config.key}, region: ${s3Config.region}): ${errorMessage}`
      );
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

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const lowerUrl = url.toLowerCase();
      const isMarkdown =
        contentType.includes('text/markdown') ||
        lowerUrl.endsWith('.md') ||
        lowerUrl.endsWith('.markdown') ||
        lowerUrl.endsWith('.mdown');
      const text = Buffer.from(body).toString('utf-8');
      return isMarkdown ? this.parseMarkdownText(text) : text;
    } catch (error) {
      logger.error('URL fetch failed', { url, error });
      throw new Error(`Failed to fetch from URL: ${error}`);
    }
  }

  private async fetchFromLocal(filePath: string): Promise<string> {
    try {
      const resolvedPath = path.resolve(filePath);
      const content = await readFile(resolvedPath, 'utf-8');
      const lowerPath = resolvedPath.toLowerCase();
      const isMarkdown =
        lowerPath.endsWith('.md') ||
        lowerPath.endsWith('.markdown') ||
        lowerPath.endsWith('.mdown');
      return isMarkdown ? this.parseMarkdownText(content) : content;
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

    const normalizedRetrievalConfig = this.normalizeRetrievalConfig(retrievalConfig);

    // Get S3-specific config from retrievalConfig if provider is s3
    let s3SpecificConfig: S3Config = {};
    if (normalizedRetrievalConfig?.provider === 's3' && normalizedRetrievalConfig.config) {
      s3SpecificConfig = normalizedRetrievalConfig.config as S3Config;
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

  private normalizeConfigValue(value: any): any {
    if (value instanceof Map) {
      const obj: Record<string, any> = {};
      value.forEach((v, k) => {
        obj[k] = this.normalizeConfigValue(v);
      });
      return obj;
    }
    if (Array.isArray(value)) {
      return value.map(v => this.normalizeConfigValue(v));
    }
    if (value && typeof value === 'object') {
      const obj: Record<string, any> = {};
      Object.entries(value).forEach(([k, v]) => {
        obj[k] = this.normalizeConfigValue(v);
      });
      return obj;
    }
    return value;
  }

  private normalizeRetrievalConfig(retrievalConfig?: RetrievalConfig): RetrievalConfig | undefined {
    if (!retrievalConfig) return undefined;
    const normalized = this.normalizeConfigValue(retrievalConfig);
    if (normalized && typeof normalized === 'object') {
      preprocessRawConfig(normalized);
    }
    return normalized as RetrievalConfig;
  }

  private ensureNodeEnv(): void {
    if (!isNodeEnv) {
      throw new Error('Document fetching is only available in Node.js environment');
    }
  }

  private async readS3BodyToBuffer(body: any): Promise<Buffer> {
    if (body.transformToByteArray) {
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    }
    if (body.transformToString) {
      const text = await body.transformToString('utf-8');
      return Buffer.from(text, 'utf-8');
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async getPdfParser(): Promise<any> {
    if (!this.pdfParser) {
      const pdfModule: any = await import('pdf-parse');
      this.pdfParser = pdfModule.PDFParse || pdfModule.default;
    }
    return this.pdfParser;
  }

  private async parsePdfBuffer(buffer: Buffer): Promise<string> {
    try {
      const PDFParseClass = await this.getPdfParser();
      const parser = new PDFParseClass({
        data: buffer,
        verbosity: 0,
      });
      const data = await parser.getText();
      return data.text;
    } catch (error: any) {
      logger.error(`Failed to parse PDF: ${error.message}`);
      throw new Error(`PDF parsing failed: ${error.message}`);
    }
  }

  private parseMarkdownText(markdown: string): string {
    const html = marked.parse(markdown);
    if (typeof html !== 'string') {
      return markdown;
    }
    return html
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|h[1-6]|blockquote|pre|tr|table)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
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
