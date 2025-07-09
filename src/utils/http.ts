import { Buffer } from 'buffer';

export function encodeForBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`).toString('base64');
}
