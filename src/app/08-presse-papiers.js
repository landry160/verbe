/* ============================================================
   8. Presse-papiers
   ============================================================ */
const COARSE = window.matchMedia('(pointer: coarse)');
const pasteHint = () => (IS_MAC ? '⌘ V' : 'Ctrl + V');
/* Sur un écran tactile, pas de raccourci clavier à suggérer */
/* après un collage : comment le remettre ailleurs si le texte est parti au mauvais endroit */
function pastedLine() {
  if (Settings.d.keepClip !== false) return 'Collé · Ctrl + V pour le recoller ailleurs';
  if (Desktop && Settings.d.repasteSc?.on) return `Collé · ${UI.scLabel(Settings.d.repasteSc).join(' + ')} pour le recoller`;
  return 'Collé là où tu écrivais';
}
const copiedLine = () => (COARSE.matches ? 'Copié · prêt à coller' : `Copié · ${pasteHint()} pour coller`);
const pasteSub = () => (COARSE.matches ? 'Prêt à coller.' : `Colle-le avec ${pasteHint()}.`);
async function copyText(text) {
  /* bureau : le presse-papiers de Windows, même sans focus */
  if (Desktop) { try { if (await Desktop.copy(text)) return true; } catch (e) { /* repli ci-dessous */ } }
  /* d'abord la fenêtre active (page ou mini-fenêtre), puis l'autre */
  const first = activeWin(), wins = first === window ? [window, Float.win] : [first, window];
  const list = wins.filter(w => w && !w.closed);
  for (const w of list) {
    try { await w.navigator.clipboard.writeText(text); return true; } catch (e) { /* repli ci-dessous */ }
  }
  for (const w of list) {
    try {
      const d = w.document, ta = d.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      d.body.appendChild(ta); ta.select();
      const ok = d.execCommand('copy'); ta.remove();
      if (ok) return true;
    } catch (e) { /* ignore */ }
  }
  return false;
}
