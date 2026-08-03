/**
 * Masking for single-digit PIN boxes.
 *
 * There is no "hidden" input type in HTML — the only native option is
 * `type="password"`, and both Firefox and Chrome hang their built-in
 * reveal-password control inside any non-empty password field. In a 40px PIN
 * box that renders as an eye icon crammed next to the digit (and Firefox also
 * offers to save the "password" to the password manager).
 *
 * `-webkit-text-security: disc` solves it in Chrome and Safari but does nothing
 * in Firefox, which is the primary target here.
 *
 * So we mask it ourselves: the box is a plain `type="text"` field that renders
 * MASK_CHAR while the real digit lives in React state. No native affordances,
 * identical behaviour in every engine.
 */

export const MASK_CHAR = '•';

/** What the input element shows for a given stored digit. */
export function maskedValue(digit: string): string {
  return digit ? MASK_CHAR : '';
}

/**
 * Pull the real digit out of an input event value.
 *
 * The raw value can be `'5'` (typed into an empty box or over a selection) or
 * `'•5'` / `'5•'` (typed with the caret beside an existing mask character), so
 * strip the mask first and keep the last remaining character.
 *
 * Returns `''` for a cleared box, or `null` when the keystroke was not a digit
 * and should be ignored entirely.
 */
export function extractDigit(rawValue: string): string | null {
  const stripped = rawValue.split(MASK_CHAR).join('');
  if (stripped === '') return '';
  const last = stripped.slice(-1);
  return /^\d$/.test(last) ? last : null;
}

/** Props every masked PIN box shares — keeps browsers from treating it as a credential. */
export const MASKED_PIN_INPUT_PROPS = {
  type: 'text' as const,
  inputMode: 'numeric' as const,
  pattern: '[0-9]*',
  autoComplete: 'off' as const,
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
};
