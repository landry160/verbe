/* Numéros de version « 0.5.3 » : logique pure. */

/** négatif si a < b, 0 si égaux, positif si a > b (trois nombres au plus) */
export const cmpVer = (a: string, b: string): number => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
