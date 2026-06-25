import { Bouncer } from './Bouncer'
import { FrogIcon } from './creature-icons'

export function FrogBouncer() {
  return (
    <Bouncer
      icon={FrogIcon}
      to="/minigame/turtler"
      label="Play frogger"
      baseSpeed={200}
      speedJitter={110}
      glow="drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]"
    />
  )
}
