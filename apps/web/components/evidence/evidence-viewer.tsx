'use client';

import {
  FileTextIcon,
  FingerprintIcon,
  NotePencilIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from '@phosphor-icons/react';
import type { EvidenceView } from '@/lib/types';
import { formatDateUtc, shortAddress } from '@/lib/format';
import { Chip, CopyButton } from '@/components/ui';

const KIND_META: Record<
  EvidenceView['kind'],
  { label: string; icon: typeof FileTextIcon; tone: 'info' | 'ok' | 'warn' }
> = {
  'bill-of-lading': { label: 'Bill of lading', icon: FileTextIcon, tone: 'info' },
  digest: { label: 'Document digest', icon: FingerprintIcon, tone: 'ok' },
  note: { label: 'Note', icon: NotePencilIcon, tone: 'warn' },
};

/**
 * Side-by-side evidence viewer (ui.md Resolution Center): presents every
 * anchored piece of evidence for a dispute with its kind, submitting party,
 * label and the client-side digest that cryptographically binds the document.
 */
export function EvidenceViewer({ evidence }: { evidence: EvidenceView[] }) {
  if (evidence.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] px-6 py-8 text-center">
        <p className="text-[13px] text-mist-500">No evidence anchored yet.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {evidence.map((e) => {
        const meta = KIND_META[e.kind];
        const Icon = meta.icon;
        return (
          <article
            key={e.evidenceId}
            className="flex flex-col rounded-xl border border-white/[0.07] bg-ink-900/60 p-4 transition hover:border-white/[0.14]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-mist-300">
                  <Icon size={14} weight="duotone" />
                </span>
                <span className="text-[13px] font-semibold text-white">{e.label}</span>
              </div>
              <Chip tone={meta.tone}>{meta.label}</Chip>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-ink-900/80 px-3 py-2">
              <FingerprintIcon size={12} className="shrink-0 text-bridge-400" />
              <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-bridge-300">
                {e.digest}
              </code>
              <CopyButton value={e.digest} label="Copy evidence digest" />
            </div>

            {e.payload.note && (
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-mist-400">{e.payload.note}</p>
            )}
            {e.payload.fileName && (
              <p className="mt-2 font-mono text-[11.5px] text-mist-500">
                attached: {e.payload.fileName}
              </p>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3.5 text-[11px] text-mist-500">
              <span className="flex items-center gap-1">
                <UserCircleIcon size={12} />
                {shortAddress(e.submittedBy)}
              </span>
              <span className="flex items-center gap-1">
                <ShieldCheckIcon size={12} />
                {formatDateUtc(e.createdAt)}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
