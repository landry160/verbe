# Vision : Verbe

> À relire avant tout changement. Ce fichier change rarement : quand un changement
> contraire à la vision est décidé, on le met à jour ici.

## Intention

Parler au lieu de taper, partout : un raccourci, on parle, le texte arrive là où on écrivait.
Verbe doit être plus rapide que taper, invisible quand on ne s'en sert pas, et haut de gamme quand on le voit.

## Pour qui

- **Les gens qui écrivent beaucoup sur un ordinateur Windows** (courriels, documents, messages,
  assistants IA) et qui parlent plus vite qu'ils ne tapent, en français ou en anglais.
- **Sur téléphone ou sur un autre ordinateur**, la version web suffit : elle s'ouvre dans le navigateur.
- Chaque personne utilise sa propre clé de transcription (Groq est gratuit). Rien ne passe par un serveur de Verbe.

## Ce qui ne doit pas changer

- **Ctrl + Maj + L** démarre et arrête, partout ; **Échap** annule. Aucun raccourci qui vole le collage (Ctrl + V…).
- **La bulle** sans cadre, qui ne prend jamais le focus : une pastille sombre, le **micro rond au centre**, la voix de part et d'autre. **En bas au centre par défaut** ; Haut, Centre ou Bas au choix, toujours respectés.
- **Les trois formes de la voix : Barres (par défaut), Onde, Points**, dessinées **en ligne, exactement comme leurs images dans Réglages** (pas en couronne autour du micro).
- **Dicter tient dans un écran**, sans défilement ; on peut dicter depuis n'importe quelle page (micro rond flottant).
- **Le style cuivre**, la police Inter, le verre, le mode sombre qui suit le système.
- **Réglages : une section à la fois**, avec l'état de chaque section visible dans la colonne, sans trou. **Sur téléphone, la liste des sections d'abord**, puis une page par section avec « ‹ Réglages ».
- **Deux styles de boutons seulement** : principal (cuivre plein, un seul par écran) et secondaire (fond de surface, bordure fine, sans ombre). Le reste : des liens discrets ; un choix sélectionné a un contour fin.
- **Le compteur « Ce qu'il te reste »** dans Réglages › Transcription ; il ne s'affiche sur Dicter que lorsqu'il baisse.
- **Une seule page pour le web et le bureau** (`app/verbe.html`). Pas de cadre lourd tant qu'il n'y a pas de serveur à faire.
- **Tout reste sur l'appareil** (réglages, historique, clé) ; seul l'audio part au service de transcription choisi.

## Ce qui est hors de portée (pour l'instant)

- Comptes, synchronisation entre appareils, serveur. À revoir si Verbe doit marcher sans clé personnelle.
- Mac et téléphone en app native : le web suffit sur téléphone.

## Versions

- v0.2 : raccourci, micro flottant, mini-fenêtre, écran Dicter sans défilement.
- v0.3 : commandes à la voix, texte propre, version bureau (bulle, raccourci global, collage automatique).
- v0.4 : réglages en sections, formes de la voix dans la bulle, compteur de limite, installateur Windows.
- v0.4.4 : audit (vitesse, stabilité, accessibilité), écrans allégés, bulle en pastille en bas par défaut, deux styles de boutons, liste des réglages sur téléphone.
