import { preferences } from './model.ts';
import type { Preferences } from './model.ts';
import type { ImportOptions } from './ui.ts';
export interface PendingWrite { key: string; path: string; content: string; before?: string }
export interface ImportProgress {
  options: ImportOptions; index: number; completed: string[]; fallback: string; targetPath?: string;
  settings: Preferences; write?: PendingWrite; retryAt?: number;
}
export function restoreProgress(value: unknown): ImportProgress | undefined {
  if (!value || typeof value !== 'object') return;
  const p = value as ImportProgress;
  if (!p.options || !Array.isArray(p.options.urls) || !p.options.urls.length || p.options.urls.length > 100 || !p.options.urls.every(url => typeof url === 'string') || !Number.isInteger(p.index) || p.index < 0 || p.index > p.options.urls.length || !Array.isArray(p.completed) || !p.completed.every(key => typeof key === 'string') || typeof p.fallback !== 'string') return;
  if (p.write && (typeof p.write.key !== 'string' || typeof p.write.path !== 'string' || typeof p.write.content !== 'string' || (p.write.before !== undefined && typeof p.write.before !== 'string'))) return;
  return { ...p, settings: preferences(p.settings) };
}
export function publicSettings(settings: Preferences): Preferences {
  return { ...structuredClone(settings), cookie: '', groqKey: '', openaiKey: '', accountName: '', accountId: '' };
}
