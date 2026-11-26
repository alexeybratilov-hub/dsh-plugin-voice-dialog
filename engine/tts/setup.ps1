# Installs the local Silero Russian speech runtime used by the voice dialog
# plugin. Everything is written inside this directory, so the plugin stays
# self-contained and can be moved or deleted as one folder.
#
# Run once after the bundle is installed:
#   pwsh -File engine/tts/setup.ps1
#
# Afterwards `engine/tts/.venv/Scripts/python.exe` runs `silero_worker.py`
# offline; no other network access happens at speech time.

param(
  [string]$Python = ''
)

$ErrorActionPreference = 'Stop'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $Here '.venv'
$VenvPython = Join-Path $Venv 'Scripts\python.exe'
$Models = Join-Path $Here 'models'
$Runtime = Join-Path $Here 'runtime'
$Model = Join-Path $Models 'v5_6_ru.pt'
$ModelUrl = 'https://models.silero.ai/models/tts/ru/v5_6_ru.pt'

function Find-Python {
  if ($Python -ne '') { return $Python }
  $bundled = Get-ChildItem -Path (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes') -Filter 'python.exe' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\dependencies\\python\\python\.exe$' } |
    Select-Object -First 1
  if ($bundled) { return $bundled.FullName }
  $onPath = Get-Command python -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  throw 'Python 3.10+ not found. Pass -Python <path to python.exe>.'
}

New-Item -ItemType Directory -Force -Path $Models | Out-Null

if (-not (Test-Path $VenvPython)) {
  $base = Find-Python
  Write-Host "Creating the virtual environment with $base"
  & $base -m venv $Venv
}

Write-Host 'Installing the CPU build of PyTorch 2.2.2 and numpy 1.26.4'
& $VenvPython -m pip install --disable-pip-version-check --no-input --upgrade pip
& $VenvPython -m pip install --disable-pip-version-check --no-input 'torch==2.2.2' --index-url https://download.pytorch.org/whl/cpu
& $VenvPython -m pip install --disable-pip-version-check --no-input 'numpy==1.26.4'

# PyTorch needs the Visual C++ runtime next to c10.dll; the redistributable is
# not always installed on the machine, so the plugin ships an app-local copy.
$TorchLib = Join-Path $Venv 'Lib\site-packages\torch\lib'
if (Test-Path $TorchLib) {
  Get-ChildItem -Path $Runtime -Filter '*.dll' -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $TorchLib $_.Name) -Force
  }
}

if (-not (Test-Path $Model)) {
  Write-Host 'Downloading the Silero v5_6_ru voice model (about 140 MB)'
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $ModelUrl -OutFile $Model -UseBasicParsing
}

$probe = @'
import json
import subprocess
import sys
import time

started = time.time()
process = subprocess.Popen([sys.executable, "silero_worker.py"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
line = process.stdout.readline()
reply = json.loads(line)
process.kill()
reply["seconds"] = round(time.time() - started, 1)
print(json.dumps(reply, ensure_ascii=False))
'@

Push-Location $Here
try {
  Write-Host 'Loading the model once to verify the runtime'
  $probe | & $VenvPython -
} finally {
  Pop-Location
}

Write-Host 'Silero speech is ready.'
