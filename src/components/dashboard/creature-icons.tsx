// Cute, flat SVG icons for the three dashboard "bouncer" easter eggs. Kept as
// inline SVG (not asset files) so they stay crisp at any size, carry no network
// cost, and can be tinted/glowed via CSS. Each fills its container; the bouncer
// sets the box size. viewBox is a 64x64 square so they drop straight into the
// round hit-target without distortion.

type IconProps = { className?: string }

const SVG = 'w-full h-full'

export function FrogIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={`${SVG} ${className ?? ''}`} aria-hidden="true" focusable="false">
      {/* back feet */}
      <ellipse cx="15" cy="49" rx="9" ry="5" fill="#3aa257" />
      <ellipse cx="49" cy="49" rx="9" ry="5" fill="#3aa257" />
      {/* body */}
      <ellipse cx="32" cy="37" rx="21" ry="17" fill="#4ec16a" />
      {/* eye bumps */}
      <circle cx="22" cy="19" r="9.5" fill="#4ec16a" />
      <circle cx="42" cy="19" r="9.5" fill="#4ec16a" />
      <circle cx="22" cy="18" r="5.2" fill="#fff" />
      <circle cx="42" cy="18" r="5.2" fill="#fff" />
      <circle cx="23" cy="19" r="2.6" fill="#173a1f" />
      <circle cx="43" cy="19" r="2.6" fill="#173a1f" />
      {/* cheeks */}
      <circle cx="17" cy="38" r="3" fill="#ff9db0" opacity="0.7" />
      <circle cx="47" cy="38" r="3" fill="#ff9db0" opacity="0.7" />
      {/* smile */}
      <path d="M22 36 Q32 46 42 36" stroke="#173a1f" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function EelIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={`${SVG} ${className ?? ''}`} aria-hidden="true" focusable="false">
      {/* wavy body */}
      <path d="M6 42 Q16 24 28 34 T52 28" stroke="#36a9c4" strokeWidth="12" fill="none" strokeLinecap="round" />
      {/* dorsal frill */}
      <path d="M14 33 l3 -5 l3 5 M22 31 l3 -5 l3 5" stroke="#2b8ba3" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* head */}
      <circle cx="52" cy="28" r="9" fill="#36a9c4" />
      {/* eye + smile */}
      <circle cx="54" cy="25" r="2.6" fill="#fff" />
      <circle cx="54.6" cy="25.4" r="1.3" fill="#0d2b33" />
      <circle cx="47" cy="30" r="2.6" fill="#ff9db0" opacity="0.6" />
      <path d="M50 31 Q53 34 57 31" stroke="#0d2b33" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}

export function NudibranchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" className={`${SVG} ${className ?? ''}`} aria-hidden="true" focusable="false">
      {/* cerata frills along the back */}
      <g fill="#ffb14e">
        <circle cx="26" cy="24" r="4.5" />
        <circle cx="34" cy="21" r="5" />
        <circle cx="42" cy="23" r="4.5" />
      </g>
      {/* body */}
      <path d="M9 41 Q12 31 26 31 L50 31 Q59 31 59 39 Q59 45 50 45 L18 45 Q9 46 9 41 Z" fill="#ef5ba1" />
      {/* foot highlight */}
      <path d="M16 44 Q34 48 52 44" stroke="#f8a8cf" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {/* rhinophores (head antennae) */}
      <path d="M19 32 Q17 23 15 21" stroke="#c23a86" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <circle cx="14" cy="20" r="3.2" fill="#8e2f9e" />
      <path d="M25 32 Q25 23 24 20" stroke="#c23a86" strokeWidth="3.2" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="19" r="3.2" fill="#8e2f9e" />
      {/* face */}
      <circle cx="50" cy="38" r="2.4" fill="#fff" />
      <circle cx="50.6" cy="38.3" r="1.2" fill="#3a0f2a" />
      <circle cx="44" cy="41" r="2.6" fill="#ffd1de" opacity="0.8" />
      <path d="M52 41 Q54 43 56 41" stroke="#3a0f2a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}
