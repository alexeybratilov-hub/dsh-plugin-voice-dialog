# Установка

Плагин состоит из кода (лёгкий) и голосовых движков (тяжёлые). Код ставится
копированием, движки — двумя скриптами, которые скачивают модели один раз.

## 1. Куда положить папку

**Путь только ASCII, без кириллицы.** sherpa-onnx (C++) и torch читают путь в
ANSI, поэтому `C:\Ассистент\voice-dialog` превращается для них в
`C:\?????????\voice-dialog`, и плагин не находит модели.

Хорошо: `C:\dsh-plugins\voice-dialog`, `D:\apps\voice-dialog`.
Плохо: `C:\Ассистент\voice-dialog`, `C:\Users\Иван\…`.

Если папка всё же лежит в кириллице, плагин сам создаёт ASCII-джанкшен
`%LOCALAPPDATA%\voice-dialog-engine` → `<плагин>\engine` и отдаёт движкам путь
через него. Это работает, но при переносе папки джанкшен нужно пересоздать
(перезапуск DSH делает это автоматически).

## 2. Голосовой рантайм (Silero)

```powershell
pwsh -NoProfile -File engine/tts/setup.ps1
```

Скрипт создаёт `engine/tts/.venv`, ставит torch 2.2.2+cpu и numpy 1.26.4,
скачивает модель `v5_6_ru.pt` (140 МБ) и один раз загружает её для проверки.
Если torch не стартует с ошибкой `0xC0000135` или «не найден msvcp140.dll» —
нет Visual C++ Runtime x64: поставьте
`winget install Microsoft.VCRedist.2015+.x64` или положите `msvcp140.dll`,
`vcruntime140.dll`, `vcruntime140_1.dll` в `engine/tts/runtime/` и повторите
скрипт (он копирует их рядом с `c10.dll`).

Своя версия Python:

```powershell
pwsh -NoProfile -File engine/tts/setup.ps1 -Python C:\Python311\python.exe
```

## 3. Модели

```powershell
pwsh -NoProfile -File scripts/setup-models.ps1
```

Скачивает и раскладывает:

| Что | Куда | Размер |
|---|---|---|
| sherpa-onnx 2.0.3 win-x64 | `engine/sherpa-onnx-v2.0.3-win-x64-shared-MT-Release/` | ≈ 60 МБ |
| Whisper small int8 + токены | `engine/models/sherpa-whisper-small/` | 357 МБ |
| Потоковая zipformer small ru (vosk int8) | `engine/models/sherpa-streaming-ru/` | 28 МБ |
| VAD Silero | `engine/models/vad/silero_vad.onnx` | 0,6 МБ |
| CMU Pronouncing Dictionary | `engine/models/english/cmudict.dict` | 3,5 МБ |

Вручную те же файлы берутся здесь:

- sherpa-onnx: <https://github.com/k2-fsa/sherpa-onnx/releases/tag/v2.0.3> →
  `sherpa-onnx-v2.0.3-win-x64-shared-MT-Release.tar.bz2`
- Whisper: <https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models> →
  `sherpa-onnx-whisper-small.tar.bz2`; нужны `small-encoder.int8.onnx`,
  `small-decoder.int8.onnx` и `tokens.txt` (переименовать в `small-tokens.txt`)
- Потоковая модель: там же →
  `sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16.tar.bz2`
- VAD: <https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx>
- CMUdict: <https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict>

## 4. Подключение к DSH

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@local"
New-Item -ItemType Directory -Force -Path $profile | Out-Null
cmd /c mklink /J "$profile\voice-dialog" "C:\dsh-plugins\voice-dialog"
```

Затем перезапустить DSH. В настройках плагинов появится «Голосовой диалог»;
рядом с композером — кнопка-капибара.

Если плагин ставится как bundle-пакет (`.tgz` из `npm pack`), профиль
подключает его сам, джанкшен не нужен.

## 5. Проверка

```powershell
node scripts/doctor.mjs
```

Ожидаемый вывод: все пункты с `✔` и строка «Всё на месте». Дальше:

1. Нажать капибару — кнопка станет синей (микрофон включён).
2. Сказать «Валера» — ассистент начнёт запись.
3. Сказать «который час» — ответ придёт голосом.

Вкладка «Ассистент» → статус показывает фазу, уровень микрофона, режим
распознавания и строку «Чтение: N/M».

## 6. Обновление

Заменить файлы кода, не трогая `engine/models`, `engine/tts/.venv` и
`sherpa-onnx-*`. Версия видна в `package.json` и в статусе плагина.

## Удаление

Удалить папку плагина и ссылку из `node_modules` профиля. Модели и venv лежат
внутри папки, отдельных следов в системе нет (кроме настроек в localStorage
браузера и `~/.dsh/voice-assistant.json`).
