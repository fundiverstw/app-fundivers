import { Bouncer } from './Bouncer'
import { EelIcon } from './creature-icons'

export function EelBouncer() {
  return (
    <Bouncer
      icon={EelIcon}
      to="/minigame/eel"
      label="Play the eel minigame"
      baseSpeed={220}
      speedJitter={120}
      glow="drop-shadow-[0_0_10px_rgba(56,189,248,0.55)]"
    />
  )
}
