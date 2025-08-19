import { getFileSystem } from '../utils/fs-utils.js';
import { logger } from './logger.js';

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

async function httpFetcher(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      method: 'GET',
    });

    if (!response.ok) {
      logger.error(
        `Failed to fetch document ${url}, HTTP error! status: ${response.status} ${response.text} ${response.statusText}`
      );
      return undefined;
    }
    return await response.text();
  } catch (reason: any) {
    logger.error(`Failed to fetch document ${url}: ${reason}`);
  }
  return undefined;
}

async function fetchFile(path: string): Promise<string> {
  const fs = await getFileSystem();
  if (path.startsWith('.')) {
    path = `${process.cwd()}${path.substring(1)}`;
  }
  return fs.readFile(path);
}

registerDocFetcher('http', httpFetcher);
registerDocFetcher('https', httpFetcher);
registerDocFetcher('file', fetchFile);
