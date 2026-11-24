/* Ton selon l'app (bureau) : le nom du programme au premier plan → sa catégorie. Logique pure. */

export type Categorie = 'courriel' | 'messagerie' | 'code' | 'autre';

/** nom du programme (« OUTLOOK.EXE », « olk.exe »…) → courriel, messagerie, code ou autre */
export const TONE_APPS: Record<Exclude<Categorie, 'autre'>, string[]> = {
  courriel: ['outlook.exe', 'olk.exe', 'hxoutlook.exe', 'winword.exe', 'thunderbird.exe', 'onenote.exe', 'soffice.bin', 'swriter.exe', 'wps.exe', 'mailbird.exe', 'emclient.exe'],
  messagerie: ['ms-teams.exe', 'teams.exe', 'slack.exe', 'discord.exe', 'whatsapp.exe', 'whatsapp.root.exe', 'telegram.exe', 'signal.exe', 'messenger.exe', 'skype.exe', 'element.exe', 'mattermost.exe'],
  code: ['code.exe', 'code - insiders.exe', 'cursor.exe', 'windsurf.exe', 'zed.exe', 'devenv.exe', 'studio64.exe', 'sublime_text.exe', 'notepad++.exe', 'windowsterminal.exe', 'wt.exe', 'openconsole.exe', 'conhost.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'powershell_ise.exe', 'wsl.exe', 'bash.exe', 'mintty.exe', 'wezterm-gui.exe', 'alacritty.exe', 'putty.exe'],
};

export function appCategory(exe: unknown): Categorie {
  const n = (String(exe || '').split(/[\\/]/).pop() || '').trim().toLowerCase();
  if (!n) return 'autre';
  for (const [cat, list] of Object.entries(TONE_APPS) as [Exclude<Categorie, 'autre'>, string[]][]) if (list.includes(n)) return cat;
  /* JetBrains : idea64.exe, pycharm64.exe, webstorm64.exe, rider64.exe… */
  if (/^(idea|pycharm|webstorm|phpstorm|rider|clion|goland|rubymine|datagrip|dataspell|fleet|rustrover|aqua)(64)?\.exe$/.test(n)) return 'code';
  return 'autre';
}
