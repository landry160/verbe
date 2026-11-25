/* ============================================================
   12. Démarrage
   ============================================================ */
function init() {
  Settings.load();
  hydrateIcons();
  /* version web sur un ordi Windows : proposer l'app bureau, si elle est publiée */
  if (!Desktop && DOWNLOAD_URL && /Windows/i.test(navigator.userAgent) && !COARSE.matches) { $('#dl-link').href = DOWNLOAD_URL; $('#dl-row').hidden = false; }
  const fav =`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#AF6318'/><stop offset='1' stop-color='#8A4418'/></linearGradient></defs><rect width='64' height='64' rx='14' fill='url(#g)'/><g stroke='#fff' stroke-width='5.2' stroke-linecap='round'><path d='M17 18v28'/><path d='M24.5 25v21'/><path d='M32 32v14'/><path d='M39.5 25v21'/><path d='M47 18v28'/></g></svg>`;
  $('#favicon').href = 'data:image/svg+xml,' + encodeURIComponent(fav);
  Island.init();
  App.setState('idle');
  $('#app-version').textContent = VERSION;
  installable();
  $('#btn-news').addEventListener('click', () => News.open());
  $('#news-link').hidden = !NOUVEAUTES.some(n => n.v === VERSION && pourIci(n)); /* rien de neuf ici : pas de lien */
  const nouveau = News.pending();
  if (nouveau.length) setTimeout(() => News.open(nouveau), 600); /* après l'ouverture : la page se pose d'abord */
  UI.renderShortcut();
  UI.renderChips();
  UI.renderLast();
  bind();
  updateThemeColor();
  route();
  loadHistory();
  Mics.refresh().then(() => { UI.renderMics(); UI.renderChips(); });
  if (Desktop) wireDesktop();
  /* progrès : un autre onglet ou la bulle (bureau) a compté une dictée */
  addEventListener('storage', e => { if (e.key === STATS_KEY || e.key == null) UI.renderProgress(); });
  window.Verbe = { App, Island, Settings, Store, Float, Rec, applyVoiceCommands, polishText, toAccel, splitAtSilences, encodeWav, analyzeSpeech, cleanTranscript }; /* pour les tests */
  Object.assign(window.Verbe, { silenceSpans, trimSilences, TRIM }); /* silences coupés avant l'envoi */
  Object.assign(window.Verbe, { News, NOUVEAUTES, VERSION, loadHistory }); /* nouveautés, historique (tests) */
  window.Verbe.Stats = Stats; /* progrès, pour les tests */
  Object.assign(window.Verbe, { fixWords, wordsPrompt, wholeSnippet, insertSnippets }); /* Mes mots, pour les tests */
  Object.assign(window.Verbe, { appCategory, llmPlan, llmPrompt }); /* traduction et ton selon l'app (tests) */
  Object.assign(window.Verbe, { UI, rewriteText, REWRITE_PROMPT }); /* raccourcis Recoller et Réécrire (tests) */
}

/* App web installable (v0.6.2) : le service gardé hors connexion, et « Installer Verbe » dans Réglages › Général.
   Jamais dans l'app bureau (elle est déjà installée). */
function installable() {
  if (Desktop) return;
  const web = location.protocol === 'https:' || location.hostname === 'localhost';
  if (web && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('[Verbe] hors connexion indisponible', e));
  const dejaInstalle = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (dejaInstalle) return;
  const ligne = $('#install-row'), bouton = $('#btn-install'), aide = $('#install-help');
  let invite = null;
  /* Chrome et Edge (Android, ordi) : le navigateur propose l'installation, on la garde pour le bouton */
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); invite = e; bouton.hidden = false; ligne.hidden = false; });
  window.addEventListener('appinstalled', () => { ligne.hidden = true; Toast.show({ type: 'ok', text: 'Verbe est installé.', sub: 'Son icône est sur ton écran d’accueil.' }); });
  bouton.addEventListener('click', async () => {
    if (!invite) return;
    invite.prompt();
    const choix = await invite.userChoice.catch(() => null);
    if (choix && choix.outcome === 'accepted') ligne.hidden = true;
    invite = null;
  });
  /* iPhone et iPad (Safari) : pas d'invite, on dit le geste */
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    bouton.hidden = true;
    aide.textContent = 'Dans Safari : touche Partager, puis « Sur l’écran d’accueil ». Verbe aura son icône et s’ouvrira en plein écran.';
    ligne.hidden = false;
  }
}

init();
