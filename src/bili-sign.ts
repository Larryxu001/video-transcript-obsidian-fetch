import { createHash } from 'node:crypto';

// Public WBI permutation: only the first 32 positions contribute to the signing key.
const positions = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13];
export function signPlayerQuery(query: string, image: string, sub: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const names = [image, sub].map(url => new URL(url).pathname.split('/').at(-1)!.split('.')[0]).join('');
  if (!/^[0-9a-f]{64}$/i.test(names)) throw new Error('Bilibili returned invalid subtitle signing keys.');
  const key = positions.map(index => names[index]).join('');
  const params = new URLSearchParams(query); params.set('wts', String(timestamp)); params.sort();
  const encoded = [...params].map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value.replace(/[!'()*]/g, ''))}`).join('&');
  return `${encoded}&w_rid=${createHash('md5').update(encoded + key).digest('hex')}`;
}
