import { expect, test } from 'vitest';
import { appCategory } from '@lib/apps';
import { cmpVer } from '@lib/versions';

test('catégorie de l\'app au premier plan', () => {
  expect(appCategory('OUTLOOK.EXE')).toBe('courriel');
  expect(appCategory('C:\\Program Files\\WindowsApps\\olk.exe')).toBe('courriel');
  expect(appCategory('ms-teams.exe')).toBe('messagerie');
  expect(appCategory('Code.exe')).toBe('code');
  expect(appCategory('pycharm64.exe')).toBe('code');
  expect(appCategory('chrome.exe')).toBe('autre');
  expect(appCategory('')).toBe('autre');
  expect(appCategory(undefined)).toBe('autre');
});

test('comparaison des versions', () => {
  expect(cmpVer('0.5.3', '0.5.2')).toBeGreaterThan(0);
  expect(cmpVer('0.5.2', '0.5.10')).toBeLessThan(0);
  expect(cmpVer('1.0', '1.0.0')).toBe(0);
  expect(cmpVer('0.6.0', '0.5.9')).toBeGreaterThan(0);
});
