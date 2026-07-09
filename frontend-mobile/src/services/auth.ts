import { create } from 'zustand';
import { isUiPreview } from '../lib/env';
import { PREVIEW_USER } from '../mocks/previewData';
import { api, getToken, setToken } from './api';

interface User { id: number; username: string; role: string }

interface AuthState {
  user: User | null;
  loading: boolean;
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  init: async () => {
    if (isUiPreview) {
      setToken('preview-mock-token');
      set({ user: PREVIEW_USER, loading: false });
      return;
    }
    const token = getToken();
    if (!token) { set({ loading: false, user: null }); return; }
    try {
      const me = await api.get<User>('/api/auth/me');
      set({ user: me, loading: false });
    } catch {
      setToken(null);
      set({ user: null, loading: false });
    }
  },
  login: async (username, password) => {
    if (isUiPreview) {
      setToken('preview-mock-token');
      set({ user: PREVIEW_USER });
      return true;
    }
    try {
      const r = await api.post<{ token: string; user: User }>('/api/auth/login', { username, password });
      setToken(r.token);
      set({ user: r.user });
      return true;
    } catch {
      return false;
    }
  },
  logout: async () => {
    try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
    setToken(null);
    set({ user: null });
  },
}));