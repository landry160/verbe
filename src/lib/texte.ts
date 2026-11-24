/* Le texte après la transcription : logique pure (ni page, ni réglage), testée avec Vitest (tests/unit). */

/** Ce que Whisper ajoute parfois et qu'on retire : guillemets autour du texte, « sous-titres » inventés. */
export function cleanTranscript(t: unknown): string {
  let s = String(t || '').replace(/\r/g, '').trim();
  s = s.replace(/^["“«`]+\s*|\s*["”»`]+$/g, '');
  s = s.replace(/(^|[.!?…]\s+)[^.!?…]*sous-titr[^.!?…]*(amara|radio-canada|st'?\s?501)[^.!?…]*[.!?…]?/gi, '$1');
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/* Commandes à la voix (v0.3) : « virgule », « point à la ligne », « nouveau paragraphe », « efface ça »…
   Whisper met souvent sa propre ponctuation autour du mot dit : on l'absorbe avant de remplacer. */
export const VOICE_CMDS: ReadonlyArray<readonly [string, string]> = [
  ['point à la ligne', '.\n'],
  ['nouveau paragraphe', '\n\n'],
  ['retour à la ligne', '\n'],
  ['nouvelle ligne', '\n'],
  ['point d[’\']interrogation', '?'],
  ['point d[’\']exclamation', '!'],
  ['point[- ]virgule', ';'],
  ['point final', '.'],
  ['virgule', ','],
  ['ouvrez les guillemets', '« '],
  ['fermez les guillemets', ' »'],
];
export const ERASE_RE = /[\s,.;:!?…]*(?<!\p{L})(?:efface|supprime|efface-moi) (?:ça|cela|la dernière phrase)(?!\p{L})[\s,.;:!?…]*/giu;

export function applyVoiceCommands(text: unknown): string {
  let s = String(text || '');
  if (!/virgule|ligne|paragraphe|point|guillemets|efface|supprime/i.test(s)) return s;
  const before = s;
  /* « efface ça » : retire la phrase qui précède la commande */
  let m: RegExpExecArray | null;
  while ((m = ERASE_RE.exec(s))) {
    const head = s.slice(0, m.index).replace(/[\s,;:]+$/, '');
    const cut = Math.max(head.lastIndexOf('. ', head.length - 2), head.lastIndexOf('! ', head.length - 2), head.lastIndexOf('? ', head.length - 2), head.lastIndexOf('\n'));
    const kept = cut >= 0 ? head.slice(0, cut + 1) : '';
    s = kept + (kept && !/\n$/.test(kept) ? ' ' : '') + s.slice(m.index + m[0].length);
    ERASE_RE.lastIndex = kept.length;
  }
  for (const [phrase, out] of VOICE_CMDS) {
    /* on absorbe espaces et ponctuation autour, mais jamais un retour à la ligne déjà posé */
    const re = new RegExp(`([ \\t\\u00A0,.;:!?…]*)(?<!\\p{L})${phrase}(?!\\p{L})[ \\t\\u00A0,.;:!?…]*`, 'giu');
    s = s.replace(re, (_: string, lead: string) => {
      if (out.startsWith('«')) return ' ' + out;
      /* « Bonjour. Nouvelle ligne. » garde le point que Whisper avait mis */
      if (out.startsWith('\n')) { const end = (lead.match(/[.!?…]/) || [''])[0]; return end + out; }
      if (out.includes('\n')) return out;
      return out + ' ';
    });
  }
  if (s === before) return s;
  /* majuscule après une fin de phrase ou un retour à la ligne */
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (_: string, a: string, b: string) => a + b.toUpperCase());
  return s.trim();
}

export const countWords = (t: unknown): number => (String(t).trim().match(/\S+/g) || []).length;
