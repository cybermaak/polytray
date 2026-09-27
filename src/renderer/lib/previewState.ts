import type { FileRecord } from '../../shared/types';

export type PreviewLoadState =
  | { status: 'idle' }
  | { status: 'loading'; identity: string; token: number; progress: number }
  | { status: 'ready'; identity: string; token: number }
  | { status: 'error'; identity: string; token: number; message: string };

export type PreviewLoadAction =
  | { type: 'start'; identity: string; token: number }
  | { type: 'progress'; identity: string; token: number; progress: number }
  | { type: 'ready'; identity: string; token: number }
  | { type: 'error'; identity: string; token: number; message: string }
  | { type: 'reset' };

export function createPreviewGeometryIdentity(file: Pick<FileRecord, 'id' | 'path' | 'extension' | 'content_revision'>): string {
  return JSON.stringify([file.id, file.path, file.extension.toLowerCase(), file.content_revision]);
}

export function previewStateReducer(state: PreviewLoadState, action: PreviewLoadAction): PreviewLoadState {
  if (action.type === 'reset') return { status: 'idle' };
  if (action.type === 'start') {
    return { status: 'loading', identity: action.identity, token: action.token, progress: -1 };
  }
  if (state.status !== 'loading' || state.identity !== action.identity || state.token !== action.token) return state;
  if (action.type === 'progress') return { ...state, progress: action.progress };
  if (action.type === 'ready') return { status: 'ready', identity: action.identity, token: action.token };
  return { status: 'error', identity: action.identity, token: action.token, message: action.message };
}
