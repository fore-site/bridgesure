'use client';

import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { CheckIcon, CopyIcon } from '@phosphor-icons/react';
import { shortAddress } from '@/lib/format';

/* ---------- Scroll reveal ---------- */

export function Reveal({
  children,
  delay = 0,
  className,
  as = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.65, delay, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </Comp>
  );
}

/* ---------- Tone system ---------- */

export type Tone = 'muted' | 'info' | 'ok' | 'warn' | 'danger';

const TONE_CHIP: Record<Tone, string> = {
  muted: 'border-white/[0.06] bg-white/[0.04] text-mist-400',
  info: 'border-bridge-400/25 bg-bridge-500/10 text-bridge-300',
  ok: 'border-ok-400/25 bg-ok-500/10 text-ok-300',
  warn: 'border-warn-400/25 bg-warn-500/10 text-warn-300',
  danger: 'border-danger-400/30 bg-danger-500/10 text-danger-300',
};

const TONE_DOT: Record<Tone, string> = {
  muted: 'bg-mist-500',
  info: 'bg-bridge-400',
  ok: 'bg-ok-400',
  warn: 'bg-warn-400',
  danger: 'bg-danger-400',
};

export function Chip({
  tone = 'muted',
  children,
  dot = false,
  pulse = false,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${TONE_CHIP[tone]} ${className}`}
    >
      {dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]} ${pulse ? 'pulse-soft' : ''}`}
        />
      )}
      {children}
    </span>
  );
}

/* ---------- Copy ---------- */

export function CopyButton({
  value,
  label = 'Copy',
  className = '',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`${label} ${value}`}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-mist-500 transition hover:bg-white/[0.06] hover:text-bridge-300 ${className}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => {
            setCopied(false);
          }, 1400);
        });
      }}
    >
      {copied ? (
        <CheckIcon size={13} weight="bold" className="text-ok-400" />
      ) : (
        <CopyIcon size={13} />
      )}
    </button>
  );
}

export function HashText({
  value,
  copy = true,
  className = '',
}: {
  value: string;
  copy?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 ${className}`}>
      <span className="truncate font-mono text-[12.5px] tracking-[-0.01em] text-mist-300">
        {shortAddress(value)}
      </span>
      {copy && <CopyButton value={value} />}
    </span>
  );
}

/* ---------- Section heading ---------- */

export function SectionHeading({
  eyebrow,
  title,
  sub,
  align = 'left',
  className = '',
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
}) {
  const alignCls = align === 'center' ? 'mx-auto text-center items-center' : '';
  return (
    <Reveal className={`flex max-w-2xl flex-col gap-4 ${alignCls} ${className}`}>
      <span className="label inline-flex items-center gap-2">
        <span className="h-px w-6 bg-bridge-400/60" />
        {eyebrow}
      </span>
      <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] text-white md:text-[2.6rem] md:leading-[1.08]">
        {title}
      </h2>
      {sub && <p className="text-balance text-[15.5px] leading-relaxed text-mist-400">{sub}</p>}
    </Reveal>
  );
}
