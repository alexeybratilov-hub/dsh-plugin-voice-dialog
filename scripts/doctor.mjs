#!/usr/bin/env node
// Проверка окружения плагина: что найдено, чего не хватает и что делать.
//
//   node scripts/doctor.mjs
//
// Ничего не меняет — только читает файлы и один раз запускает Python-воркер.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const ENGINE = join(ROOT, 'engine')
const MODELS = join(ENGINE, 'models')
const TTS = join(ENGINE, 'tts')
const VENV = join(TTS, '.venv', 'Scripts', 'python.exe')

const problems = []
const notes = []

function check(label, path, hint, required = true) {
  const ok = existsSync(path)
  const size = ok ? statSync(path).size : 0
  const human = ok ? `${(size / 1048576).toFixed(1)} МБ` : 'НЕТ'
  console.log(`${ok ? '✔' : '✖'} ${label}: ${human}`)
  if (!ok) {
    if (required) problems.push(`${label}: ${hint}`)
    else notes.push(`${label}: ${hint}`)
  }
  return ok
}

console.log(`Плагин: ${ROOT}`)
console.log(`Node: ${process.version}\n`)

console.log('Веб-клиент')
check('index.js', join(ROOT, 'index.js'), 'файл плагина отсутствует — поставьте пакет целиком')
check('client.js', join(ROOT, 'client.js'), 'файл плагина отсутствует — поставьте пакет целиком')
check('cordis.patch.yml', join(ROOT, 'cordis.patch.yml'), 'без него плагин не подключится к профилю')
console.log('')

console.log('Синтез речи (Silero)')
const hasVenv = check('python в venv', VENV, 'запустите pwsh -File engine/tts/setup.ps1')
check('воркер silero_worker.py', join(TTS, 'silero_worker.py'), 'файл пакета')
check('модель v5_6_ru.pt', join(TTS, 'models', 'v5_6_ru.pt'), 'скачайте: engine/tts/setup.ps1 сделает это сам')
check('числа словами', join(TTS, 'numerals_ru.py'), 'файл пакета')
check('транслит английского', join(TTS, 'translit_en.py'), 'файл пакета')
console.log('')

console.log('Распознавание и VAD')
check('Whisper small int8', join(MODELS, 'sherpa-whisper-small', 'small-encoder.int8.onnx'), 'pwsh -File scripts/setup-models.ps1')
check('Whisper токены', join(MODELS, 'sherpa-whisper-small', 'small-tokens.txt'), 'pwsh -File scripts/setup-models.ps1')
check('VAD silero_vad.onnx', join(MODELS, 'vad', 'silero_vad.onnx'), 'pwsh -File scripts/setup-models.ps1')
check('sherpa-onnx бинарник', join(ENGINE, 'sherpa-onnx-v2.0.3-win-x64-shared-MT-Release', 'bin'), 'pwsh -File scripts/setup-models.ps1')
console.log('')

console.log('Детектор имени')
check('потоковая модель ru', join(MODELS, 'sherpa-streaming-ru', 'encoder.int8.onnx'), 'pwsh -File scripts/setup-models.ps1')
const kwsWeights = [
  join(ENGINE, '..', 'kws', 'model2', 'kws.pt'),
  join(process.env.LOCALAPPDATA ?? '', 'kws', 'model2', 'kws.pt'),
]
const hasKws = kwsWeights.some(existsSync)
console.log(`${hasKws ? '✔' : '·'} веса KWS-модели: ${hasKws ? 'найдены' : 'нет (работает потоковый детектор по тексту)'}`)
console.log('')

console.log('Английская озвучка (необязательно)')
check('словарь CMU', join(MODELS, 'english', 'cmudict.dict'), 'pwsh -File scripts/setup-models.ps1', false)
check('Piper exe', join(ENGINE, '_disabled', 'piper', 'piper', 'piper.exe'), 'необязательно: режим VOICE_EN_MODE=piper', false)
console.log('')

if (hasVenv) {
  console.log('Проверка воркера (одна загрузка модели, ~10 с)')
  const probe = spawnSync(VENV, ['-c', 'import torch, numpy; print("torch", torch.__version__, "numpy", numpy.__version__)'], {
    cwd: TTS,
    encoding: 'utf8',
    timeout: 120000,
  })
  if (probe.status === 0) {
    console.log(`✔ ${probe.stdout.trim()}`)
  } else {
    console.log('✖ воркер не запускается')
    const why = (probe.stderr || '').trim().split('\n').slice(-3).join(' ')
    if (why) console.log(`  ${why}`)
    problems.push('Python-воркер не запускается: проверьте Visual C++ Runtime x64 и переустановите venv')
  }
  console.log('')
}

if (notes.length > 0) {
  console.log('Необязательное:')
  for (const note of notes) console.log(`  · ${note}`)
  console.log('')
}

if (problems.length === 0) {
  console.log('Всё на месте. Подключите плагин к профилю DSH и перезапустите приложение.')
  process.exit(0)
}

console.log('Нужно исправить:')
for (const problem of problems) console.log(`  ✖ ${problem}`)
process.exit(1)
