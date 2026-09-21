import React, { createContext, useContext, useEffect, useState } from 'react';
import { LogIn, ShieldAlert, ShieldCheck } from 'lucide-react';

export type PermissionModule = 'dashboard' | 'reports' | 'projects' | 'alerts' | 'lists' | 'drive_links';
export type PermissionLevel = 'none' | 'view' | 'edit';

interface AuthUser {
  email: string;
  name: string | null;
  isAdmin: boolean;
  permissions: Partial<Record<PermissionModule, PermissionLevel>>;
}

interface AuthContextValue {
  user: AuthUser;
  logout: () => Promise<void>;
  canView: (module: PermissionModule) => boolean;
  canEdit: (module: PermissionModule) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return ctx;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<'loading' | 'anonymous' | 'authenticated'>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [wasUnauthorized, setWasUnauthorized] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (new URLSearchParams(window.location.search).get('login') === 'unauthorized') {
        setWasUnauthorized(true);
        window.history.replaceState({}, '', window.location.pathname);
      }
      try {
        const response = await fetch('/api/auth/google/app-status');
        const payload = await response.json();
        if (payload.data) {
          setUser(payload.data);
          setStatus('authenticated');
        } else {
          setStatus('anonymous');
        }
      } catch {
        setStatus('anonymous');
      }
    };
    void init();
  }, []);

  const logout = async () => {
    await fetch('/api/auth/google/app-logout', { method: 'POST' });
    setUser(null);
    setStatus('anonymous');
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
      </div>
    );
  }

  if (status === 'anonymous' || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-700">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Seguimiento de Informes</h1>
          <p className="mt-1.5 text-xs text-slate-500">
            Inicia sesión con una cuenta de Google autorizada para continuar.
          </p>
          {wasUnauthorized && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-left text-xs text-rose-700">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Esa cuenta de Google no está autorizada para usar esta aplicación. Contacta al administrador.</span>
            </div>
          )}
          <a
            href="/api/auth/google/app-login-start"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-teal-800"
          >
            <LogIn className="h-3.5 w-3.5" />
            Iniciar sesión con Google
          </a>
        </div>
      </div>
    );
  }

  const levelOf = (module: PermissionModule): PermissionLevel => {
    if (user.isAdmin) return 'edit';
    return user.permissions[module] ?? 'edit';
  };
  const canView = (module: PermissionModule) => levelOf(module) !== 'none';
  const canEdit = (module: PermissionModule) => levelOf(module) === 'edit';

  return <AuthContext.Provider value={{ user, logout, canView, canEdit }}>{children}</AuthContext.Provider>;
};
