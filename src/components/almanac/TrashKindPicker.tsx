/**
 * Which materials the trash was made of.
 *
 * A checklist rather than a dropdown because a dive turns up several kinds at
 * once — plastic and fishing line and a styrofoam float — and picking one
 * would make the diver choose which of the things they saw counts.
 *
 * Disabled, not hidden, when the count is zero: "none" answers this question
 * already, and a picker that vanished would read as the form losing a field
 * rather than as the answer being settled.
 */
import { t } from '../../i18n'
import { ALMANAC_TRASH_KINDS, type AlmanacTrashKind } from '../../types/database'
import { INPUT_LABEL, TEXT_BODY, TEXT_SUBTLE } from '../../styles/tokens'

interface Props {
  selected: AlmanacTrashKind[]
  onChange: (next: AlmanacTrashKind[]) => void
  disabled?: boolean
}

export function TrashKindPicker({ selected, onChange, disabled = false }: Props) {
  const toggle = (kind: AlmanacTrashKind) =>
    onChange(selected.includes(kind) ? selected.filter(k => k !== kind) : [...selected, kind])

  return (
    <fieldset disabled={disabled} className={disabled ? 'opacity-50' : undefined}>
      <legend className={INPUT_LABEL}>{t.almanac.trashKindsLabel}</legend>
      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ALMANAC_TRASH_KINDS.map(kind => (
          <label key={kind} className={`flex items-center gap-2 text-sm ${TEXT_BODY}`}>
            <input
              type="checkbox"
              className="accent-brand-900"
              checked={selected.includes(kind)}
              onChange={() => toggle(kind)}
            />
            {t.almanac.trashKinds[kind]}
          </label>
        ))}
      </div>
      {disabled && <p className={`mt-1 text-xs ${TEXT_SUBTLE}`}>{t.almanac.trashNoneNote}</p>}
    </fieldset>
  )
}
