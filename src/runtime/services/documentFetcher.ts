import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
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
  provider: 's3' | 'box' | 'gdrive' | 'azure' | 'onedrive' | 'document-service' | string;
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
  url?: string;
  documentServiceId?: string;
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

// Document service configuration
interface DocumentServiceConfig {
  baseUrl: string;
  appName: string;
  authToken?: string; // Static token from env
  getAuthToken?: () => Promise<string>; // Dynamic token function
}

class DocumentFetcherService {
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private documentCache = new TtlCache<FetchedDocument>(DocumentFetcherService.CACHE_TTL_MS);
  private s3Clients = new Map<string, any>();
  private pdfParser: any = null;
  private documentServiceConfig?: DocumentServiceConfig;

  // Configure document service for secure API access
  configureDocumentService(config: DocumentServiceConfig): void {
    this.documentServiceConfig = config;
    logger.info('Document service configured', { baseUrl: config.baseUrl });
  }

  async fetchDocument(config: DocumentConfig): Promise<FetchedDocument | null> {
    this.ensureNodeEnv();
    const cacheKey = `${config.title}:${config.url || config.documentServiceId}`;
    const cached = this.documentCache.get(cacheKey);

    if (cached) {
      logger.debug('Returning cached document', { title: config.title });
      return cached;
    }

    try {
      let content: string;
      let sourceUrl: string;

      // Check if URL is document-service format: document-service://<app-uuid>/<doc-uuid>.ext
      if (config.url?.startsWith('document-service://')) {
        if (!config.retrievalConfig || config.retrievalConfig.provider !== 'document-service') {
          throw new Error(
            'Document service URL requires retrievalConfig with provider: "document-service"'
          );
        }

        // Parse document-service config from retrievalConfig
        const dsConfig = config.retrievalConfig.config as DocumentServiceConfig;
        if (!dsConfig?.baseUrl) {
          throw new Error('Document service config requires baseUrl');
        }

        // Parse URL to extract app UUID and document ID
        // Format: document-service://<app-uuid>/<doc-uuid>.ext
        const urlPath = config.url.replace('document-service://', '');
        const parts = urlPath.split('/');
        if (parts.length !== 2) {
          throw new Error(
            `Invalid document service URL format: ${config.url}. Expected: document-service://<app-uuid>/<doc-uuid>.ext`
          );
        }

        const appUuid = parts[0];
        const docIdWithExt = parts[1];
        const docId = docIdWithExt.split('.')[0]; // Remove extension

        // Use config from retrievalConfig
        this.documentServiceConfig = {
          baseUrl: dsConfig.baseUrl,
          appName: appUuid, // Use app UUID as app name for API calls
          authToken: dsConfig.authToken,
          getAuthToken: dsConfig.getAuthToken,
        };

        // Fetch directly by ID
        content = await this.fetchFromDocumentService(docId);
        sourceUrl = config.url;
      } else if (config.retrievalConfig?.provider === 'document-service') {
        // Parse document-service config from retrievalConfig (lookup by title)
        const dsConfig = config.retrievalConfig.config as DocumentServiceConfig;
        if (!dsConfig?.baseUrl || !dsConfig?.appName) {
          throw new Error('Document service config requires baseUrl and appName');
        }

        // Use config from retrievalConfig
        this.documentServiceConfig = {
          baseUrl: dsConfig.baseUrl,
          appName: dsConfig.appName,
          authToken: dsConfig.authToken,
          getAuthToken: dsConfig.getAuthToken,
        };

        // Lookup by title
        const docId = await this.lookupDocumentByTitle(config.title);
        if (docId) {
          content = await this.fetchFromDocumentService(docId);
          sourceUrl = `document-service://${docId}`;
        } else {
          throw new Error(`Document not found by title in document service: ${config.title}`);
        }
      } else if (config.documentServiceId && this.documentServiceConfig) {
        // Secure document-service API path (programmatic config)
        content = await this.fetchFromDocumentService(config.documentServiceId);
        sourceUrl = `document-service://${config.documentServiceId}`;
      } else if (config.url?.startsWith('s3://')) {
        // Direct S3 access (legacy, less secure)
        content = await this.fetchFromS3(config);
        sourceUrl = config.url;
      } else if (config.url?.startsWith('http://') || config.url?.startsWith('https://')) {
        // HTTP/HTTPS URL
        content = await this.fetchFromUrl(config.url);
        sourceUrl = config.url;
      } else if (config.url) {
        // Local file path
        content = await this.fetchFromLocal(config.url);
        sourceUrl = config.url;
      } else {
        // Try to lookup by title in document service
        if (this.documentServiceConfig) {
          const docId = await this.lookupDocumentByTitle(config.title);
          if (docId) {
            content = await this.fetchFromDocumentService(docId);
            sourceUrl = `document-service://${docId}`;
          } else {
            throw new Error(`Document not found by title: ${config.title}`);
          }
        } else {
          throw new Error(`No URL or document service ID provided for: ${config.title}`);
        }
      }

      const document: FetchedDocument = {
        title: config.title,
        content,
        url: sourceUrl,
        format: this.inferFormat(sourceUrl),
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
        documentServiceId: config.documentServiceId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  async fetchDocumentByTitle(title: string): Promise<FetchedDocument | null> {
    this.ensureNodeEnv();

    try {
      // First check if we have it in cache
      const cacheKey = `${title}:lookup`;
      const cached = this.documentCache.get(cacheKey);
      if (cached) {
        logger.debug('Returning cached document by title', { title });
        return cached;
      }

      // Try document service lookup first (if configured)
      if (this.documentServiceConfig) {
        const docId = await this.lookupDocumentByTitle(title);
        if (docId) {
          return this.fetchDocument({
            title,
            documentServiceId: docId,
          });
        }
      }

      // Fall back to config-based lookup
      const doc = this.findDocumentInConfig(title);
      if (doc) {
        return this.fetchDocument(doc);
      }

      logger.warn('Document not found', { title });
      return null;
    } catch (error) {
      logger.error('Failed to fetch document by title', { title, error });
      return null;
    }
  }

  // Fetch from secure document-service API
  private async fetchFromDocumentService(documentId: string): Promise<string> {
    if (!this.documentServiceConfig) {
      throw new Error('Document service not configured');
    }

    try {
      // Get token - either static from config or dynamic from function
      let token: string;
      if (this.documentServiceConfig.authToken) {
        token = this.documentServiceConfig.authToken;
      } else if (this.documentServiceConfig.getAuthToken) {
        token = await this.documentServiceConfig.getAuthToken();
      } else {
        throw new Error('Document service requires authToken or getAuthToken');
      }

      const url = `${this.documentServiceConfig.baseUrl}/api/documents/${documentId}/content`;

      logger.debug('Fetching from document service', { documentId, url });

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-app-name': this.documentServiceConfig.appName,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Document not found: ${documentId}`);
        } else if (response.status === 403) {
          throw new Error(`Access denied to document: ${documentId}`);
        } else {
          throw new Error(`Document service error: ${response.status} ${response.statusText}`);
        }
      }

      const data = await response.json();

      if (data.isBase64) {
        // For binary files (PDFs), we need to handle them specially
        // For now, return an error message indicating PDF support needs implementation
        if (data.mimeType?.includes('pdf')) {
          throw new Error(
            'PDF documents from document service require content extraction. ' +
              'Please use the direct S3 URL with retrievalConfig for PDFs, ' +
              'or implement PDF text extraction in document service.'
          );
        }
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

      return data.content;
    } catch (error) {
      logger.error('Document service fetch failed', {
        documentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // Lookup document ID by title in document service
  private async lookupDocumentByTitle(title: string): Promise<string | null> {
    if (!this.documentServiceConfig) {
      return null;
    }

    try {
      // Get token - either static from config or dynamic from function
      let token: string;
      if (this.documentServiceConfig.authToken) {
        token = this.documentServiceConfig.authToken;
      } else if (this.documentServiceConfig.getAuthToken) {
        token = await this.documentServiceConfig.getAuthToken();
      } else {
        throw new Error('Document service requires authToken or getAuthToken');
      }

      const url = `${this.documentServiceConfig.baseUrl}/api/documents/lookup/by-title?title=${encodeURIComponent(title)}`;

      logger.debug('Looking up document by title', { title, url });

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-app-name': this.documentServiceConfig.appName,
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        logger.debug('Document not found by title', { title });
        return null;
      }

      if (!response.ok) {
        throw new Error(`Document service lookup error: ${response.status}`);
      }

      const data = await response.json();
      logger.debug('Found document by title', { title, documentId: data.documentId });
      return data.documentId;
    } catch (error) {
      logger.error('Document lookup failed', {
        title,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async fetchFromS3(config: DocumentConfig): Promise<string> {
    const s3Config = this.parseS3Url(config.url!, config.retrievalConfig);
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
        lowerUrl.endsWith('.markdown');

      if (isMarkdown) {
        return this.parseMarkdownText(Buffer.from(body).toString('utf-8'));
      }

      return Buffer.from(body).toString('utf-8');
    } catch (error) {
      logger.error('URL fetch failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async fetchFromLocal(filePath: string): Promise<string> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const lowerPath = filePath.toLowerCase();
      const isMarkdown = lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown');

      if (isMarkdown) {
        return this.parseMarkdownText(content);
      }

      return content;
    } catch (error) {
      logger.error('Local file read failed', {
        path: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
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
    const withoutProtocol = url.replace('s3://', '');
    const firstSlash = withoutProtocol.indexOf('/');

    if (firstSlash === -1) {
      throw new Error(`Invalid S3 URL format: ${url}`);
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

  private normalizeRetrievalConfig(config?: RetrievalConfig): RetrievalConfig | undefined {
    if (!config) {
      return undefined;
    }

    // Handle nested config structure from Agentlang
    const normalizedConfig = preprocessRawConfig(config) as RetrievalConfig;

    return normalizedConfig;
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

  private async parsePdfBuffer(buffer: Buffer): Promise<string> {
    // Lazy load PDF parser
    if (!this.pdfParser) {
      try {
        const pdfParse = await import('pdf-parse');
        // Handle both ESM and CSM module formats
        const parser = (pdfParse as any).default || pdfParse;
        this.pdfParser = parser;
      } catch (error) {
        logger.error('Failed to load PDF parser', { error });
        throw new Error(
          'PDF parsing not available. Please install pdf-parse: npm install pdf-parse'
        );
      }
    }

    try {
      const result = await this.pdfParser(buffer);
      return result.text || '';
    } catch (error) {
      logger.error('PDF parsing failed', { error });
      throw new Error(`Failed to parse PDF: ${error}`);
    }
  }

  private parseMarkdownText(text: string): string {
    // Convert markdown to plain text for embedding
    // This removes formatting but preserves content structure
    try {
      const html = marked.parse(text) as string;
      // Simple HTML to text conversion
      return html
        .replace(/<[^>]+>/g, ' ') // Remove HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .trim();
    } catch (error) {
      logger.warn('Markdown parsing failed, returning raw text', { error });
      return text;
    }
  }

  private async readS3BodyToBuffer(body: any): Promise<Buffer> {
    if (body.transformToByteArray) {
      const data = await body.transformToByteArray();
      return Buffer.from(data);
    }

    // Fallback for Readable streams
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
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
    // Handle document-service URLs
    if (url.startsWith('document-service://')) {
      return 'txt';
    }
    const parts = url.split('.');
    if (parts.length > 1) {
      return parts[parts.length - 1].toLowerCase();
    }
    return 'txt';
  }

  private findDocumentInConfig(title: string): DocumentConfig | null {
    // This method should be called during config loading
    // The documents are stored when the config is parsed
    const docs = getConfiguredDocuments();
    return docs.find(d => d.title === title) || null;
  }

  private ensureNodeEnv(): void {
    if (!isNodeEnv) {
      throw new Error('Document fetching is only available in Node.js environment');
    }
  }

  clearCache(): void {
    // Clear all cache
    this.documentCache.clear();
  }
}

// Singleton instance
const documentFetcher = new DocumentFetcherService();

// Helper function to get configured documents from module config
function getConfiguredDocuments(): DocumentConfig[] {
  // This should be populated during config parsing
  // For now, return empty array - actual implementation depends on how
  // the config system stores document definitions
  return (global as any).__configuredDocuments || [];
}

// Export for use in config loading
export function setConfiguredDocuments(docs: DocumentConfig[]): void {
  (global as any).__configuredDocuments = docs;
}

export { documentFetcher };
export default documentFetcher;
