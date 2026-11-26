/**
 * Host-side speech engines for the voice dialog plugin.
 *
 * ASR runs on sherpa-onnx (Whisper multilingual, ONNX, CPU) through its
 * loopback websocket server so the model stays loaded between utterances.
 * TTS runs on Silero (Russian, ONNX, CPU) in a bundled Python worker. Both
 * assets ship in the bundle's `engine` directory; nothing is downloaded while
 * the plugin runs. Piper and browser voices are intentionally not used.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SileroTts } from './silero.js'

const CHUNK_BYTES = 10240
const WORKER_START_TIMEOUT_MS = 90000
const TRANSCRIBE_TIMEOUT_MS = 120000
const SYNTHESIS_TIMEOUT_MS = 120000

/** One audio decoding or engine failure safe for the HTTP layer to report. */
export class SpeechEngineError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SpeechEngineError'
  }
}

/**
 * Parse the canonical recording the browser sends: RIFF/WAVE, PCM16, mono or
 * stereo, any sample rate accepted by sherpa's own resampler.
 * @param {Buffer} buffer - complete WAV file bytes.
 * @returns {{ sampleRate: number, samples: Float32Array }}
 */
export function decodePcm16Wave(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new SpeechEngineError('not a RIFF/WAVE recording')
  }
  let offset = 12
  let format = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let dataOffset = -1
  let dataLength = 0
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= buffer.length) {
      format = buffer.readUInt16LE(body)
      channels = buffer.readUInt16LE(body + 2)
      sampleRate = buffer.readUInt32LE(body + 4)
      bits = buffer.readUInt16LE(body + 14)
    } else if (id === 'data') {
      dataOffset = body
      dataLength = Math.min(size, buffer.length - body)
    }
    offset = body + size + (size % 2)
  }
  if (format !== 1 || bits !== 16 || channels < 1 || channels > 2) {
    throw new SpeechEngineError('recording must be PCM16 mono or stereo')
  }
  if (sampleRate < 8000 || sampleRate > 48000) throw new SpeechEngineError('unsupported sample rate')
  if (dataOffset < 0 || dataLength < 320) throw new SpeechEngineError('recording is empty')
  const frames = Math.floor(dataLength / (2 * channels))
  const samples = new Float32Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) {
      sum += buffer.readInt16LE(dataOffset + (frame * channels + channel) * 2) / 32768
    }
    samples[frame] = sum / channels
  }
  return { sampleRate, samples }
}

/**
 * Whisper слушает окно примерно в 30 секунд, поэтому длинную диктовку режем
 * на куски ~28 секунд по самому тихому месту — слова не рвутся, а весь текст
 * всё равно распознаётся за один проход и уходит одним сообщением.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {number} [maxSeconds]
 * @returns {Float32Array[]}
 */
export function splitForTranscription(samples, sampleRate, maxSeconds = 28) {
  const maxLength = Math.max(1, Math.floor(sampleRate * maxSeconds))
  if (samples.length <= maxLength) return [samples]
  const chunks = []
  let start = 0
  while (start < samples.length) {
    if (samples.length - start <= maxLength) {
      chunks.push(samples.subarray(start))
      break
    }
    const target = start + maxLength
    const searchFrom = Math.max(start + Math.floor(sampleRate * 4), target - Math.floor(sampleRate * 5))
    const cut = quietCut(samples, searchFrom, target, sampleRate)
    chunks.push(samples.subarray(start, cut))
    start = cut
  }
  return chunks
}

/** Find the quietest 20 ms frame between two positions and cut there. */
function quietCut(samples, from, to, sampleRate) {
  const frameLength = Math.max(160, Math.floor(sampleRate * 0.02))
  let best = to
  let bestRms = Number.POSITIVE_INFINITY
  for (let position = from; position + frameLength <= to; position += frameLength) {
    let sum = 0
    for (let index = position; index < position + frameLength; index++) {
      sum += samples[index] * samples[index]
    }
    const rms = Math.sqrt(sum / frameLength)
    if (rms < bestRms) {
      bestRms = rms
      best = position + frameLength
    }
  }
  return Math.max(from, Math.min(best, to))
}

/**
 * Pick an unused loopback port for the sherpa websocket server.
 * @returns {Promise<number>} free TCP port.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => { resolve(port) })
    })
  })
}

/**
 * Wait until sherpa accepts a websocket connection on its port.
 * @param {number} port
 * @param {() => boolean} isStopped
 * @returns {Promise<void>}
 */
function waitForWorker(port, isStopped) {
  const deadline = Date.now() + WORKER_START_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (isStopped()) { reject(new SpeechEngineError('speech worker stopped')); return }
      const probe = new WebSocket(`ws://127.0.0.1:${port}`)
      let settled = false
      const retry = () => {
        if (settled) return
        settled = true
        if (Date.now() > deadline) reject(new SpeechEngineError('speech worker did not start in time'))
        else setTimeout(attempt, 400)
      }
      probe.onopen = () => {
        settled = true
        try { probe.close() } catch {}
        resolve()
      }
      probe.onerror = retry
      probe.onclose = retry
    }
    attempt()
  })
}

/**
 * The bundle-owned speech engine: a lazily started sherpa ASR worker and
 * Silero synthesis on the same inference lane.
 */
export class SpeechEngine {
  /**
   * @param {object} options
   * @param {string} options.sherpaExe - sherpa-onnx-offline-websocket-server.exe
   * @param {string} options.sherpaCliExe - sherpa-onnx-offline.exe (fallback path)
   * @param {string} options.encoder - Whisper encoder ONNX file.
   * @param {string} options.decoder - Whisper decoder ONNX file.
   * @param {string} options.tokens - Whisper token table.
   * @param {object} [options.silero] - Silero Russian speech options.
   * @param {number} [options.threads] - CPU threads for inference.
   */
  constructor(options) {
    this.options = { threads: 4, ...options }
    this.worker = null
    this.disposed = false
    this.queue = Promise.resolve()
    this.mode = 'auto'
    this.lastError = ''
    const sileroOptions = options.silero
    this.silero = sileroOptions ? new SileroTts(sileroOptions) : null
  }

  /** @returns {{ asr: boolean, tts: boolean, worker: 'stopped' | 'starting' | 'ready', mode: string }} */
  status() {
    const { sherpaExe, sherpaCliExe, encoder, decoder, tokens } = this.options
    const silero = this.silero?.status() ?? null
    return {
      asr: [sherpaExe, sherpaCliExe, encoder, decoder, tokens].every(file => existsSync(file)),
      // Единственный движок озвучки — Silero. Piper и голос браузера удалены.
      tts: Boolean(silero?.available),
      worker: this.worker ? (this.worker.ready ? 'ready' : 'starting') : 'stopped',
      mode: this.mode,
      silero,
      voices: silero?.voices ?? [],
    }
  }

  /**
   * Run work on the single inference lane.
   * @template T
   * @param {() => Promise<T>} operation
   * @returns {Promise<T>}
   */
  exclusive(operation) {
    const next = this.queue.then(operation, operation)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  /**
   * Transcribe one complete recording.
   * @param {Buffer} wave - RIFF/WAVE PCM16 bytes from the browser.
   * @param {string} language - Whisper language hint, or '' for auto-detect.
   * @returns {Promise<string>} recognized text.
   */
  async transcribe(wave, language = '') {
    if (this.disposed) throw new SpeechEngineError('speech engine disposed')
    const { samples, sampleRate } = decodePcm16Wave(wave)
    const hint = language === 'auto' ? '' : language
    return await this.exclusive(async () => {
      if (this.mode !== 'cli') {
        try {
          const worker = await this.ensureWorker(hint)
          const pieces = splitForTranscription(samples, sampleRate)
          let text = ''
          for (const piece of pieces) {
            const payload = Buffer.allocUnsafe(8 + piece.length * 4)
            payload.writeInt32LE(sampleRate, 0)
            payload.writeInt32LE(piece.length * 4, 4)
            Buffer.from(piece.buffer, piece.byteOffset, piece.byteLength).copy(payload, 8)
            const reply = await this.request(worker, payload)
            const part = cleanTranscript(reply).trim()
            if (part !== '') text = text === '' ? part : `${text} ${part}`
          }
          return text
        } catch (error) {
          if (this.disposed) throw error
          this.mode = 'cli'
          this.lastError = error instanceof Error ? error.message : String(error)
          await this.stopWorker()
        }
      }
      return await this.transcribeCli(wave, hint)
    })
  }

  /**
   * Transcribe by running the one-shot sherpa CLI. This is the fallback for
   * environments where the worker's loopback socket is unreachable.
   * @param {Buffer} wave
   * @param {string} hint
   * @returns {Promise<string>}
   */
  async transcribeCli(wave, hint) {
    const { sherpaCliExe, encoder, decoder, tokens, threads } = this.options
    if (!existsSync(sherpaCliExe)) throw new SpeechEngineError(`missing speech asset: ${sherpaCliExe}`)
    const target = join(tmpdir(), `voice-dialog-${randomUUID()}.wav`)
    writeFileSync(target, wave)
    try {
      const args = [
        `--whisper-encoder=${encoder}`,
        `--whisper-decoder=${decoder}`,
        `--tokens=${tokens}`,
        `--num-threads=${threads}`,
        target,
      ]
      if (hint !== '') args.splice(3, 0, `--whisper-language=${hint}`)
      const child = spawn(sherpaCliExe, args, { cwd: this.options.workDir ?? dirname(sherpaCliExe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += String(chunk) })
      child.stderr.on('data', (chunk) => { if (stderr.length < 4000) stderr += String(chunk) })
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new SpeechEngineError('transcription timed out')) }, TRANSCRIBE_TIMEOUT_MS)
        child.on('error', (error) => { clearTimeout(timer); reject(error) })
        child.on('close', (value) => { clearTimeout(timer); resolve(value) })
      })
      const line = stdout.split('\n').map(value => value.trim()).filter(value => value.startsWith('{')).pop()
      if (code !== 0 || !line) {
        throw new SpeechEngineError(`transcription failed (${code}): ${stderr.slice(-300)}`)
      }
      return cleanTranscript(line)
    } finally {
      rmSync(target, { force: true })
    }
  }

  /**
   * Synthesize speech with Silero, the only engine this plugin uses.
   * @param {string} text - already user-facing answer text.
   * @param {{ voice?: string, speed?: number, pauses?: number }} [options]
   * @returns {Promise<Buffer>} complete WAV bytes.
   */
  async synthesize(text, options = {}) {
    if (this.disposed) throw new SpeechEngineError('speech engine disposed')
    const spoken = prepareForSpeech(text)
    if (spoken === '') throw new SpeechEngineError('nothing to speak')
    const voice = typeof options.voice === 'string' && options.voice !== '' ? options.voice : 'baya'
    if (!this.silero?.status().available) throw new SpeechEngineError('silero unavailable')
    try {
      const wave = await this.silero.synthesize(spoken, voice, { speed: options.speed, pauses: options.pauses })
      this.lastError = ''
      return wave
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  /**
   * Send one utterance to the worker and await its single JSON reply.
   * @param {object} worker
   * @param {Buffer} payload
   * @returns {Promise<string>}
   */
  request(worker, payload) {
    const socket = worker.socket
    if (!socket || worker.exited || !worker.ready) {
      return Promise.reject(new SpeechEngineError('speech worker is not running'))
    }
    return new Promise((resolve, reject) => {
      let settled = false
      const waiter = {
        resolve: (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value) },
        reject: (error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error) },
      }
      const timer = setTimeout(() => {
        const index = worker.waiters.indexOf(waiter)
        if (index >= 0) worker.waiters.splice(index, 1)
        waiter.reject(new SpeechEngineError('transcription timed out'))
      }, TRANSCRIBE_TIMEOUT_MS)
      timer.unref?.()
      worker.waiters.push(waiter)
      try {
        for (let offset = 0; offset < payload.length; offset += CHUNK_BYTES) {
          socket.send(payload.subarray(offset, Math.min(payload.length, offset + CHUNK_BYTES)))
        }
      } catch (error) {
        const index = worker.waiters.indexOf(waiter)
        if (index >= 0) worker.waiters.splice(index, 1)
        waiter.reject(error)
      }
    })
  }

  /**
   * Start the sherpa worker for one language hint, reusing it when possible.
   * @param {string} language - Whisper language hint or ''.
   */
  async ensureWorker(language) {
    const current = this.worker
    if (current && current.language === language && !current.exited) {
      if (current.ready) return current
      await current.opening
      return current
    }
    await this.stopWorker()
    const { sherpaExe, encoder, decoder, tokens, threads } = this.options
    for (const file of [sherpaExe, encoder, decoder, tokens]) {
      if (!existsSync(file)) throw new SpeechEngineError(`missing speech asset: ${file}`)
    }
    const port = await freePort()
    const args = [
      `--port=${port}`,
      '--num-work-threads=1',
      `--num-threads=${threads}`,
      `--whisper-encoder=${encoder}`,
      `--whisper-decoder=${decoder}`,
      `--tokens=${tokens}`,
    ]
    if (language !== '') args.push(`--whisper-language=${language}`)
    const child = spawn(sherpaExe, args, {
      cwd: this.options.workDir ?? dirname(sherpaExe),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const log = []
    child.stderr.on('data', (chunk) => { if (log.length < 400) log.push(String(chunk)) })
    const worker = {
      language, port, child, exited: false, ready: false,
      socket: null, waiters: [], opening: null, log,
    }
    child.on('error', () => { worker.exited = true; worker.ready = false })
    child.on('close', () => {
      worker.exited = true
      worker.ready = false
      const waiters = worker.waiters.splice(0)
      for (const waiter of waiters) waiter.reject(new SpeechEngineError('speech worker stopped'))
      if (this.worker === worker) this.worker = null
    })
    this.worker = worker
    worker.opening = (async () => {
      try {
        await waitForWorker(port, () => worker.exited || this.disposed)
        if (worker.exited) throw new SpeechEngineError(`speech worker exited: ${log.join('').slice(-300)}`)
        const socket = new WebSocket(`ws://127.0.0.1:${port}`)
        socket.binaryType = 'arraybuffer'
        await new Promise((resolve, reject) => {
          socket.onopen = resolve
          socket.onerror = () => reject(new SpeechEngineError(`speech worker connection failed: ${log.join('').slice(-300)}`))
        })
        socket.onmessage = (event) => {
          const waiter = worker.waiters.shift()
          if (!waiter) return
          if (typeof event.data !== 'string') {
            waiter.reject(new SpeechEngineError('speech worker returned non-text data'))
            return
          }
          waiter.resolve(event.data)
        }
        socket.onclose = () => {
          worker.ready = false
          const waiters = worker.waiters.splice(0)
          for (const waiter of waiters) waiter.reject(new SpeechEngineError('speech worker connection closed'))
        }
        worker.socket = socket
        worker.ready = true
        return worker
      } catch (error) {
        try { worker.child.kill() } catch {}
        worker.exited = true
        if (this.worker === worker) this.worker = null
        throw error
      }
    })()
    await worker.opening
    return worker
  }

  /**
   * Stop the current worker process and abandon its connection.
   * @returns {Promise<void>}
   */
  async stopWorker() {
    const worker = this.worker
    if (!worker) return
    this.worker = null
    worker.exited = true
    worker.ready = false
    try { worker.socket?.close() } catch {}
    try { worker.child.kill() } catch {}
    const waiters = worker.waiters.splice(0)
    for (const waiter of waiters) waiter.reject(new SpeechEngineError('speech worker stopped'))
  }

  /** Release every native process this engine owns. */
  async dispose() {
    this.disposed = true
    await this.stopWorker()
    await this.silero?.dispose()
  }
}

/**
 * Normalize a sherpa reply into the transcript the browser inserts.
 * @param {string} raw - JSON reply text.
 * @returns {string}
 */
export function cleanTranscript(raw) {
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new SpeechEngineError('speech worker returned malformed JSON') }
  const text = typeof parsed?.text === 'string' ? parsed.text : ''
  return text
    .replace(/\[(BLANK_AUDIO|NOISE|MUSIC|SILENCE)\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Turn assistant Markdown into text worth speaking.
 * Code blocks, tables and bare URLs are skipped; paragraph breaks are kept so
 * the speech engine can give them a longer pause than an ordinary sentence.
 * @param {string} text
 * @returns {string} speech text with blank lines between paragraphs.
 */
export function prepareForSpeech(text) {
  let value = String(text ?? '')
  value = value.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ')
  value = value.replace(/`([^`]*)`/g, '$1')
  value = value.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  value = value.replace(/https?:\/\/\S+/g, ' ')
  value = value.replace(/^[ \t]{0,3}(?:[-*+]|\d+\.)[ \t]+(.+)$/gm, (line, item) => {
    const text = item.trim()
    return /[.!?\u2026:]$/.test(text) ? text : `${text}.`
  })
  value = value.replace(/^\s{0,3}(#{1,6}|>)\s+/gm, '')
  value = value.replace(/[*_~|]/g, '')
  // A single newline continues the sentence; a blank line starts a paragraph.
  value = value.replace(/[ \t]+/g, ' ')
  value = value.replace(/ *\n */g, '\n')
  value = value.replace(/\n{2,}/g, '\n\n')
  value = value.replace(/(?<!\n)\n(?!\n)/g, ' ')
  value = value.replace(/ {2,}/g, ' ').trim()
  if (value.length > 4000) {
    const cut = value.slice(0, 4000)
    const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    value = sentence > 800 ? cut.slice(0, sentence + 1) : cut
  }
  return value
}
