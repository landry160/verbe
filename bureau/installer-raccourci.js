// Crée les raccourcis « Verbe » sur le Bureau et dans le menu Démarrer (Windows).
// Usage : npm run raccourci
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const ico = path.join(__dirname, 'icone.ico');
if (!fs.existsSync(exe)) { console.error('Electron manque : lance « npm install » dans ' + root); process.exit(1); }

const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const ps = `
$sh = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'))
foreach ($dir in $targets) {
  $lnk = $sh.CreateShortcut((Join-Path $dir 'Verbe.lnk'))
  $lnk.TargetPath = ${q(exe)}
  $lnk.Arguments = '"' + ${q(root)} + '"'
  $lnk.WorkingDirectory = ${q(root)}
  $lnk.IconLocation = ${q(ico)}
  $lnk.Description = 'Verbe : dictée vocale (Ctrl + Maj + L)'
  $lnk.Save()
  Write-Output ('Raccourci créé : ' + (Join-Path $dir 'Verbe.lnk'))
}`;
console.log(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim());
