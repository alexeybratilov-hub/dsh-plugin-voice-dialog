/**
 * Потоковый детектор кодового слова + VAD.
 *
 * Звук приходит кусками по ~100 мс (PCM16LE 16 кГц). Внутри:
 *   1. Silero VAD решает, где речь, а где тишина;
 *   2. распознавание (streaming zipformer ru) гоняется только на речи —
 *      это снимает постоянную нагрузку и убирает ложные срабатывания на шум;
 *   3. к началу речи досылается небольшой «преролл», чтобы не отрезать первое
 *      слово.
 *
 * Клиент получает частичный текст (для сигнала на имя) и состояние речи
 * (speech/silenceMs) — по нему закрывается окно прослушивания без порога по
 * громкости.
 *
 * Модели: engine/models/sherpa-streaming-ru, engine/models/vad/silero_vad.onnx.
 */
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { homedir } from 'node:os'

const MODEL_FILES = ['encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx', 'tokens.txt']
const VAD_FILE = 'silero_vad.onnx'
const WINDOW = 512
const PREROLL = 8
const TAIL_MS = 260
const MAX_STREAMS = 4

/** Найти sherpa-onnx-node: он стоит в профиле DSH как зависимость штатного распознавания. */
function resolveSherpa() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profiles = join(dshHome, 'profiles')
  let names = []
  try {
    names = readdirSync(profiles, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch { /* профилей может не быть */ }
  for (const name of names) {
    try {
      return createRequire(join(profiles, name, 'noop.js'))('sherpa-onnx-node')
    } catch { /* пробуем следующий профиль */ }
  }
  try {
    return createRequire(import.meta.url)('sherpa-onnx-node')
  } catch {
    return undefined
  }
}

export class WakeStreamer {
  /**
   * @param {object} options
   * @param {string} options.modelDir — каталог streaming-модели (ASCII-путь).
   * @param {string} options.vadModel — файл silero_vad.onnx (ASCII-путь).
   * @param {number} [options.threads]
   */
  constructor({ modelDir, vadModel, threads = 2 }) {
    this.modelDir = modelDir
    this.vadModel = vadModel
    this.threads = threads
    this.recognizer = undefined
    this.sherpa = undefined
    this.streams = new Map()
  }

  get available() {
    return MODEL_FILES.every(file => existsSync(join(this.modelDir, file)))
  }

  get vadAvailable() {
    return Boolean(this.vadModel) && existsSync(this.vadModel)
  }

  ensure() {
    if (this.recognizer) return this.recognizer
    if (!this.available) throw new Error(`no streaming model in ${this.modelDir}`)
    const sherpa = resolveSherpa()
    if (!sherpa) throw new Error('sherpa-onnx-node недоступен')
    this.sherpa = sherpa
    const file = name => join(this.modelDir, name)
    this.recognizer = new sherpa.OnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: file('encoder.int8.onnx'),
          decoder: file('decoder.onnx'),
          joiner: file('joiner.int8.onnx'),
        },
        tokens: file('tokens.txt'),
        numThreads: this.threads,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
      enableEndpoint: false,
    })
    return this.recognizer
  }

  /** Состояние одного потока: распознаватель, VAD и буферы. */
  createState(key) {
    // Для записи (ключ «rec-…») нужен только VAD: точный текст всё равно
    // распознаётся целиком после остановки, а потоковое распознавание там
    // только грело бы процессор.
    const recognize = !key.startsWith('rec-')
    const recognizer = recognize ? this.ensure() : undefined
    const state = {
      key,
      recognize,
      recognizer,
      stream: recognize ? recognizer.createStream() : undefined,
      vad: undefined,
      pending: new Float32Array(0),
      preroll: [],
      inSpeech: false,
      lastSpeechAt: 0,
      spoken: false,
      text: '',
    }
    if (this.vadAvailable) {
      try {
        state.vad = new this.sherpa.Vad({
          sileroVad: {
            model: this.vadModel,
            threshold: 0.5,
            minSilenceDuration: 0.25,
            minSpeechDuration: 0.1,
            windowSize: WINDOW,
          },
          sampleRate: 16000,
          numThreads: 1,
          debug: 0,
        }, 10)
      } catch { /* без VAD работаем по распознаванию */ }
    }
    this.streams.set(key, state)
    while (this.streams.size > MAX_STREAMS) {
      const oldest = this.streams.keys().next().value
      if (oldest === key) break
      this.streams.delete(oldest)
    }
    return state
  }

  feed(state, window) {
    if (!state.stream || state.skipAsr) return
    state.stream.acceptWaveform({ samples: window, sampleRate: 16000 })
    while (state.recognizer.isReady(state.stream)) state.recognizer.decode(state.stream)
    const result = state.recognizer.getResult(state.stream)
    if (typeof result?.text === 'string' && result.text !== '') state.text = result.text
  }

  /**
   * @param {string} key — ключ окна прослушивания.
   * @param {Buffer} buffer — PCM16LE 16 кГц.
   * @returns {{ text: string, speech: boolean, silenceMs: number, spoken: boolean }}
   */
  push(key, buffer, options = {}) {
    let state = this.streams.get(key)
    if (!state) state = this.createState(key)
    // Когда имя ловит своя KWS-модель, декодировать текст в этом же проходе
    // незачем: VAD остаётся, распознавание не тратит ядро.
    state.skipAsr = options.skipAsr === true
    const count = Math.floor(buffer.length / 2)
    if (count > 0) {
      const incoming = new Float32Array(count)
      for (let index = 0; index < count; index += 1) incoming[index] = buffer.readInt16LE(index * 2) / 32768
      const merged = new Float32Array(state.pending.length + incoming.length)
      merged.set(state.pending)
      merged.set(incoming, state.pending.length)
      state.pending = merged
    }
    const now = Date.now()
    while (state.pending.length >= WINDOW) {
      const window = state.pending.slice(0, WINDOW)
      state.pending = state.pending.slice(WINDOW)
      let detected = true
      if (state.vad) {
        state.vad.acceptWaveform(window)
        detected = state.vad.isDetected()
      }
      if (detected) {
        if (!state.inSpeech) {
          // Начало речи: досылаем преролл, чтобы не отрезать первое слово.
          for (const saved of state.preroll) this.feed(state, saved)
          state.preroll = []
        }
        state.inSpeech = true
        state.spoken = true
        state.lastSpeechAt = now
        this.feed(state, window)
        continue
      }
      if (state.inSpeech) {
        if (now - state.lastSpeechAt > TAIL_MS) state.inSpeech = false
        else this.feed(state, window)
        continue
      }
      state.preroll.push(window)
      if (state.preroll.length > PREROLL) state.preroll.shift()
    }
    return {
      text: state.text,
      speech: state.inSpeech,
      silenceMs: state.lastSpeechAt === 0 ? 0 : Math.max(0, now - state.lastSpeechAt),
      spoken: state.spoken,
    }
  }

  reset(key) {
    this.streams.delete(key)
  }
}
