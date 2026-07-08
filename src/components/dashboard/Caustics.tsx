import { useEffect, useState } from 'react'

// Animated water caustics — the marketing site's (site-fundivers) ambient
// background, ported to the app's dashboard. Two SVG fractal-noise layers, each
// a set of long horizontally-stretched ribbons (low + anisotropic baseFrequency
// → wave-like veins, not round particles) that slowly warp in place
// (baseFrequency morph = shimmer) and drift via CSS (.cl-a / .cl-b). A second,
// very-low-frequency "envelope" turbulence is multiplied over the ribbons so
// brightness varies across the screen — dense bright patches next to calm dark
// water — killing the uniform disco look. Layers are `mix-blend-mode: screen`
// over the dark ocean, so they read as faint neon light veins.
//
// Positioning + drift/loop live in the `.caustics*` CSS (src/index.css); this
// component owns the SVG filters and the in-place noise morph.

export function Caustics() {
  // The baseFrequency morph (SMIL <animate>) recomputes fractal noise every
  // frame — fine on desktop, far too heavy for phone GPUs. Only morph on
  // non-touch, wide screens that haven't asked for reduced motion. (The CSS
  // hides the whole .caustics element on mobile, so this also stops SMIL
  // ticking there; the check keeps it off on reduced-motion desktops too.)
  const [animate, setAnimate] = useState(false)
  useEffect(() => {
    const mm = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches
    setAnimate(
      !mm('(prefers-reduced-motion: reduce)') &&
      !mm('(hover: none) and (pointer: coarse)') &&
      !mm('(max-width: 820px)'),
    )
  }, [])

  return (
    <div className="caustics" aria-hidden="true">
      <svg className="caustics-layer cl-a" xmlns="http://www.w3.org/2000/svg">
        <filter id="caustic-a" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0038 0.013" numOctaves={3} seed={4} result="wave">
            {animate && (
              <animate attributeName="baseFrequency" dur="19s" repeatCount="indefinite"
                values="0.0038 0.013;0.0050 0.011;0.0034 0.015;0.0038 0.013" keyTimes="0;0.35;0.7;1" />
            )}
          </feTurbulence>
          <feColorMatrix in="wave" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.34 0.34 0.34 0 0" result="wa" />
          <feComponentTransfer in="wa" result="veins"><feFuncA type="gamma" amplitude={2.6} exponent={4} offset={0} /></feComponentTransfer>
          <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.0016" numOctaves={2} seed={11} result="env" />
          <feColorMatrix in="env" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0.5 0.5 0 0" result="ea" />
          <feComponentTransfer in="ea" result="mask"><feFuncA type="gamma" amplitude={1.6} exponent={2.4} offset={0.1} /></feComponentTransfer>
          <feComposite in="veins" in2="mask" operator="arithmetic" k1={1} k2={0} k3={0} k4={0} result="mod" />
          <feFlood floodColor="#a5f3ea" result="tint" />
          <feComposite in="tint" in2="mod" operator="in" />
        </filter>
        <rect width="100%" height="100%" filter="url(#caustic-a)" />
      </svg>
      <svg className="caustics-layer cl-b" xmlns="http://www.w3.org/2000/svg">
        <filter id="caustic-b" x="-30%" y="-30%" width="160%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0052 0.017" numOctaves={3} seed={23} result="wave">
            {animate && (
              <animate attributeName="baseFrequency" dur="26s" repeatCount="indefinite"
                values="0.0052 0.017;0.0042 0.014;0.0060 0.020;0.0052 0.017" keyTimes="0;0.4;0.72;1" />
            )}
          </feTurbulence>
          <feColorMatrix in="wave" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.34 0.34 0.34 0 0" result="wa" />
          <feComponentTransfer in="wa" result="veins"><feFuncA type="gamma" amplitude={2.3} exponent={5} offset={0} /></feComponentTransfer>
          <feTurbulence type="fractalNoise" baseFrequency="0.0013 0.0013" numOctaves={2} seed={5} result="env" />
          <feColorMatrix in="env" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0.5 0.5 0 0" result="ea" />
          <feComponentTransfer in="ea" result="mask"><feFuncA type="gamma" amplitude={1.7} exponent={2.6} offset={0.08} /></feComponentTransfer>
          <feComposite in="veins" in2="mask" operator="arithmetic" k1={1} k2={0} k3={0} k4={0} result="mod" />
          <feFlood floodColor="#cba6f7" result="tint" />
          <feComposite in="tint" in2="mod" operator="in" />
        </filter>
        <rect width="100%" height="100%" filter="url(#caustic-b)" />
      </svg>
    </div>
  )
}
