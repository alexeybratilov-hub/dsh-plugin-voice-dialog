# Собирает распространяемый пакет плагина: код, документацию и скрипты
# установки без моделей и без venv.
#
#   pwsh -NoProfile -File scripts/build-package.ps1
#
# Результат: dist/dsh-plugin-voice-dialog-<версия>.tgz — архив в формате npm,
# из которого модели ставятся скриптами setup-models.ps1 и setup.ps1.
#
# Рабочая копия плагина не меняется: имя пакета для публикации подставляется
# только внутри архива.

param(
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path (Join-Path $Here '..')
if ($OutDir -eq '') { $OutDir = Join-Path $Root 'dist' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$manifest = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$version = $manifest.version
$publishName = 'dsh-plugin-voice-dialog'

$stage = Join-Path ([IO.Path]::GetTempPath()) ("vd-package-" + [guid]::NewGuid().ToString('N'))
$packageDir = Join-Path $stage 'package'
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

function Copy-Pattern([string]$pattern) {
  $full = Join-Path $Root $pattern
  Get-ChildItem -Path (Split-Path -Parent $full) -Filter (Split-Path -Leaf $full) -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $packageDir $_.Name) -Force
  }
}

# Файлы из манифеста (files), кроме каталогов с моделями.
foreach ($entry in $manifest.files) {
  $source = Join-Path $Root $entry
  if ($entry -match '\*') {
    Get-ChildItem -Path $Root -Recurse -File -Filter (Split-Path -Leaf $entry) -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '\\engine\\(models|tts\\models|tts\\\.venv|_disabled|tmp)\\|\\node_modules\\|\\dist\\' } |
      ForEach-Object {
        $relative = $_.FullName.Substring($Root.Path.Length).TrimStart('\')
        $target = Join-Path $packageDir $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        Copy-Item $_.FullName $target -Force
      }
    continue
  }
  if (Test-Path $source -PathType Container) {
    Get-ChildItem $source -Recurse -File | Where-Object { $_.FullName -notmatch '\\.venv\\|\\models\\|__pycache__' } | ForEach-Object {
      $relative = $_.FullName.Substring($Root.Path.Length).TrimStart('\')
      $target = Join-Path $packageDir $relative
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
      Copy-Item $_.FullName $target -Force
    }
  } elseif (Test-Path $source) {
    $target = Join-Path $packageDir $entry
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item $source $target -Force
  }
}

# package.json для архива: имя для публикации, без private.
$shipped = Get-Content (Join-Path $packageDir 'package.json') -Raw | ConvertFrom-Json
$shipped.name = $publishName
$shipped.PSObject.Properties.Remove('private')
$shipped | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $packageDir 'package.json') -Encoding UTF8

$archive = Join-Path $OutDir ("{0}-{1}.tgz" -f $publishName, $version)
if (Test-Path $archive) { Remove-Item $archive -Force }
& tar.exe -czf $archive -C $stage package
if ($LASTEXITCODE -ne 0) { throw 'не удалось собрать архив' }

$size = (Get-Item $archive).Length
$count = (Get-ChildItem $packageDir -Recurse -File).Count
Remove-Item $stage -Recurse -Force

Write-Host ''
Write-Host ("Готово: {0}" -f $archive)
Write-Host ("Файлов: {0}, размер: {1:N1} КБ" -f $count, ($size / 1KB))
Write-Host ''
Write-Host 'Установка у получателя:'
Write-Host ("  dsh plugin add {0}   (или распаковать и подключить как bundle)" -f $archive)
Write-Host '  pwsh -NoProfile -File scripts/setup-models.ps1'
Write-Host '  pwsh -NoProfile -File engine/tts/setup.ps1'
Write-Host '  node scripts/doctor.mjs'
