// Auth store
import { create } from 'zustand';
import { api, getToken, setToken } from '../services/api';

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
    try { await api.post('/api/auth/logout'); } catch {}
    setToken(null);
    set({ user: null });
  },
}));