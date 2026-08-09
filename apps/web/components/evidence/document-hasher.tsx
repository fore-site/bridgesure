'use client';

import { useCallback, useRef, useState } from 'react';
import {
  CheckCircleIcon,
  FileArrowUpIcon,
  FingerprintIcon,
  HashIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { CopyButton } from '@/components/ui';

/** Read the file bytes and return a 0x-prefixed SHA-256 digest. */
async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = [...new Uint8Array(digest)];
  return `0x${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

/**
 * ui.md "Client-side Document Cryptographic Hasher": the browser hashes the
 * document locally (SHA-256) and never uploads the file itself — only the
 * digest is anchored as evidence. With a `referenceDigest` the widget also
 * verifies a document against a signed digest (e.g. the authorization's
 * evidence digest from the release path).
 */
export function DocumentHasher({
  referenceDigest,
  onDigest,
  compact = false,
}: {
  referenceDigest?: string | null;
  onDigest?: (digest: string, fileName: string) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const match =
    referenceDigest && digest ? referenceDigest.toLowerCase() === digest.toLowerCase() : null;

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setHashing(true);
      try {
        const hex = await sha256Hex(file);
        setFileName(file.name);
        setSize(file.size);
        setDigest(hex);
        onDigest?.(hex, file.name);
      } catch {
        setError('Could not hash this file in the browser.');
      } finally {
        setHashing(false);
      }
    },
    [onDigest],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Hash a document"
      className={`rounded-xl border border-dashed transition ${
        dragging
          ? 'border-bridge-400/60 bg-bridge-500/[0.07]'
          : digest
            ? 'border-ok-400/25 bg-ok-500/[0.04]'
            : 'border-white/[0.1] bg-ink-900/50 hover:border-white/[0.18] hover:bg-ink-900/80'
      } ${compact ? 'p-4' : 'p-5'}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void handleFile(file);
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {!digest ? (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bridge-500/15 text-bridge-400">
            {hashing ? (
              <span className="spinner inline-block h-4 w-4 rounded-full" aria-hidden="true" />
            ) : (
              <FileArrowUpIcon size={17} weight="duotone" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-white">
              {hashing ? 'Hashing in your browser…' : 'Drop a document to hash it'}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-mist-500">
              SHA-256 computed locally — the file itself never leaves this device; only the digest
              is anchored.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ok-500/15 text-ok-400">
              <FingerprintIcon size={17} weight="duotone" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">{fileName}</p>
              <p className="mt-0.5 font-mono text-[11px] text-mist-500">
                {size !== null ? formatBytes(size) : ''} · hashed in-browser
              </p>
            </div>
            <button
              type="button"
              className="text-[11.5px] text-mist-500 underline-offset-2 transition hover:text-mist-300 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setFileName(null);
                setSize(null);
                setDigest(null);
                onDigest?.('', '');
              }}
            >
              Clear
            </button>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-ink-900/80 px-3 py-2">
            <HashIcon size={13} className="shrink-0 text-bridge-400" weight="duotone" />
            <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] leading-relaxed text-bridge-300">
              {digest}
            </code>
            <CopyButton value={digest} label="Copy digest" />
          </div>

          {match !== null && (
            <div
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${
                match
                  ? 'border border-ok-400/25 bg-ok-500/[0.07] text-ok-300'
                  : 'border border-danger-400/25 bg-danger-500/[0.07] text-danger-300'
              }`}
            >
              {match ? (
                <CheckCircleIcon size={14} weight="fill" className="shrink-0" />
              ) : (
                <XCircleIcon size={14} weight="fill" className="shrink-0" />
              )}
              {match
                ? 'Matches the signed evidence digest — this document is the anchored evidence.'
                : 'Does not match the signed evidence digest.'}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2.5 text-[12px] text-danger-300">
          {error}{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={(e) => {
              e.stopPropagation();
              setError(null);
            }}
          >
            dismiss
          </button>
        </p>
      )}
    </div>
  );
}
