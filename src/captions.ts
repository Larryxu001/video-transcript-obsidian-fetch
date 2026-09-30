import type { Segment } from './model.ts';
import { object, objects, text } from './http.ts';

export class CaptionUnavailable extends Error {}

function seconds(value: string | null): number {
  if (!value) return 0;
  if (value.endsWith('ms')) return Number(value.slice(0, -2)) / 1000;
  if (value.includes(':')) return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return Number(value.replace(/s$/, ''));
}

export function parseCaptions(payload: string, youtube: boolean): Segment[] {
  let result: Segment[] = [];
  if (payload.trim().startsWith('{')) {
    const data = object(JSON.parse(payload));
    result = youtube ? objects(data.events).filter(e => Array.isArray(e.segs)).map(e => ({
      start: Number(e.tStartMs || 0) / 1000,
      end: (Number(e.tStartMs || 0) + Number(e.dDurationMs || 0)) / 1000,
      text: objects(e.segs).map(s => text(s.utf8)).join(''),
    })) : objects(data.body).map(e => ({ start: Number(e.from), end: Number(e.to), text: text(e.content) }));
  } else if (youtube && payload.trim().startsWith('<')) {
    const doc = new DOMParser().parseFromString(payload, 'application/xml');
    if (doc.querySelector('parsererror') || !['transcript', 'timedtext', 'tt'].includes(doc.documentElement.localName)) return [];
    // srv3 uses milliseconds; classic timedtext and TTML use explicit seconds/clock values.
    result = [...doc.querySelectorAll('text, p')].map(e => {
      const milliseconds = e.hasAttribute('t');
      const start = milliseconds ? Number(e.getAttribute('t')) / 1000 : seconds(e.getAttribute('start') || e.getAttribute('begin'));
      const duration = milliseconds ? Number(e.getAttribute('d') || 0) / 1000 : seconds(e.getAttribute('dur'));
      const end = e.hasAttribute('end') ? seconds(e.getAttribute('end')) : start + duration;
      for (const br of e.querySelectorAll('br')) br.replaceWith('\n');
      return { start, end, text: e.textContent || '' };
    });
  }
  return result.filter(s => s.text.trim() && Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end >= s.start).sort((a, b) => a.start - b.start);
}
