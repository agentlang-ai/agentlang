import { logger } from './logger.js';
import { isNodeEnv } from '../utils/runtime.js';
import { getFileSystem } from '../utils/fs-utils.js';

const DocFetchers = new Map<string, Function>();

export function registerDocFetcher(scheme: string, fetcher: Function): string {
  DocFetchers.set(scheme, fetcher);
  return scheme;
}

function getDocFetcher(scheme: string): Function | undefined {
  const f = DocFetchers.get(scheme);
  if (f) {
    return f;
  }
  logger.warn(`No fetcher for ${scheme}`);
  return undefined;
}

export async function fetchDoc(url: string): Promise<string | undefined> {
  const idx = url.indexOf(':/');
  const scheme = idx <= 0 ? 'file' : url.substring(0, idx);
  const f = getDocFetcher(scheme);
  if (f) return await f(url);
  else return undefined;
}

let PDFParse: any = null;
let pdfWorkerSet = false;

async function getPDFParse() {
  if (!PDFParse) {
    const pdfModule = await import('pdf-parse');
    PDFParse = pdfModule.PDFParse;

    // Set up web worker for browser
    if (!isNodeEnv && !pdfWorkerSet && PDFParse.setWorker) {
      // Worker is served from public/ directory
      PDFParse.setWorker('/pdf.worker.mjs');
      pdfWorkerSet = true;
    }
  }
  return PDFParse;
}

async function parsePdfBuffer(buffer: Uint8Array): Promise<string> {
  try {
    const PDFParseClass = await getPDFParse();
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

async function httpFetcher(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      method: 'GET',
    });

    if (!response.ok) {
      logger.error(`Failed to fetch document ${url}, HTTP error! status: ${response.status}`);
      return undefined;
    }

    const contentType = response.headers.get('content-type') || '';
    const content = await response.arrayBuffer();

    const lowerUrl = url.toLowerCase();

    // Process based on content type or file extension
    if (contentType.includes('application/pdf') || lowerUrl.endsWith('.pdf')) {
      return await parsePdfBuffer(new Uint8Array(content));
    } else if (contentType.includes('text/markdown') || lowerUrl.endsWith('.md')) {
      return new TextDecoder().decode(content);
    } else {
      // Default to text
      return new TextDecoder().decode(content);
    }
  } catch (reason: any) {
    logger.error(`Failed to fetch document ${url}: ${reason}`);
  }
  return undefined;
}

async function fetchFile(path: string): Promise<string> {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith('.pdf')) {
    return await fetchPdfFile(path);
  } else if (
    lowerPath.endsWith('.md') ||
    lowerPath.endsWith('.markdown') ||
    lowerPath.endsWith('.mdown')
  ) {
    return await fetchMarkdownFile(path);
  } else {
    // Default: plain text
    return await fetchTextFile(path);
  }
}

async function fetchPdfFile(path: string): Promise<string> {
  try {
    const fs = await getFileSystem();

    if (isNodeEnv && path.startsWith('.')) {
      path = `${process.cwd()}${path.substring(1)}`;
    }

    const content = await fs.readFile(path);

    let buffer: Uint8Array;
    if (typeof content === 'string') {
      buffer = new TextEncoder().encode(content);
    } else if (Buffer.isBuffer(content)) {
      buffer = new Uint8Array(content);
    } else {
      buffer = new Uint8Array(Buffer.from(content));
    }

    return await parsePdfBuffer(buffer);
  } catch (error: any) {
    logger.error(`Failed to read PDF file ${path}: ${error.message}`);
    throw error;
  }
}

async function fetchMarkdownFile(path: string): Promise<string> {
  try {
    const fs = await getFileSystem();

    if (isNodeEnv && path.startsWith('.')) {
      path = `${process.cwd()}${path.substring(1)}`;
    }

    return await fs.readFile(path);
  } catch (error: any) {
    logger.error(`Failed to read Markdown file ${path}: ${error.message}`);
    throw error;
  }
}

async function fetchTextFile(path: string): Promise<string> {
  try {
    const fs = await getFileSystem();

    if (isNodeEnv && path.startsWith('.')) {
      path = `${process.cwd()}${path.substring(1)}`;
    }

    return await fs.readFile(path);
  } catch (error: any) {
    logger.error(`Failed to read text file ${path}: ${error.message}`);
    throw error;
  }
}

registerDocFetcher('http', httpFetcher);
registerDocFetcher('https', httpFetcher);
registerDocFetcher('file', fetchFile);
