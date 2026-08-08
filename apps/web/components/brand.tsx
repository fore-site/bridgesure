/**
 * BridgeSure + Cleanverse brand assets.
 * The BridgeSure mark is an inline SVG (bridge + trust shield) so it inherits
 * currentColor and scales cleanly; Cleanverse marks are the official media-kit
 * files, served from /public/brand.
 */

export function BridgeSureMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" role="img" aria-hidden="true" className={className} fill="none">
      <rect width="512" height="512" rx="112" fill="url(#bs-bg)" />
      <path d="M74 382h364" stroke="#294F78" strokeWidth="12" strokeLinecap="round" />
      <path d="M104 372V244h54v128M354 372V244h54v128" fill="#D9F6FF" />
      <path d="M91 244h80M341 244h80" stroke="#D9F6FF" strokeWidth="16" strokeLinecap="round" />
      <path
        d="M131 244c54 128 196 128 250 0"
        stroke="url(#bs-bridge)"
        strokeWidth="18"
        strokeLinecap="round"
      />
      <path d="M131 244c54 70 196 70 250 0" stroke="#7DEBFF" strokeOpacity=".55" strokeWidth="5" />
      <path
        d="M167 277v67M204 301v43M241 311v33M278 301v43M315 277v67"
        stroke="#42D9FF"
        strokeWidth="7"
        strokeLinecap="round"
        opacity=".9"
      />
      <path d="M256 118l72 28v61c0 56-31 91-72 111-41-20-72-55-72-111v-61z" fill="#F5FCFF" />
      <path d="M256 137l53 21v49c0 39-20 67-53 86-33-19-53-47-53-86v-49z" fill="#123B67" />
      <path
        d="M226 207l21 21 40-43"
        stroke="#55E1FF"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="131" cy="244" r="11" fill="#55E1FF" />
      <circle cx="381" cy="244" r="11" fill="#55E1FF" />
      <defs>
        <linearGradient id="bs-bg" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#081A33" />
          <stop offset="1" stopColor="#123B67" />
        </linearGradient>
        <linearGradient id="bs-bridge" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#42D9FF" />
          <stop offset="1" stopColor="#3C7CFF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BridgeSureWordmark({
  markClass = 'h-6 w-6',
  textClass = 'text-[15px]',
}: {
  markClass?: string;
  textClass?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BridgeSureMark className={markClass} />
      <span className={`font-semibold tracking-[-0.01em] text-white ${textClass}`}>BridgeSure</span>
    </span>
  );
}

export function CleanverseMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <img src="/brand/cleanverse-mark-white.svg" alt="" aria-hidden="true" className={className} />
  );
}

export function CleanverseLockup({ className = 'h-4.5' }: { className?: string }) {
  return <img src="/brand/cleanverse-logo-white.svg" alt="Cleanverse" className={className} />;
}
