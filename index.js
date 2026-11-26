/**
 * Voice dialog — Host half.
 *
 * Owns the local speech engines and the loopback HTTP endpoints the composer
 * control talks to. Recordings and transcripts stay on this machine; the only
 * durable effect is the prompt the user's browser submits through the normal
 * composer path.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SpeechEngine, SpeechEngineError } from './lib/engine.js'
import { WakeStreamer } from './lib/wake-stream.js'

export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_ROOT = join(HERE, 'engine')
// Образцы для обучения KWS лежат рядом с плагином: ..\kws\real\{pos,neg}.
const KWS_SAMPLES_ROOT = process.env.VOICE_KWS_SAMPLES || join(dirname(HERE), 'kws', 'real')
// Кольца последних 1,5 с по каждому ключу потока — вход для KWS-модели.
const kwsRing = new Map()
const KWS_TRIGGER = Number(process.env.VOICE_KWS_TRIGGER) || 0.85

/**
 * Sherpa-onnx (C++) читает пути из argv через ANSI-кодировку, поэтому
 * кириллица в пути к плагину («C:\\Ассистент\\…») превращается в «?» и модель
 * не находится. Когда путь не ASCII, подсовываем ASCII-джанкшен на тот же
 * каталог движка: файлы те же, а аргументы процессы видят латиницей.
 */
function asciiEngineRoot(root) {
  if (!/[^\x00-\x7F]/.test(root)) return root
  const base = process.env.LOCALAPPDATA || process.env.TEMP
  if (!base) return root
  const link = join(base, 'voice-dialog-engine')
  try {
    // Джанкшен мог остаться от прежнего расположения плагина: тогда он
    // указывает в пустоту, и его нужно пересоздать.
    if (existsSync(link) && !existsSync(join(link, 'models'))) {
      rmSync(link, { recursive: false, force: true })
    }
    if (!existsSync(link)) symlinkSync(root, link, 'junction')
  } catch { /* нет прав на джанкшен — остаёмся на исходном пути */ }
  return existsSync(join(link, 'models')) ? link : root
}

const ENGINE_ASCII = asciiEngineRoot(ENGINE_ROOT)
const WORK_DIR = join(ENGINE_ROOT, 'tmp')
const SHERPA_BIN = join(ENGINE_ASCII, 'sherpa-onnx-v2.0.3-win-x64-shared-MT-Release', 'bin')
const MODEL_DIR = join(ENGINE_ASCII, 'models', 'sherpa-whisper-small')
const TTS_DIR = join(ENGINE_ASCII, 'tts')
const MAX_BODY_BYTES = 32 * 1024 * 1024
const PREFIX = '/voice-dialog'
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const ASSISTANT_FILE = join(DSH_HOME, 'voice-assistant.json')
const ASSISTANT_SESSION_FILE = join(DSH_HOME, 'voice-assistant-session.json')

/** Личность и поправки ассистента: хранятся локально и подмешиваются в промпт. */
const DEFAULT_ASSISTANT = {
  persona: 'Ты — личный голосовой ассистент в духе Джарвиса: спокойный, собранный, полезный. Отвечай коротко и по делу, без воды; в голосовом режиме — одна-две фразы.',
  address: 'по имени, уважительно',
  corrections: '',
  facts: '',
}

function loadAssistant() {
  try {
    const raw = JSON.parse(readFileSync(ASSISTANT_FILE, 'utf8'))
    return {
      persona: typeof raw.persona === 'string' ? raw.persona.slice(0, 4000) : DEFAULT_ASSISTANT.persona,
      address: typeof raw.address === 'string' ? raw.address.slice(0, 200) : DEFAULT_ASSISTANT.address,
      corrections: typeof raw.corrections === 'string' ? raw.corrections.slice(0, 4000) : DEFAULT_ASSISTANT.corrections,
      facts: typeof raw.facts === 'string' ? raw.facts.slice(0, 4000) : DEFAULT_ASSISTANT.facts,
    }
  } catch {
    return { ...DEFAULT_ASSISTANT }
  }
}

function saveAssistant(profile) {
  mkdirSync(dirname(ASSISTANT_FILE), { recursive: true })
  writeFileSync(ASSISTANT_FILE, `${JSON.stringify(profile, undefined, 2)}\n`, 'utf8')
}

/** Текст секции системного промпта: личность, обращение и поправки пользователя. */
function assistantPrompt(profile) {
  const parts = ['## Личный ассистент']
  if (profile.persona.trim() !== '') parts.push(profile.persona.trim())
  if (profile.address.trim() !== '') parts.push(`Обращение к пользователю: ${profile.address.trim()}.`)
  const rules = profile.corrections.split('\n').map((line) => line.trim()).filter(Boolean)
  if (rules.length > 0) parts.push(`Правила и поправки пользователя (соблюдай):\n${rules.map((rule) => `- ${rule}`).join('\n')}`)
  const facts = String(profile.facts ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
  if (facts.length > 0) parts.push(`Что помнить о пользователе:\n${facts.map((fact) => `- ${fact}`).join('\n')}`)
  return parts.join('\n\n')
}

/** Silero v4_ru speakers, with the labels the settings page shows. */
const SILERO_VOICES = [
  { id: 'baya', label: 'Бая — тёплый женский', gender: 'female' },
  { id: 'kseniya', label: 'Ксения — спокойный женский', gender: 'female' },
  { id: 'xenia', label: 'Ксения (alt) — мягкий женский', gender: 'female' },
  { id: 'aidar', label: 'Айдар — низкий мужской', gender: 'male' },
  { id: 'eugene', label: 'Евгений — ровный мужской', gender: 'male' },
  { id: 'random', label: 'Случайный голос', gender: 'mixed' },
]

/** Loopback peers only: these routes never leave the machine. */
function isLoopback(request) {
  const address = request.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Read one bounded request body. */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new SpeechEngineError('request body is too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => { resolve(Buffer.concat(chunks)) })
    request.on('error', reject)
  })
}

/**
 * Прогрев распознавателя при старте: prepare проверяет ресурсы, а беззвучный
 * запрос заставляет провайдера загрузить модель в память и держать её тёплой
 * (провайдер выгружает модель по idleTimeoutMs, в профиле он увеличен).
 * @param {object|undefined} speech - ctx.speechToText
 */
async function warmHostSpeech(speech) {
  if (!speech || typeof speech.resolve !== 'function' || typeof speech.transcribe !== 'function') return
  try {
    if (typeof speech.prepare === 'function') speech.prepare('gigaam-local')
  } catch { /* провайдер может быть другим */ }
  try {
    const spec = speech.resolve({ audio: silenceWave(700), language: 'ru' })
    await speech.transcribe(spec, AbortSignal.timeout(20000))
  } catch { /* прогрев не критичен */ }
}

/** Canonical 16 kHz mono PCM16 WAV with pure silence. */
function silenceWave(milliseconds) {
  const sampleRate = 16000
  const frames = Math.max(1, Math.floor((sampleRate * milliseconds) / 1000))
  const buffer = Buffer.alloc(44 + frames * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + frames * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(frames * 2, 40)
  return buffer
}

/**
 * Try the harness speech service (GigaAM provider) before the bundled Whisper.
 * It is much faster on long recordings and does not need the 28-second window.
 * Returns undefined when the service is missing, refuses, or returns nothing.
 * @param {object|undefined} speech - ctx.speechToText
 * @param {Buffer} wave - canonical 16 kHz mono PCM16 WAV
 * @param {string} language - recognition language hint
 * @returns {Promise<string|undefined>}
 */
let hostSpeechFailures = 0
let hostSpeechDisabledUntil = 0
let hostSpeechLastError = ''
async function transcribeWithHost(speech, wave, language) {
  if (!speech || typeof speech.resolve !== 'function' || typeof speech.transcribe !== 'function') return undefined
  if (language !== 'ru' && language !== '') return undefined
  if (Date.now() < hostSpeechDisabledUntil) return undefined
  try {
    const spec = speech.resolve({ audio: wave, language: 'ru' })
    // Короткий дедлайн: если сервис почему-то молчит, лучше уйти на Whisper,
    // чем держать активацию по имени несколько секунд.
    const result = await speech.transcribe(spec, AbortSignal.timeout(8000))
    // Пустой ответ провайдера — это не сбой, а «речи нет»: раньше такие
    // случаи считались ошибками и на 5 минут глушили GigaAM, уходя в Whisper.
    const text = String(result?.text ?? '').trim()
    hostSpeechFailures = 0
    hostSpeechDisabledUntil = 0
    return text
  } catch (error) {
    hostSpeechFailures += 1
    hostSpeechLastError = error instanceof Error
      ? String(error.name + ': ' + error.message).slice(0, 200)
      : String(error).slice(0, 200)
    if (hostSpeechFailures >= 3) hostSpeechDisabledUntil = Date.now() + 300000
    return undefined
  }
}

/** Answer one JSON payload. */
function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Answer one engine failure without leaking a stack. */
function sendFailure(response, error) {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(response, error instanceof SpeechEngineError ? 400 : 500, { error: message })
}

/**
 * Register the voice dialog endpoints and assistant-reply readback.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  mkdirSync(WORK_DIR, { recursive: true })
  const engine = new SpeechEngine({
    sherpaExe: join(SHERPA_BIN, 'sherpa-onnx-offline-websocket-server.exe'),
    sherpaCliExe: join(SHERPA_BIN, 'sherpa-onnx-offline.exe'),
    encoder: join(MODEL_DIR, 'small-encoder.int8.onnx'),
    decoder: join(MODEL_DIR, 'small-decoder.int8.onnx'),
    tokens: join(MODEL_DIR, 'small-tokens.txt'),
    silero: {
      python: join(TTS_DIR, '.venv', 'Scripts', 'python.exe'),
      script: join(TTS_DIR, 'silero_worker.py'),
      model: join(TTS_DIR, 'models', 'v4_ru.pt'),
      workDir: WORK_DIR,
    },
    workDir: WORK_DIR,
    threads: 4,
  })
  // Потоковый детектор кодового слова: имя слышно ещё во время речи.
  const wake = new WakeStreamer({
    modelDir: join(ENGINE_ASCII, 'models', 'sherpa-streaming-ru'),
    vadModel: join(ENGINE_ASCII, 'models', 'vad', 'silero_vad.onnx'),
    threads: 2,
  })

  /** Latest complete assistant answer per Session, for the browser's speech readback. */
  const replies = new Map()
  /** Last page that loaded this client module; a diagnostic for Desktop/Web transport checks. */
  let clientInfo = null
  /** Harness speech service (GigaAM): much faster than the bundled Whisper. */
  let hostSpeech
  /** Личность ассистента: правится на странице «Ассистент». */
  let assistant = loadAssistant()
  /** Собственный агент-ассистент: живёт в отдельной сессии, не в чатах пользователя. */
  let agentsService
  let sessionTitleService
  let defaultModelService
  let assistantHandle = null
  let assistantSessionId = ''

  ctx.inject(['agents'], (scoped) => {
    agentsService = scoped.agents
    return () => { agentsService = undefined }
  })
  ctx.inject(['sessionTitle'], (scoped) => {
    sessionTitleService = scoped.sessionTitle
    return () => { sessionTitleService = undefined }
  })
  ctx.inject(['agentDefaultModel'], (scoped) => {
    defaultModelService = scoped.agentDefaultModel
    return () => { defaultModelService = undefined }
  })

  // Рабочая папка ассистента — отдельный проект в сайдбаре, чтобы чаты
  // ассистента не смешивались с остальными работами.
  let workspaceEnsured = false
  ctx.inject(['workspaceRegistry'], (scoped) => {
    if (workspaceEnsured) return
    workspaceEnsured = true
    const registry = scoped.workspaceRegistry
    void (async () => {
      try {
        const project = await registry.create('C:\\Ассистент', 'Ассистент')
        try { await project?.setTitle?.('Ассистент') } catch { /* имя уже верное */ }
      } catch { /* проект уже есть или папка недоступна */ }
    })()
  })

  ctx.effect(() => () => {
    try { void assistantHandle?.dispose?.() } catch { /* уже закрыт */ }
    assistantHandle = null
  })

  function savedAssistantSession() {
    try {
      return String(JSON.parse(readFileSync(ASSISTANT_SESSION_FILE, 'utf8')).sessionId ?? '')
    } catch { return '' }
  }

  /** Поднять (или возобновить) сессию «Ассистент» для голосового диалога. */
  async function ensureAssistantSession() {
    if (assistantHandle) return assistantHandle
    if (!agentsService) throw new Error('agents service is unavailable')
    const agentOptions = defaultModelService?.currentSelection?.()
    const saved = savedAssistantSession()
    if (saved !== '') {
      try {
        assistantHandle = await agentsService.resume({ sessionId: saved, agentOptions })
        assistantSessionId = saved
        return assistantHandle
      } catch {
        assistantHandle = null
      }
    }
    const sessionId = randomUUID()
    assistantHandle = await agentsService.create({ sessionId, agentOptions })
    assistantSessionId = sessionId
    try {
      writeFileSync(ASSISTANT_SESSION_FILE, `${JSON.stringify({ sessionId }, undefined, 2)}\n`, 'utf8')
    } catch { /* файл не критичен */ }
    try {
      sessionTitleService?.rename?.(assistantHandle.session ?? sessionId, 'Ассистент')
    } catch { /* имя можно поменять вручную */ }
    return assistantHandle
  }

  ctx.effect(() => ctx.on('agent/created', (agent) => {
    const agentCtx = agent?.ctx
    const text = assistantPrompt(assistant)
    if (!agentCtx || text === '') return
    if (typeof agentCtx.systemPrompt?.section === 'function') {
      agentCtx.systemPrompt.section({ name: 'assistant:persona', order: 15, text })
      return
    }
    if (typeof agentCtx.on === 'function') {
      const stop = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const assembled = await next()
        return { ...assembled, sections: [...(assembled.sections ?? []), { name: 'assistant:persona', text }] }
      })
      if (typeof stop === 'function') ctx.effect(() => stop)
    }
  }))

  ctx.inject(['speechToText'], (speechCtx) => {
    hostSpeech = speechCtx.speechToText
    void warmHostSpeech(hostSpeech)
    return () => { hostSpeech = undefined }
  })

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event?.type !== 'assistant/message') return
    if (event.data?.interrupted === true) return
    const content = event.data?.message?.content
    if (!Array.isArray(content)) return
    const text = content
      .filter(block => block && block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text === '') return
    const sessionId = String(session?.id ?? '')
    if (sessionId === '') return
    replies.set(sessionId, {
      seq: typeof event.seq === 'number' ? event.seq : 0,
      text,
      time: Date.now(),
      turn: typeof event.data?.turn === 'number' ? event.data.turn : -1,
    })
    if (replies.size > 200) {
      const oldest = replies.keys().next().value
      replies.delete(oldest)
    }
  }))

  const routes = [
    {
      path: `${PREFIX}/converse`,
      handler: async (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        try {
          const body = await readBody(request)
          const payload = JSON.parse(body.toString('utf8') || '{}')
          const text = String(payload.text ?? '').trim()
          if (text === '') { sendJson(response, 400, { error: 'text is required' }); return }
          const handle = await ensureAssistantSession()
          await handle.agent.followup({
            content: [{ type: 'text', text }],
            source: { kind: 'user' },
          })
          sendJson(response, 200, { ok: true, sessionId: assistantSessionId })
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      path: `${PREFIX}/assistant`,
      handler: async (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method === 'GET') { sendJson(response, 200, assistant); return }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        try {
          const body = await readBody(request)
          const payload = JSON.parse(body.toString('utf8') || '{}')
          const next = {
            persona: typeof payload.persona === 'string' ? payload.persona.slice(0, 4000) : assistant.persona,
            address: typeof payload.address === 'string' ? payload.address.slice(0, 200) : assistant.address,
            corrections: typeof payload.corrections === 'string' ? payload.corrections.slice(0, 4000) : assistant.corrections,
            facts: typeof payload.facts === 'string' ? payload.facts.slice(0, 4000) : assistant.facts,
          }
          saveAssistant(next)
          assistant = next
          sendJson(response, 200, assistant)
        } catch (error) { sendFailure(response, error) }
      },
    },
    {
      path: `${PREFIX}/client-info`,
      handler: async (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        try {
          const body = await readBody(request)
          const payload = JSON.parse(body.toString('utf8') || '{}')
          const text = (value) => typeof value === 'string' ? value.slice(0, 300) : ''
          clientInfo = {
            protocol: text(payload.protocol),
            origin: text(payload.origin),
            userAgent: text(payload.userAgent),
            at: Date.now(),
          }
          response.writeHead(204, { 'cache-control': 'no-store' })
          response.end()
        } catch (error) { sendFailure(response, error) }
      },
    },
    {
      path: `${PREFIX}/status`,
      handler: (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method !== 'GET' && request.method !== 'HEAD') { sendJson(response, 405, { error: 'method not allowed' }); return }
        try {
        sendJson(response, 200, {
          ...engine.status(),
          lastError: engine.lastError,
          client: clientInfo,
          languages: ['ru', 'en', 'auto'],
          voices: SILERO_VOICES.map(voice => voice.id),
          voiceCatalog: SILERO_VOICES,
          recognizer: 'Whisper small int8 (sherpa-onnx)',
          assistantSessionId,
          hostAsr: {
            available: Boolean(hostSpeech),
            failures: hostSpeechFailures,
            disabledUntil: hostSpeechDisabledUntil,
            lastError: hostSpeechLastError,
          },
        })
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      path: `${PREFIX}/warm`,
      handler: async (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        let language = 'ru'
        let warmSpeech = false
        try {
          const body = await readBody(request)
          if (body.length > 0) {
            const payload = JSON.parse(body.toString('utf8'))
            language = String(payload.language ?? 'ru')
            warmSpeech = payload.tts === true
          }
        } catch { /* warm-up is best effort */ }
        engine.ensureWorker(language === 'auto' ? '' : language).catch(() => undefined)
        // The reply to this turn will likely be spoken; load the voice now.
        if (warmSpeech) engine.silero?.ensureWorker().catch(() => undefined)
        sendJson(response, 202, { ok: true })
      },
    },
    {
      path: `${PREFIX}/transcribe`,
      handler: async (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        try {
          const started = Date.now()
          const body = await readBody(request)
          const language = String(request.headers['x-voice-language'] ?? 'ru')
          // Если в хосте есть штатный сервис распознавания (GigaAM), отдаём
          // запись ему: он в разы быстрее локального Whisper и не режет окно.
          const fast = await transcribeWithHost(hostSpeech, body, language)
          if (fast !== undefined) {
            sendJson(response, 200, { text: fast, durationMs: Date.now() - started, mode: 'host' })
            return
          }
          const text = await engine.transcribe(body, language)
          sendJson(response, 200, { text, durationMs: Date.now() - started, mode: engine.status().mode })
        } catch (error) { sendFailure(response, error) }
      },
    },
    {
      // Образцы для обучения KWS: клиент присылает WAV, хост кладёт его на диск.
      // Только loopback и только по явному включению в настройках.
      path: `${PREFIX}/sample`,
      handler: async (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        try {
          const body = await readBody(request)
          if (body.length < 2048) { sendJson(response, 400, { error: 'too small' }); return }
          const label = String(request.headers['x-sample-label'] ?? 'pos') === 'neg' ? 'neg' : 'pos'
          const directory = join(KWS_SAMPLES_ROOT, label)
          mkdirSync(directory, { recursive: true })
          const name = `${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`
          writeFileSync(join(directory, name), body)
          sendJson(response, 200, { ok: true, label, file: name, bytes: body.length })
        } catch (error) { sendFailure(response, error) }
      },
    },
    {
      // Поток кодового слова: клиент шлёт PCM16 16 кГц кусками по ~100 мс,
      // в ответ приходит текущий частичный текст. Ошибка здесь не критична —
      // клиент просто вернётся к распознаванию по паузе.
      path: `${PREFIX}/wake`,
      handler: async (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        try {
          const body = await readBody(request)
          const key = String(request.headers['x-wake-key'] ?? 'wake')
          let score
          // Своя KWS-модель: считаем вероятность имени на последних 1,5 с.
          // Поток записи команды (rec-…) не оцениваем — там уже есть VAD.
          if (!key.startsWith('rec-') && body.length > 0) {
            const ring = kwsRing.get(key) ?? { buffer: Buffer.alloc(0) }
            const limit = 16000 * 2 * 1.5
            let merged = Buffer.concat([ring.buffer, body])
            if (merged.length > limit) merged = merged.subarray(merged.length - limit)
            kwsRing.set(key, { buffer: merged })
            score = await engine.silero?.scoreWake(merged)
            if (kwsRing.size > 8) {
              for (const stale of kwsRing.keys()) {
                if (stale !== key) { kwsRing.delete(stale); break }
              }
            }
          }
          // Пока KWS отвечает, текст в этом проходе не декодируем: VAD работает,
          // а распознавание нужно только для записи команды.
          const result = wake.push(key, body, { skipAsr: score !== undefined })
          sendJson(response, 200, score === undefined ? { ...result, kws: KWS_TRIGGER } : { ...result, score, kws: KWS_TRIGGER })
        } catch (error) {
          sendJson(response, 503, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      path: `${PREFIX}/tts`,
      handler: async (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return }
        try {
          const body = await readBody(request)
          const payload = JSON.parse(body.toString('utf8') || '{}')
          const text = typeof payload.text === 'string' ? payload.text : ''
          if (text.trim() === '') { sendJson(response, 400, { error: 'text is required' }); return }
          const voice = typeof payload.voice === 'string' ? payload.voice : 'baya'
          const speed = Number.isFinite(Number(payload.speed)) ? Math.max(70, Math.min(130, Number(payload.speed))) : 100
          const pauses = Number.isFinite(Number(payload.pauses)) ? Math.max(0.3, Math.min(2.5, Number(payload.pauses))) : 1
          // Единственный разрешённый движок — Silero; другие значения игнорируются.
          const wave = await engine.synthesize(text, { voice, speed, pauses })
          response.writeHead(200, {
            'content-type': 'audio/wav',
            'content-length': wave.length,
            'cache-control': 'no-store',
          })
          response.end(wave)
        } catch (error) { sendFailure(response, error) }
      },
    },
    {
      path: `${PREFIX}/reply`,
      handler: (request, response) => {
        if (!isLoopback(request)) { sendJson(response, 403, { error: 'loopback only' }); return }
        if (request.method !== 'GET') { sendJson(response, 405, { error: 'method not allowed' }); return }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const sessionId = url.searchParams.get('session') ?? ''
        const after = Number(url.searchParams.get('after') ?? '0')
        const entry = replies.get(sessionId)
        if (!entry || !(entry.seq > after)) {
          response.writeHead(204, { 'cache-control': 'no-store' })
          response.end()
          return
        }
        sendJson(response, 200, { seq: entry.seq, text: entry.text, time: entry.time, turn: entry.turn })
      },
    },
  ]

  for (const route of routes) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }))
  }

  ctx.effect(() => () => {
    replies.clear()
    engine.dispose().catch(() => undefined)
  })
}
