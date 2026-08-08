'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircleIcon, InfoIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, title: string, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const KIND_STYLE: Record<ToastKind, { icon: typeof CheckCircleIcon; color: string }> = {
  success: { icon: CheckCircleIcon, color: 'text-ok-400' },
  error: { icon: WarningCircleIcon, color: 'text-danger-400' },
  info: { icon: InfoIcon, color: 'text-bridge-400' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      const id = nextId.current++;
      const toast: Toast = {
        id,
        kind,
        title,
        ...(detail !== undefined ? { detail } : {}),
      };
      setToasts((list) => [...list.slice(-3), toast]);
      window.setTimeout(() => {
        dismiss(id);
      }, 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const meta = KIND_STYLE[toast.kind];
          const Icon = meta.icon;
          return (
            <div
              key={toast.id}
              className="panel rise-in pointer-events-auto flex items-start gap-3 p-3.5"
            >
              <Icon size={18} weight="fill" className={`mt-0.5 shrink-0 ${meta.color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white">{toast.title}</p>
                {toast.detail && (
                  <p className="mt-0.5 break-words font-mono text-[11.5px] leading-relaxed text-mist-400">
                    {toast.detail}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                className="shrink-0 rounded-md p-1 text-mist-500 transition hover:bg-white/[0.06] hover:text-white"
                onClick={() => {
                  dismiss(toast.id);
                }}
              >
                <XIcon size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToasts must be used within ToastProvider');
  return ctx;
}
