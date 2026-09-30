import type { Track } from './model.ts';
import { checkedUrl } from './http.ts';

// The web subtitle endpoint wraps its data in field 1; data field 3 repeats tracks.
// Read only length-delimited fields, skipping unknown scalar fields for compatibility.
function messages(bytes: Uint8Array, wanted: number): Uint8Array[] {
  let offset = 0;
  const result: Uint8Array[] = [];
  function integer(): bigint {
    let value = 0n;
    for (let shift = 0n; shift < 70n && offset < bytes.length; shift += 7n) {
      const byte = bytes[offset++]; value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return value;
    }
    throw new Error('Invalid subtitle metadata integer.');
  }
  while (offset < bytes.length) {
    const tag = Number(integer()), field = tag >>> 3, wire = tag & 7;
    if (!field) throw new Error('Invalid subtitle metadata field.');
    if (wire === 0) integer();
    else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else if (wire === 2) {
      const size = Number(integer());
      if (!Number.isSafeInteger(size) || size > bytes.length - offset) throw new Error('Incomplete subtitle metadata.');
      if (field === wanted) result.push(bytes.subarray(offset, offset + size));
      offset += size;
    } else throw new Error('Unsupported subtitle metadata field.');
    if (offset > bytes.length) throw new Error('Incomplete subtitle metadata.');
  }
  return result;
}
export function webSubtitleTracks(bytes: ArrayBuffer): Track[] {
  const decoder = new TextDecoder();
  const tracks: Track[] = [];
  for (const data of messages(new Uint8Array(bytes), 1)) {
    for (const entry of messages(data, 3)) {
      const read = (field: number) => decoder.decode(messages(entry, field)[0] || new Uint8Array());
      const language = read(3), name = read(4), address = read(5);
      if (language && address) tracks.push({ language, name: name || language, url: checkedUrl(address, ['hdslb.com', 'bilibili.com']) });
    }
  }
  return tracks;
}
