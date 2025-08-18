import { readFile } from '../utils/fs-utils.js';
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
  if (idx <= 0) {
    throw new Error(`invalid url: ${url}`);
  }
  const scheme = url.substring(0, idx);
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

registerDocFetcher('http', httpFetcher);
registerDocFetcher('https', httpFetcher);
registerDocFetcher('file', readFile);
