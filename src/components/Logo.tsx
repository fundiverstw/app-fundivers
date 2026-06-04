// Brand logo — wraps /imgs/fd_logo.png with size presets so every
// surface that uses it picks a consistent height. The image is the
// dive-mask-shaped FUN DIVERS TAIWAN mark (red/white/black on a
// transparent background), so it works on dark and light surfaces
// without modification.
//
// Sizes (height in px): xs 24, sm 36, md 56, lg 88, xl 128.
//
// The `beta` badge defaults on so it rides along on every surface the
// logo appears — the authed shells, the auth pages, and the guest
// registration page divers reach from Wix. When the app leaves beta,
// flip the default here (one place) rather than hunting call sites.

const SIZE_CLASS: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', string> = {
  xs: 'h-6',
  sm: 'h-9',
  md: 'h-14',
  lg: 'h-22',
  xl: 'h-32',
}

export function Logo({
  size = 'md',
  className = '',
  beta = true,
}: {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  beta?: boolean
}) {
  return (
    <span className="inline-flex items-start gap-1">
      <img
        src="/imgs/fd_logo.png"
        alt="FunDivers Taiwan"
        className={`${SIZE_CLASS[size]} w-auto ${className}`}
      />
      {beta && (
        <span className="bg-red-500 text-white rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none uppercase tracking-wide">
          Beta
        </span>
      )}
    </span>
  )
}
