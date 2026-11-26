# Источники движков

Всё скачано с GitHub, Hugging Face и серверов Silero при создании плагина и лежит в каталоге `engine/`:

| Компонент | Источник | SHA-256 |
|---|---|---|
| sherpa-onnx v2.0.3, Windows x64, shared MT | https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.3/sherpa-onnx-v2.0.3-win-x64-shared-MT-Release.tar.bz2 | — |
| Whisper small, encoder int8 | https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-encoder.int8.onnx | `4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9` |
| Whisper small, decoder int8 | https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-decoder.int8.onnx | `acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee` |
| Whisper small, tokens | https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/small-tokens.txt | `b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126` |
| Piper 2023.11.14-2, Windows amd64 | https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip | `f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea` |
| Голос `ru_RU-irina-medium` | https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx | `8ff38212d23da300bbe3705c645e6e5b9475f0bfde01558eb17813e22acaaaaa` |
| Silero `v5_6_ru` | https://models.silero.ai/models/tts/ru/v5_6_ru.pt | — |
| Silero `v5_5_ru` (запасная) | https://models.silero.ai/models/tts/ru/v5_5_ru.pt | — |
| Silero `v4_ru` (запасная) | https://models.silero.ai/models/tts/ru/v4_ru.pt | — |
| PyTorch 2.2.2+cpu | https://download.pytorch.org/whl/cpu | — |
| numpy 1.26.4 | https://pypi.org/project/numpy/1.26.4/ | — |

Модели Silero — это архивы `torch.package`, а не TorchScript-файлы: воркер загружает их через `torch.package.PackageImporter(...).load_pickle("tts_models", "model")`.

## Среда выполнения C++

`msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll` взяты из распространяемых копий, поставляемых с Python-пакетами DeepSeek Harness и с Piper; `vcruntime140_threads.dll` — из пакета `NtvLibs.MSVCP.vcruntime140_threads.runtime.win-x64` 14.52.37029 на nuget.org (https://api.nuget.org/v3-flatcontainer/ntvlibs.msvcp.vcruntime140_threads.runtime.win-x64/14.52.37029/). Копии лежат в `engine/tts/runtime/` и при установке кладутся рядом с `torch\lib`: Windows иначе не находит зависимость `c10.dll` на машинах без пакета Visual C++ Redistributable. Это app-local развёртывание распространяемого пакета Visual C++.

## Лицензии

- sherpa-onnx — Apache-2.0.
- Whisper (модель и веса) — MIT.
- Piper — MIT.
- Голос `ru_RU-irina-medium` — CC BY-NC-SA 4.0 (некоммерческое использование).
- Silero Models, включая `v5_6_ru`, `v5_5_ru`, `v4_ru` — CC BY-NC 4.0 (некоммерческое использование).
- PyTorch — BSD-3-Clause.
- numpy — BSD-3-Clause.
