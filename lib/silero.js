/**
 * Silero Russian speech synthesis for the voice dialog plugin.
 *
 * The Python worker keeps the TorchScript model in memory and turns text into
 * one WAV file per answer: sentences are synthesized separately and joined with
 * pauses that follow the punctuation, which is what makes the delivery breathe
 * like a reader instead of running on in one flat stream.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const READY_TIMEOUT_MS = 180000
const SYNTH_TIMEOUT_MS = 180000

/** A synthesis problem safe to report through the loopback route. */
export class SileroError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SileroError'
  }
}

/** Failures that mean the worker died, not that the text was rejected. */
function isTransportError(error) {
  const message = String(error?.message ?? '')
  return /not running|worker stopped|did not start|EPIPE|channel closed/i.test(message)
}

/**
 * Owns the long-lived Python worker that hosts the Silero model.
 */
export class SileroTts {
  /**
   * @param {object} options
   * @param {string} options.python - interpreter from the plugin's own venv.
   * @param {string} options.script - silero_worker.py.
   * @param {string} options.model - v4_ru.pt.
   * @param {string} options.workDir - writable scratch directory.
   */
  constructor(options) {
    this.options = options
    this.worker = null
    this.opening = null
    this.queue = Promise.resolve()
    this.disposed = false
    this.lastError = ''
    this.voices = []
  }

  /** @returns {{ available: boolean, ready: boolean, starting: boolean, voices: string[] }} */
  status() {
    const available = existsSync(this.options.python) && existsSync(this.options.script) && existsSync(this.options.model)
    return {
      available,
      ready: Boolean(this.worker?.ready),
      starting: Boolean(this.worker && !this.worker.ready) || Boolean(this.opening),
      voices: this.voices,
    }
  }

  /**
   * Serialize synthesis: the model is not re-entrant in a useful way and one
   * answer at a time is exactly what the dialog needs.
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
   * Synthesize one answer.
   * @param {string} text
   * @param {string} voice
   * @param {{ speed?: number, pauses?: number }} [options] - prosody rate percent and pause scale.
   * @returns {Promise<Buffer>} complete WAV file bytes.
   */
  async synthesize(text, voice, options = {}) {
    if (this.disposed) throw new SileroError('speech engine disposed')
    if (!this.status().available) throw new SileroError('Silero assets are not installed')
    return await this.exclusive(async () => {
      try {
        return await this.synthOnce(text, voice, options)
      } catch (error) {
        if (!isTransportError(error)) throw error
        // Воркер мог умереть между запросами: поднимаем новый и пробуем ещё раз.
        await this.stopWorker()
        return await this.synthOnce(text, voice, options)
      }
    })
  }

  /** One synthesis attempt against the current worker. */
  async synthOnce(text, voice, options = {}) {
    const worker = await this.ensureWorker()
    const target = join(this.options.workDir ?? tmpdir(), `voice-dialog-${randomUUID()}.wav`)
    try {
      const reply = await worker.request({
        cmd: 'synth',
        text,
        voice,
        speed: options.speed,
        pauses: options.pauses,
        out: target,
      })
      if (!reply.ok || !existsSync(target)) {
        throw new SileroError(reply.error || 'speech synthesis failed')
      }
      this.lastError = ''
      return readFileSync(target)
    } finally {
      rmSync(target, { force: true })
    }
  }

  /**
   * Ask the worker which voices the loaded model exposes.
   * @returns {Promise<string[]>}
   */
  async listVoices() {
    if (!this.status().available) return []
    const worker = await this.ensureWorker()
    const reply = await worker.request({ cmd: 'ping' })
    const voices = Array.isArray(reply.voices) ? reply.voices.filter(name => typeof name === 'string') : []
    if (voices.length > 0) this.voices = voices
    return this.voices
  }

  /**
   * Вероятность имени на куске PCM16 16 кГц (своя KWS-модель в воркере).
   * @param {Buffer} pcm
   * @returns {Promise<number|undefined>}
   */
  async scoreWake(pcm) {
    const status = this.status()
    if (!status.available) return undefined
    // Воркер ещё не поднят: не блокируем поток прослушивания, прогреваем фоном.
    if (!status.ready) {
      void this.ensureWorker().catch(() => undefined)
      return undefined
    }
    try {
      const worker = await this.ensureWorker()
      const reply = await Promise.race([
        worker.request({ cmd: 'kws', pcm: pcm.toString('base64') }),
        new Promise((resolve) => setTimeout(() => resolve(undefined), 900)),
      ])
      if (!reply || !reply.ok) return undefined
      const score = Number(reply.score)
      return Number.isFinite(score) ? score : undefined
    } catch {
      return undefined
    }
  }
  /** Start the worker if it is not running. */
  async ensureWorker() {
    if (this.worker?.ready) return this.worker
    if (this.opening) {
      await this.opening
      return this.worker
    }
    this.opening = this.startWorker()
    try {
      await this.opening
    } finally {
      this.opening = null
    }
    if (!this.worker) throw new SileroError(this.lastError || 'speech worker did not start')
    return this.worker
  }

  /** Spawn the Python worker and wait for its ready line. */
  async startWorker() {
    const { python, script, model, workDir } = this.options
    for (const file of [python, script, model]) {
      if (!existsSync(file)) throw new SileroError(`missing speech asset: ${file}`)
    }
    const child = spawn(python, [script], {
      cwd: workDir ?? tmpdir(),
      windowsHide: true,
      // fd 3 is the reply channel: PyTorch prints warnings on stdout and stderr.
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', OMP_NUM_THREADS: '4', KWS_DIR: process.env.KWS_DIR || join(homedir(), 'AppData', 'Local', 'kws') },
    })
    const worker = {
      child,
      ready: false,
      exited: false,
      buffer: '',
      pending: [],
      log: [],
      request(payload) {
        return new Promise((resolve, reject) => {
          if (this.exited || !this.ready) { reject(new SileroError('speech worker is not running')); return }
          const id = randomUUID()
          const entry = { resolve, reject, timer: setTimeout(() => {
            const index = this.pending.findIndex(item => item.id === id)
            if (index >= 0) this.pending.splice(index, 1)
            reject(new SileroError('speech synthesis timed out'))
          }, SYNTH_TIMEOUT_MS) }
          entry.id = id
          this.pending.push(entry)
          try {
            child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`)
          } catch (error) {
            this.pending.pop()
            clearTimeout(entry.timer)
            reject(error)
          }
        })
      },
    }

    const protocol = child.stdio[3]
    protocol.setEncoding('utf8')
    protocol.on('data', (chunk) => {
      worker.buffer += chunk
      let index = worker.buffer.indexOf('\n')
      while (index >= 0) {
        const line = worker.buffer.slice(0, index).trim()
        worker.buffer = worker.buffer.slice(index + 1)
        index = worker.buffer.indexOf('\n')
        if (line === '') continue
        let reply
        try { reply = JSON.parse(line) } catch { worker.log.push(line.slice(0, 300)); continue }
        if (reply.ready === true && !worker.ready) {
          worker.ready = true
          if (Array.isArray(reply.voices)) this.voices = reply.voices.filter(name => typeof name === 'string')
          for (const entry of worker.pending.splice(0)) {
            clearTimeout(entry.timer)
            entry.resolve(reply)
          }
          continue
        }
        if (reply.fatal) this.lastError = String(reply.fatal)
        // Replies carry the request id: match by it instead of by queue order, so
        // one late or timed-out request can never shift every later answer.
        let entry
        if (typeof reply.id === 'string' && reply.id !== '') {
          const index = worker.pending.findIndex(item => item.id === reply.id)
          if (index >= 0) entry = worker.pending.splice(index, 1)[0]
        } else {
          entry = worker.pending.shift()
        }
        if (!entry) continue
        clearTimeout(entry.timer)
        entry.resolve(reply)
      }
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', () => { /* PyTorch runtime warnings; drained so the pipe never blocks */ })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      if (worker.log.length < 60) worker.log.push(text.slice(0, 400))
      if (/failed to load model/i.test(text)) this.lastError = text.trim().slice(0, 300)
    })
    const settle = (error) => {
      worker.exited = true
      worker.ready = false
      for (const entry of worker.pending.splice(0)) {
        clearTimeout(entry.timer)
        entry.reject(error)
      }
      if (this.worker === worker) this.worker = null
    }
    child.on('error', (error) => settle(new SileroError(`speech worker failed: ${error.message}`)))
    child.on('close', (code) => {
      if (code !== 0 && this.lastError === '') this.lastError = `speech worker exited with code ${code}`
      settle(new SileroError('speech worker stopped'))
    })

    this.worker = worker
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (!worker.ready) {
      if (worker.exited) {
        throw new SileroError(this.lastError || `speech worker exited: ${worker.log.join('').slice(-300)}`)
      }
      if (Date.now() > deadline) {
        try { child.kill() } catch {}
        throw new SileroError('speech worker did not start in time')
      }
      await new Promise(resolve => setTimeout(resolve, 120))
    }
    return worker
  }

  /** Stop the worker process. */
  async stopWorker() {
    const worker = this.worker
    if (!worker) return
    this.worker = null
    worker.exited = true
    worker.ready = false
    try { worker.child.stdin.end() } catch {}
    try { worker.child.kill() } catch {}
    for (const entry of worker.pending.splice(0)) {
      clearTimeout(entry.timer)
      entry.reject(new SileroError('speech worker stopped'))
    }
  }

  /** Release the worker and stop accepting work. */
  async dispose() {
    this.disposed = true
    await this.stopWorker()
  }
}
