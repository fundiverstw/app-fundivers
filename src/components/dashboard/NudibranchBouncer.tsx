import { Bouncer } from './Bouncer'
import { NudibranchIcon } from './creature-icons'

export function NudibranchBouncer() {
  return (
    <Bouncer
      icon={NudibranchIcon}
      to="/minigame/nudibranchout"
      label="Play nudibranchout"
      baseSpeed={240}
      speedJitter={130}
      glow="drop-shadow-[0_0_12px_rgba(236,72,153,0.55)]"
    />
  )
}
