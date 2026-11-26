# Downloads the speech models the plugin needs and lays them out next to the
# code. Everything goes into <plugin>/engine, so the folder stays portable.
#
#   pwsh -NoProfile -File scripts/setup-models.ps1
#
# Total download is about 600 MB; the files are downloaded once and reused.

param(
  [switch]$SkipSherpaBinary,
  [switch]$SkipWhisper,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Engine = Resolve-Path (Join-Path $Here '..\engine')
$Models = Join-Path $Engine 'models'
$Temp = Join-Path ([IO.Path]::GetTempPath()) 'voice-dialog-models'
New-Item -ItemType Directory -Force -Path $Models, $Temp | Out-Null

$ProgressPreference = 'SilentlyContinue'

function Get-File([string]$Url, [string]$Target) {
  if ((Test-Path $Target) -and -not $Force) {
    Write-Host "  уже есть: $(Split-Path -Leaf $Target)"
    return
  }
  Write-Host "  скачиваю: $(Split-Path -Leaf $Target)"
  & curl.exe -4 -L --fail --retry 2 --max-time 3600 -o $Target $Url
  if ($LASTEXITCODE -ne 0) { throw "не удалось скачать $Url" }
}

function Expand-Archive2([string]$Archive) {
  $dir = Join-Path $Temp ([IO.Path]::GetFileNameWithoutExtension([IO.Path]::GetFileNameWithoutExtension($Archive)))
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  & tar.exe -xf $Archive -C $dir
  if ($LASTEXITCODE -ne 0) { throw "не удалось распаковать $Archive" }
  return $dir
}

function Find-First([string]$Root, [string]$Name) {
  return (Get-ChildItem -Path $Root -Recurse -File -Filter $Name -ErrorAction SilentlyContinue | Select-Object -First 1)
}

# 1. sherpa-onnx: offline (Whisper) and streaming (KWS fallback) binaries.
if (-not $SkipSherpaBinary) {
  $binaryDir = Join-Path $Engine 'sherpa-onnx-v2.0.3-win-x64-shared-MT-Release'
  if (-not (Test-Path $binaryDir)) {
    Write-Host 'sherpa-onnx 2.0.3 (Windows x64)'
    $archive = Join-Path $Temp 'sherpa-onnx-win.tar.bz2'
    Get-File 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.3/sherpa-onnx-v2.0.3-win-x64-shared-MT-Release.tar.bz2' $archive
    $dir = Expand-Archive2 $archive
    $found = Get-ChildItem -Path $dir -Directory | Select-Object -First 1
    if ($found) { Move-Item $found.FullName $binaryDir -Force } else { throw 'в архиве sherpa-onnx нет каталога' }
  } else {
    Write-Host 'sherpa-onnx: уже есть'
  }
}

# 2. Whisper small int8 — запасное распознавание, когда хост-провайдер молчит.
if (-not $SkipWhisper) {
  $whisperDir = Join-Path $Models 'sherpa-whisper-small'
  $encoder = Join-Path $whisperDir 'small-encoder.int8.onnx'
  if (-not (Test-Path $encoder)) {
    Write-Host 'Whisper small int8 (357 МБ)'
    $archive = Join-Path $Temp 'whisper-small.tar.bz2'
    Get-File 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2' $archive
    $dir = Expand-Archive2 $archive
    New-Item -ItemType Directory -Force -Path $whisperDir | Out-Null
    foreach ($pair in @(
        @('small-encoder.int8.onnx', 'small-encoder.int8.onnx'),
        @('small-decoder.int8.onnx', 'small-decoder.int8.onnx'),
        @('small-tokens.txt', 'small-tokens.txt'),
        @('tokens.txt', 'small-tokens.txt')
      )) {
      $source = Find-First $dir $pair[0]
      if ($source) { Copy-Item $source.FullName (Join-Path $whisperDir $pair[1]) -Force }
    }
  } else {
    Write-Host 'Whisper small: уже есть'
  }
}

# 3. Потоковая модель для детектора имени (fallback, если KWS-весов нет).
$streamDir = Join-Path $Models 'sherpa-streaming-ru'
if (-not (Test-Path (Join-Path $streamDir 'encoder.int8.onnx'))) {
  Write-Host 'Потоковая zipformer small ru (28 МБ)'
  $archive = Join-Path $Temp 'streaming-ru.tar.bz2'
  Get-File 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16.tar.bz2' $archive
  $dir = Expand-Archive2 $archive
  New-Item -ItemType Directory -Force -Path $streamDir | Out-Null
  foreach ($name in 'encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx', 'tokens.txt') {
    $source = Find-First $dir $name
    if ($source) { Copy-Item $source.FullName (Join-Path $streamDir $name) -Force } else { throw "нет файла $name в архиве" }
  }
} else {
  Write-Host 'Потоковая модель: уже есть'
}

# 4. VAD Silero — определение речи и конца фразы.
$vadDir = Join-Path $Models 'vad'
New-Item -ItemType Directory -Force -Path $vadDir | Out-Null
Get-File 'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx' (Join-Path $vadDir 'silero_vad.onnx')

# 5. Словарь произношения для английских слов.
$englishDir = Join-Path $Models 'english'
New-Item -ItemType Directory -Force -Path $englishDir | Out-Null
Get-File 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict' (Join-Path $englishDir 'cmudict.dict')

Write-Host ''
Write-Host 'Модели на месте. Дальше:'
Write-Host '  1) pwsh -NoProfile -File engine/tts/setup.ps1   (Silero TTS и venv)'
Write-Host '  2) node scripts/doctor.mjs                       (проверка окружения)'
