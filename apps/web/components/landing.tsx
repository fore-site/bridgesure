'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ClockIcon,
  CoinsIcon,
  DownloadSimpleIcon,
  FileLockIcon,
  FingerprintIcon,
  LightningIcon,
  ShieldCheckIcon,
  ShieldSlashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { BridgeSureMark } from './brand';
import { Chip, Reveal, SectionHeading } from './ui';

/* ================= Nav ================= */

const NAV_LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#mechanism', label: 'Mechanism' },
  { href: '#how-it-works', label: 'How it works' },
];

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="glass-light sticky top-0 z-50">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="BridgeSure home">
          <BridgeSureMark className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
            BridgeSure
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <span className="hidden items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-600 lg:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-ok-400 pulse-soft" />
            Monad Testnet
          </span>
          <Link href="/dashboard" className="btn-primary">
            Open the app
            <ArrowUpRightIcon size={15} weight="bold" />
          </Link>
        </div>

        <button
          type="button"
          className="btn-ghost md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
          }}
        >
          {open ? <XIcon size={20} /> : <span className="text-sm text-slate-700">Menu</span>}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-200 px-6 py-4 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => {
                  setOpen(false);
                }}
                className="rounded-lg px-3 py-2.5 text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {link.label}
              </a>
            ))}
            <Link
              href="/dashboard"
              onClick={() => {
                setOpen(false);
              }}
              className="btn-primary mt-2 w-full"
            >
              Open the app
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

/* ================= Hero ================= */

function MilestoneRow({
  label,
  amount,
  state,
  reason,
}: {
  label: string;
  amount: string;
  state: 'released' | 'blocked';
  reason?: string;
}) {
  const ok = state === 'released';
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.05] bg-white/[0.03] px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full ${
            ok ? 'bg-ok-500/15 text-ok-400' : 'bg-danger-500/15 text-danger-400'
          }`}
        >
          {ok ? <CheckIcon size={11} weight="bold" /> : <XIcon size={11} weight="bold" />}
        </span>
        <span className="text-[12.5px] font-medium text-mist-300">{label}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[12.5px] text-white">{amount}</span>
        <span className="text-[11px] text-mist-500">aUSDC</span>
        {reason && (
          <Chip tone="danger" className="hidden sm:inline-flex">
            {reason}
          </Chip>
        )}
      </div>
    </div>
  );
}

function DecisionCard() {
  return (
    <div className="panel relative overflow-hidden p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="label inline-flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-ok-400 pulse-soft" />
          Live · fresh check just ran
        </span>
        <Chip tone="danger" dot>
          Failed closed
        </Chip>
      </div>

      <div className="mt-5">
        <div className="label">Escrow balance</div>
        <div className="mt-1.5 font-mono text-[2.1rem] font-medium leading-none tracking-[-0.02em] text-white">
          1,000.00 <span className="text-sm font-normal text-mist-400">aUSDC</span>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <MilestoneRow label="Milestone 1" amount="400.00" state="released" />
        <MilestoneRow label="Milestone 2" amount="600.00" state="blocked" reason="frozen" />
      </div>

      <div className="my-4 h-px bg-white/[0.06]" />

      <div className="space-y-1">
        <div className="logline">
          <span className="w-24 shrink-0 text-mist-500">verify_apass</span>
          <span className="text-mist-300">exporter</span>
          <span className="ml-auto text-right tone-danger">code 2 · frozen</span>
        </div>
        <div className="logline">
          <span className="w-24 shrink-0 text-mist-500">validator</span>
          <span className="text-mist-300">exporter</span>
          <span className="ml-auto text-right tone-danger">false</span>
        </div>
        <div className="logline">
          <span className="w-24 shrink-0 text-mist-500">decision</span>
          <span className="ml-auto text-right tone-danger">APASS_NOT_VALID</span>
        </div>
      </div>

      <div className="my-4 h-px bg-white/[0.06]" />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between font-mono text-[12.5px]">
          <span className="text-mist-500">Exporter balance</span>
          <span className="text-white">0.00 aUSDC</span>
        </div>
        <div className="flex items-center justify-between font-mono text-[12.5px]">
          <span className="text-mist-500">Escrow balance</span>
          <span className="text-white">600.00 aUSDC</span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-danger-400/20 bg-danger-500/[0.07] px-3 py-2.5 text-[12.5px] font-medium text-danger-300">
        <ShieldSlashIcon size={15} weight="fill" />
        The money did not move.
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative">
      <div className="relative mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 pb-24 pt-20 md:pb-32 md:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Reveal>
              <Chip tone="info" dot className="mb-6">
                Compliance-continuous escrow · Monad + Cleanverse
              </Chip>
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="text-balance text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.035em] text-slate-900 md:text-6xl lg:text-[4.1rem]">
                Milestone payments move only after{' '}
                <span className="text-accent">fresh compliance checks</span>.
              </h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-6 max-w-xl text-balance text-[16.5px] leading-relaxed text-slate-600">
                BridgeSure settles cross-border trade in an aUSDC escrow on Monad. Before every
                milestone release, both parties are re-verified through Cleanverse A-Pass and
                validator checks — in the same attempt, seconds before funds move. When a credential
                stops being fresh, the next release fails closed. The funds stay in escrow.
              </p>
            </Reveal>
            <Reveal delay={0.2}>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/dashboard" className="btn-hero">
                  Open the app
                  <ArrowRightIcon size={16} weight="bold" />
                </Link>
                <a href="#how-it-works" className="btn-secondary-light px-5 py-3 text-[15px]">
                  See how it works
                </a>
              </div>
            </Reveal>
            <Reveal delay={0.28}>
              <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
                <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
                  <FingerprintIcon size={15} className="text-slate-400" />
                  A-Pass re-checked per release
                </div>
                <div className="flex items-center gap-2 text-[12.5px] text-slate-500">
                  <DownloadSimpleIcon size={15} className="text-slate-400" />
                  Travel Rule evidence export
                </div>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.15} className="relative">
            <div className="relative">
              <DecisionCard />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ================= Trust strip ================= */

function TrustStrip() {
  return (
    <section className="border-y border-slate-200 bg-white/60">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-10 gap-y-4 px-6 py-6">
        <span className="label">Built on</span>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-sm font-semibold tracking-tight text-slate-800">
            MONAD
          </span>
          <span className="text-[11px] text-slate-500">chain 10143</span>
        </div>
        <img src="/brand/cleanverse-logo-black.svg" alt="Cleanverse" className="h-4" />
        <div className="flex items-center gap-2 text-[13px] text-slate-600">
          <CoinsIcon size={15} className="text-bridge-500" />
          <span className="font-mono">aUSDC</span>
          <span className="text-slate-500">CVA</span>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-slate-600">
          <ShieldCheckIcon size={15} className="text-bridge-500" />
          <span className="font-mono">IAPassComplianceValidator</span>
        </div>
      </div>
    </section>
  );
}

/* ================= Problem ================= */

const PROBLEMS = [
  {
    icon: ClockIcon,
    title: 'Credentials go stale mid-trade',
    body: 'An A-Pass verified at onboarding can be frozen, expired, or jurisdiction-blocked thirty minutes later. Onboarding checks do not cover the window where the money actually moves.',
  },
  {
    icon: ShieldSlashIcon,
    title: 'Sanctions change in real time',
    body: 'Watchlists and jurisdiction rules move faster than static integrations. A party that was compliant at deposit can be ineligible at payout.',
  },
  {
    icon: LightningIcon,
    title: 'Milestone payouts do not wait',
    body: 'Escrow software that automates installments keeps paying until a human notices. Every automated release without a fresh check is an unchecked release.',
  },
];

function Problem() {
  return (
    <section id="product" className="mx-auto max-w-[1440px] px-6 py-24 md:py-32">
      <SectionHeading
        light
        eyebrow="The problem"
        title={
          <>
            Compliance checked at onboarding is{' '}
            <span className="text-slate-500">already out of date</span>.
          </>
        }
        sub="Most escrows treat verification as a one-time gate: verify once at the door, then automate the payments. That is exactly the failure mode regulators distrust."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {PROBLEMS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.08}>
            <div className="panel-light group h-full p-6 transition hover:border-slate-300">
              <p.icon size={22} className="text-bridge-500" weight="duotone" />
              <h3 className="mt-5 text-[15.5px] font-semibold tracking-[-0.01em] text-slate-900">
                {p.title}
              </h3>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-slate-600">{p.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ================= Mechanism ================= */

const PRIMITIVES = [
  {
    icon: FingerprintIcon,
    tag: 'CVI · identity',
    title: 'A-Pass',
    body: 'Parties are verified identities — wallet-bound, tiered, and revocable. The escrow re-checks both sides before every release, so a revocation lands in time to stop the next payout.',
  },
  {
    icon: CoinsIcon,
    tag: 'CVA · asset',
    title: 'aUSDC verified asset',
    body: 'Every escrow balance and payout is an eligible, traceable A-Token that carries its own transfer restrictions — value held in the escrow is verified value, end to end.',
  },
  {
    icon: FileLockIcon,
    tag: 'CCP · pre-trade checks',
    title: 'Policy + Travel Rule',
    body: 'Every value move is a fresh, auditable compliance decision with jurisdiction and policy enforcement, and the evidence is exportable as a Travel Rule report.',
  },
];

function Mechanism() {
  return (
    <section id="mechanism" className="border-t border-slate-200 bg-slate-50/70">
      <div className="mx-auto max-w-[1440px] px-6 py-24 md:py-32">
        <SectionHeading
          light
          eyebrow="The mechanism"
          title={
            <>
              Three Cleanverse primitives, wired into{' '}
              <span className="text-accent">value-moving logic</span>.
            </>
          }
          sub="Not a UI flag. A revocation anywhere in the flow changes what the escrow will actually do next — because the checks run inside the release path itself."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PRIMITIVES.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.08}>
              <div className="panel-light group relative h-full overflow-hidden p-6 transition hover:border-slate-300">
                <div className="flex items-center justify-between">
                  <p.icon size={24} className="text-bridge-600" weight="duotone" />
                  <span className="label">{p.tag}</span>
                </div>
                <h3 className="mt-5 text-[15.5px] font-semibold tracking-[-0.01em] text-slate-900">
                  {p.title}
                </h3>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-slate-600">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ================= Release invariant ================= */

function Invariant() {
  return (
    <section className="mx-auto max-w-[1440px] px-6 py-24 md:py-32">
      <div className="max-w-2xl">
        <SectionHeading
          light
          eyebrow="The release invariant"
          title={
            <>
              One negative check fails the release.{' '}
              <span className="text-slate-500">No signature. No transaction.</span>
            </>
          }
          sub="The API runs every check in the same attempt, then a short-lived, signed authorization binds chain, contract, trade, milestone, parties, amount, token, nonce, and evidence — and the contract re-verifies before transferring."
        />
        <Reveal delay={0.1}>
          <ul className="mt-8 max-w-xl space-y-3">
            {[
              'Every timeout, malformed response, or paused pool fails closed.',
              'A stale, frozen, or jurisdiction-ineligible party blocks the next release.',
              'Each attempt is reason-coded and recorded in the audit trail.',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-[14px] text-slate-700">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok-500/12 text-ok-500">
                  <CheckIcon size={11} weight="bold" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ================= How it works ================= */

const STEPS = [
  {
    title: 'Create the trade',
    body: 'Parties, aUSDC milestone split, and the active compliance policy are bound to one trade record.',
  },
  {
    title: 'Fund the escrow',
    body: 'The importer deposits the CVA. Value now sits in the contract, visible on-chain.',
  },
  {
    title: 'Fresh checks, every release',
    body: 'A-Pass and validator results are gathered for both parties in the same attempt, seconds before funds move.',
  },
  {
    title: 'Milestone one releases',
    body: 'A bounded authorization is signed, the contract re-verifies, and the transfer executes.',
  },
  {
    title: 'A participant is frozen',
    body: 'Mid-trade, the exporter\u2019s credential is invalidated in the sandbox.',
  },
  {
    title: 'Milestone two fails closed',
    body: 'The next release is blocked with a reason code. Balances unchanged. Evidence exportable.',
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-slate-200 bg-slate-50/70">
      <div className="mx-auto max-w-[1440px] px-6 py-24 md:py-32">
        <SectionHeading
          light
          align="center"
          eyebrow="How it works"
          title="One trade. One successful release. One fail-closed release."
          sub="The full lifecycle a reviewer can reproduce in minutes — ending with the money-doesn\u2019t-move moment."
        />
        <ol className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => {
            const danger = i === STEPS.length - 1;
            return (
              <Reveal key={step.title} delay={(i % 3) * 0.07} as="li">
                <div
                  className={`panel-light relative h-full overflow-hidden p-6 transition hover:border-slate-300 ${
                    danger ? 'border-danger-300' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full border font-mono text-[13px] font-medium ${
                        danger
                          ? 'border-danger-300 bg-danger-500/10 text-danger-600'
                          : 'border-bridge-500/30 bg-bridge-500/10 text-bridge-600'
                      }`}
                    >
                      {i + 1}
                    </span>
                    {danger ? (
                      <Chip tone="danger">funds preserved</Chip>
                    ) : (
                      <span className="label">{i < 3 ? 'Setup' : 'Settlement'}</span>
                    )}
                  </div>
                  <h3 className="mt-5 text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">{step.body}</p>
                </div>
              </Reveal>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ================= CTA band ================= */

function CtaBand() {
  return (
    <section className="mx-auto max-w-[1440px] px-6 py-24 md:py-32">
      <Reveal>
        <div className="panel relative overflow-hidden p-10 md:p-14">
          <div className="relative flex flex-col items-center gap-8 text-center">
            <Chip tone="info" dot>
              Reproducible in minutes · mocks by default
            </Chip>
            <h2 className="max-w-2xl text-balance text-3xl font-semibold tracking-[-0.03em] text-white md:text-5xl md:leading-[1.06]">
              Watch a payment <span className="text-accent-soft">fail safely</span>.
            </h2>
            <p className="max-w-xl text-balance text-[15.5px] leading-relaxed text-mist-400">
              Watch the escrow fund automatically, release milestone one, freeze the exporter, and
              attempt milestone two — then export both decisions as one audit packet with hashes,
              reason codes, and Travel Rule evidence.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/dashboard" className="btn-primary px-6 py-3 text-[15px]">
                Open the app
                <ArrowRightIcon size={16} weight="bold" />
              </Link>
              <a href="#mechanism" className="btn-secondary px-6 py-3 text-[15px]">
                Read the mechanism
              </a>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
              {[
                ['2', 'milestone gates'],
                ['4', 'checks per release'],
                ['1', 'reason code per block'],
              ].map(([n, label]) => (
                <div key={label} className="flex items-baseline gap-2">
                  <span className="font-mono text-xl font-medium text-white">{n}</span>
                  <span className="text-[12.5px] text-mist-500">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ================= Footer ================= */

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white/60">
      <div className="mx-auto max-w-[1440px] px-6 py-14">
        <div className="flex flex-col justify-between gap-10 md:flex-row">
          <div className="max-w-sm">
            <span className="inline-flex items-center gap-2.5">
              <BridgeSureMark className="h-6 w-6" />
              <span className="font-semibold tracking-[-0.01em] text-slate-900">BridgeSure</span>
            </span>
            <p className="mt-4 text-[13.5px] leading-relaxed text-slate-500">
              Compliance-continuous escrow for cross-border trade. Every milestone release is a
              fresh, reason-coded compliance decision.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <img src="/brand/cleanverse-logo-black.svg" alt="" className="h-4 w-4" />
              <span className="text-[12px] text-slate-500">Built on the Cleanverse network</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <span className="label">Product</span>
              <ul className="mt-4 space-y-2.5 text-[13.5px]">
                <li>
                  <a className="text-slate-600 transition hover:text-slate-900" href="#product">
                    Why it exists
                  </a>
                </li>
                <li>
                  <a className="text-slate-600 transition hover:text-slate-900" href="#mechanism">
                    Mechanism
                  </a>
                </li>
                <li>
                  <a
                    className="text-slate-600 transition hover:text-slate-900"
                    href="#how-it-works"
                  >
                    How it works
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <span className="label">Platform</span>
              <ul className="mt-4 space-y-2.5 text-[13.5px]">
                <li>
                  <Link
                    className="text-slate-600 transition hover:text-slate-900"
                    href="/dashboard"
                  >
                    Dashboard
                  </Link>
                </li>
                <li>
                  <Link className="text-slate-600 transition hover:text-slate-900" href="/trades">
                    Trades
                  </Link>
                </li>
                <li>
                  <Link className="text-slate-600 transition hover:text-slate-900" href="/disputes">
                    Resolution center
                  </Link>
                </li>
                <li>
                  <Link
                    className="text-slate-600 transition hover:text-slate-900"
                    href="/admin/dashboard"
                  >
                    Operator portal
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <span className="label">Ecosystem</span>
              <ul className="mt-4 space-y-2.5 text-[13.5px]">
                <li>
                  <span className="text-slate-600">Monad Testnet</span>
                </li>
                <li>
                  <span className="text-slate-600">Cleanverse</span>
                </li>
                <li>
                  <span className="text-slate-600">aUSDC</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-slate-200 pt-6 text-[12px] text-slate-500 sm:flex-row sm:items-center">
          <span>© 2026 BridgeSure — live on Monad Testnet.</span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ok-500" />
            Monad Testnet · chain 10143
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ================= Page ================= */

export function LandingPage() {
  return (
    <div className="landing-light min-h-screen bg-canvas text-slate-700">
      <Nav />
      <main>
        <Hero />
        <TrustStrip />
        <Problem />
        <Mechanism />
        <Invariant />
        <HowItWorks />
        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}
