import { describe, expect, test } from 'vitest';
import { applyVoiceCommands, cleanTranscript, countWords } from '@lib/texte';

describe('commandes à la voix', () => {
  // [ce que Whisper renvoie, ce que Verbe doit écrire]
  const cas: [string, string][] = [
    ['Bonjour, virgule, comment ça va, point d\'interrogation.', 'Bonjour, comment ça va?'],
    ['Premier point. Nouvelle ligne. Deuxième point.', 'Premier point.\nDeuxième point.'],
    ['Liste point à la ligne suite', 'Liste.\nSuite'],
    ['Ligne un retour à la ligne ligne deux', 'Ligne un\nLigne deux'],
    ['Intro. Nouveau paragraphe. Corps du texte.', 'Intro.\n\nCorps du texte.'],
    ['Il a fini point-virgule ensuite on part', 'Il a fini; ensuite on part'],
    ['Quelle surprise point d\'exclamation', 'Quelle surprise!'],
    ['Fin du texte point final', 'Fin du texte.'],
    ['Il a dit ouvrez les guillemets oui fermez les guillemets ensuite', 'Il a dit « oui » ensuite'],
    ['Je pars demain. Je reste ici. Efface ça. Je rentre lundi.', 'Je pars demain. Je rentre lundi.'],
    ['Mettre au point le projet, c\'est à la ligne de départ que tout commence.', 'Mettre au point le projet, c\'est à la ligne de départ que tout commence.'],
    ['Un texte sans aucune commande.', 'Un texte sans aucune commande.'],
  ];
  test.each(cas)('« %s »', (dit, attendu) => {
    expect(applyVoiceCommands(dit)).toBe(attendu);
  });
  test('rien à faire : le texte est rendu tel quel, même vide', () => {
    expect(applyVoiceCommands('')).toBe('');
    expect(applyVoiceCommands(null)).toBe('');
  });
});

describe('nettoyage de la transcription', () => {
  test('retire les guillemets autour et les « sous-titres » inventés par Whisper', () => {
    expect(cleanTranscript('« Bonjour à tous. »')).toBe('Bonjour à tous.');
    expect(cleanTranscript('Merci. Sous-titrage Société Radio-Canada.')).toBe('Merci.');
    expect(cleanTranscript('Bonjour.   Sous-titres réalisés par la communauté d\'Amara.org')).toBe('Bonjour.');
  });
  test('resserre les espaces et les lignes vides, garde le reste', () => {
    expect(cleanTranscript('Un  deux\r\n\n\n\ntrois')).toBe('Un deux\n\ntrois');
    expect(cleanTranscript('Le sous-titre du film est beau.')).toBe('Le sous-titre du film est beau.');
  });
});

test('compte des mots', () => {
  expect(countWords('  Bonjour, ceci est  un test. ')).toBe(5);
  expect(countWords('')).toBe(0);
});
