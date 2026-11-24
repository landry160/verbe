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
  $('#btn-news').addEventListener('click', () => News.open());
  $('#news-link').hidden = !NOUVEAUTES.some(n => n.v === VERSION && (Desktop || !n.desk)); /* rien de neuf ici : pas de lien */
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

init();
