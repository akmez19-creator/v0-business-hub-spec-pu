/**
 * "Okay" / "Thank you" / "Ok" / 👍 after a reply from the team closes the
 * exchange: the customer is not waiting for anything. Measured 15 Sep 2026 -
 * four of the top eight "Needs reply" rows were exactly this.
 *
 * Kept deliberately narrow: a short message made ONLY of acknowledgement words
 * or emoji. "Ok but when?" or "Thanks, and the price?" still need a reply.
 */

const ACK_WORDS = new Set([
  'ok', 'okay', 'oki', 'okk', 'okey', 'k', 'kk', 'okie', 'oke',
  'thanks', 'thank', 'thnks', 'thnk', 'you', 'u', 'thx', 'tnx', 'ty', 'thankyou', 'thanx', 'tks',
  'merci', 'mersi', 'beaucoup', 'bcp', 'bien', 'daccord', 'd', 'accord', 'dakor', 'dacor', 'korek', 'correct',
  'noted', 'alright', 'aright', 'right', 'sure', 'fine', 'great', 'perfect', 'super', 'top', 'nice', 'good', 'cool',
  'parfait', 'tres', 'très', 'bon', 'bonne', 'journee', 'journée', 'soiree', 'soirée', 'a', 'à', 'plus', 'tard', 'bientot', 'bientôt',
  'welcome', 'yes', 'yep', 'yup', 'oui', 'wi', 'ya', 'yeah',
  'received', 'got', 'it', 'done', 'sorted', 'seen',
  'have', 'day', 'god', 'bless', 'much', 'so', 'lot', 'very', 'many', 'and', 'too',
  'the', 'for', 'your', 'help', 'reply', 'response', 'info', 'information', 'le', 'la', 'pour', 'ki', 'ma', 'mo',
  'monn', 'gagn', 'gagne', 'recu', 'reçu', 'resevwar', 'bye', 'byee', 'ciao', 'ttyl',
])

// Digits are \p{Emoji_Component} (keycaps), so a phone number would pass - list the modifiers explicitly.
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\s\u200d\ufe0f]+$/u
const STRIP_COPY_PREFIX = /^(GREEN-API copy|History copy)\s*·\s*/

export function isClosingAcknowledgement(text: string | null | undefined): boolean {
  if (!text) return false
  const raw = text.replace(STRIP_COPY_PREFIX, '').trim()
  if (!raw || raw.length > 60) return false
  if (/[?]/.test(raw)) return false
  if (EMOJI_ONLY.test(raw)) return true
  const words = raw
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u200d\ufe0f]/gu, ' ')
    .replace(/[.!,;:'’"()-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return true
  if (words.length > 8) return false
  return words.every((w) => ACK_WORDS.has(w))
}
