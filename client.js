/**
 * Voice dialog — browser half.
 *
 * Adds a microphone control beside the composer, a live status dock below it,
 * and one settings page. Speech recognition and synthesis run on the Host
 * through the bundle's loopback endpoints; this module only captures audio,
 * drives the dialog modes, and submits ordinary prompts through the composer.
 */
window.__ModuleLoader__.load({
  id: '@local/voice-dialog',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useSyncExternalStore } = React

    const STORAGE_KEY = 'voice-dialog.preferences.v1'
    // Relative route: the Desktop shell forwards non-static dsh-app://app paths
    // to the Host with its cookie, and the served Web page resolves the same
    // path against its own origin. No absolute host URL is needed.
    const BASE = '/voice-dialog'

    const DICT = {
      ru: {
        settingsNav: 'Голосовой диалог',
        assistantNav: 'Ассистент',
        assistantIntro: 'Личность, правила и все настройки голосового ассистента. Работает вне сессий: настройки общие для всего приложения.',
        personaTitle: 'Личность',
        personaHint: 'Кто ты и как себя ведёшь. Этот текст подмешивается в системный промпт новых сессий.',
        addressTitle: 'Как обращаться к пользователю',
        addressHint: 'Например: «по имени, уважительно» или «сэр».',
        correctionsTitle: 'Поправки и правила',
        correctionsHint: 'По одной на строку. Это ваши коррекции поведения: «не заканчивай ответ вопросом», «сначала вывод, потом детали».',
        factsTitle: 'Что помнить о пользователе',
        factsHint: 'По одному факту в строке: имя, привычки, предпочтения. Эти строки попадают в системный промпт новых сессий.',
        saveProfile: 'Сохранить',
        profileSaved: 'Сохранено',
        profileError: 'Не удалось сохранить настройки ассистента.',
        voiceSectionTitle: 'Голос',
        title: 'Голосовой диалог',
        intro: 'Локальные распознавание и озвучка: звук не покидает этот компьютер. Выберите режим микрофона и способ ответа.',
        defaultMode: 'Режим микрофона',
        modeNote: 'Микрофон слушает имя постоянно, но только когда включён: скажи «Валера» — начнётся распознавание команды. Морда капибары включает и выключает микрофон, и это состояние запоминается.',
        modeContinuous: 'Непрерывный диалог',
        modeHold: 'Удержание кнопки',
        modeClick: 'Нажатие кнопки',
        modeContinuousHint: 'Слушает после каждого ответа, пока не остановите.',
        modeHoldHint: 'Говорите, пока держите микрофон; отпустите — отправка.',
        modeClickHint: 'Одно нажатие — запись; следующая запись — новое нажатие.',
        reply: 'Ответ ассистента',
        replyVoice: 'Голосом',
        replyText: 'Только текстом',
        language: 'Язык распознавания',
        langRu: 'Русский',
        langEn: 'Английский',
        langAuto: 'Определять автоматически',
        engine: 'Движок озвучки',
        engineSilero: 'Silero (локальный) — единственный движок',
        voice: 'Голос чтения',
        voiceHint: 'Интонация и паузы следуют знакам препинания: точка, вопрос, восклицание, тире и многоточие звучат по-разному. Ударения и «ё» расставляются автоматически.',
        speed: 'Скорость речи',
        speedSlow: 'Медленная',
        speedNormal: 'Обычная',
        speedFast: 'Быстрая',
        speedHint: 'Ускоряет или замедляет чтение, сохраняя естественные интонации.',
        pauses: 'Паузы',
        pauseShort: 'Короткие',
        pauseNormal: 'Обычные',
        pauseExpressive: 'Выразительные',
        pauseHint: 'Меняет длину пауз на знаках препинания: с «Выразительными» точка и многоточие звучат как у чтеца.',
        voiceBaya: 'Бая — тёплый женский',
        voiceKseniya: 'Ксения — спокойный женский',
        voiceXenia: 'Ксения (alt) — мягкий женский',
        voiceAidar: 'Айдар — низкий мужской',
        voiceEugene: 'Евгений — ровный мужской',
        voiceRandom: 'Случайный голос',
        sensitivity: 'Чувствительность микрофона',
        sensitivityLow: 'Низкая',
        sensitivityNormal: 'Средняя',
        sensitivityHigh: 'Высокая',
        speakTest: 'Проверить голос',
        testPhrase: 'Проверка голоса: точка. Пауза? Восклицание! И многоточие…',
        status: 'Состояние движков',
        statusAsr: 'Распознавание',
        statusTts: 'Озвучка',
        ready: 'готово',
        missing: 'не найдено',
        checking: 'проверяю…',
        worker: 'Локальный движок',
        workerStopped: 'выключен',
        workerStarting: 'запускается',
        workerReady: 'готов',
        listening: 'Слушаю…',
        starting: 'Включаю микрофон…',
        holdPrompt: 'Держите микрофон и говорите',
        clickPrompt: 'Нажмите микрофон, чтобы начать',
        transcribing: 'Распознаю…',
        thinking: 'Думаю…',
        speaking: 'Говорю…',
        idle: 'Голосовой режим выключен',
        stop: 'Остановить',
        mic: 'Голосовой ввод',
        micStart: 'Начать голосовой ввод',
        micStop: 'Остановить голосовой ввод',
        micOnTitle: 'Микрофон включён — выключить',
        micOffTitle: 'Микрофон выключен — включить',
        micOffState: 'выключен — нажми капибару',
        samplesOn: 'Сохранять',
        samplesOff: 'Не сохранять',
        samplesHint: 'Локально сохраняет образцы речи для обучения своей модели имени: «Валера» — положительные, речь без имени — отрицательные.',
        reading: 'Чтение',
        samplesStart: 'Запись голоса',
        samplesLabelName: 'Метка: имя',
        samplesLabelBackground: 'Метка: фон',
        samplesStop: 'Остановить запись',
        samplesSaved: 'Образец сохранён',
        samplesEmpty: 'Слишком короткая запись',
        samplesFailed: 'Не удалось сохранить образец',
        recognized: 'Распознано',
        noSpeech: 'Речь не распознана. Попробуйте ещё раз.',
        noSpeechStopped: 'Речь не распознана три раза подряд — непрерывный режим выключен.',
        micDenied: 'Браузер не дал доступ к микрофону. Разрешите его в настройках сайта.',
        micMissing: 'Микрофон не найден.',
        micBusy: 'Микрофон занят — подождите секунду и нажмите ещё раз.',
        network: 'Локальный движок недоступен. Проверьте, что плагин «Голосовой диалог» включён.',
        engineError: 'Ошибка движка',
        submitError: 'Не удалось отправить сообщение',
        pendingQuestion: 'Ассистент ждёт ответа в диалоге — ответьте там, затем включите голосовой режим снова.',
        busy: 'Ассистент ещё отвечает — дождитесь ответа.',
        addedToDraft: 'Транскрипт добавлен в черновик — проверьте и отправьте вручную.',
        tooLong: 'Слишком долгая запись — отменена.',
        continuousOn: 'Непрерывный диалог включён',
        continuousOff: 'Непрерывный диалог выключен',
        voiceOn: 'Ответы голосом',
        voiceOff: 'Ответы текстом',
        mode: 'Режим',
        speedNote: 'Первое распознавание загружает модель (~3–5 с), дальше быстрее.',
        engineNote: 'Silero произносит русский текст локально: паузы и интонация следуют знакам препинания, ударения и «ё» расставляются сами. Других движков нет — английские слова читаются тем же голосом.',
        wakeTitle: 'Активация по имени',
        wakeHint: 'Микрофон слушает кодовое слово и запускает диалог: услышав имя, плагин подаёт сигнал и начинает запись вопроса. Пока ассистент говорит, микрофон занят озвучкой.',
        wakeOn: 'Включена',
        wakeOff: 'Выключена',
        wakeWordsLabel: 'Кодовые слова (через запятую)',
        wakeExample: 'валера, валерчик, валерий',
        wakeHeard: 'Услышал имя — говорите',
        listeningPrompts: [
          'Да, я вас слушаю.',
          'Вы что-то сказали?',
          'Слушаю вас.',
          'Я здесь, говорите.',
          'Да, слушаю внимательно.',
        ],
        queuedAsk: 'Принял — отвечу сразу после текущего ответа.',
        stopped: 'Остановил.',
        wakeArmed: 'Слушаю кодовое слово',
        bargeTitle: 'Прерывание голосом',
        bargeHint: 'Пока читаю ответ, микрофон слушает кодовое слово. Скажи «Валера» — озвучка сразу останавливается и можно говорить новую команду. Текст, отправленный в чат, тоже прерывает чтение.',
        bargeOn: 'Включено',
        bargeOff: 'Выключено',
        bargeOffHint: 'Прерывание выключено: остановить чтение можно только кнопкой.',
        closePanel: 'Скрыть панель',
        followUpTitle: 'Слушать после ответа',
        followUpOff: 'Выключено',
        followUpShort: '3 секунды',
        followUpLong: '5 секунд',
        followUpHint: 'После ответа микрофон сам открывается на это время: следующий вопрос можно задать без имени, как в разговоре. Если за это время речи нет — микрофон закрывается и снова ждёт кодовое слово.',
        assistantSessionTitle: 'Отдельная сессия «Ассистент»',
        assistantSessionOn: 'Включено',
        assistantSessionOff: 'Выключено',
        assistantSessionHint: 'Голосовые вопросы уходят в отдельную сессию «Ассистент», а ваши чаты остаются чистыми. Если выключено — как раньше, в текущий чат.',
        dictationTitle: 'Длина записи',
        dictationWhole: 'Целиком',
        dictationSplit: 'По паузам',
        dictationWholeHint: 'Пишу до трёх минут, распознаю всю запись разом и отправляю одним сообщением. После долгой речи отправка ждёт паузу в 5 секунд, чтобы не рвать мысль; короткая команда уходит почти сразу.',
        dictationSplitHint: 'Старое поведение: короткая пауза (около секунды) завершает фразу и отправляет её отдельным сообщением.',
        wakeNoEngine: 'Для активации по имени нужно локальное распознавание.',
      },
      en: {
        settingsNav: 'Voice dialog',
        assistantNav: 'Assistant',
        assistantIntro: 'Personality, rules and every voice assistant setting. Applies to the whole application, not to a single session.',
        personaTitle: 'Personality',
        personaHint: 'Who you are and how you behave. This text is added to the system prompt of new sessions.',
        addressTitle: 'How to address the user',
        addressHint: 'For example: "by name, respectfully" or "sir".',
        correctionsTitle: 'Corrections and rules',
        correctionsHint: 'One per line. These are your behaviour corrections: "do not end an answer with a question", "conclusion first, details after".',
        factsTitle: 'What to remember about the user',
        factsHint: 'One fact per line: name, habits, preferences. These lines go into the system prompt of new sessions.',
        saveProfile: 'Save',
        profileSaved: 'Saved',
        profileError: 'Could not save the assistant settings.',
        voiceSectionTitle: 'Voice',
        title: 'Voice dialog',
        intro: 'Local recognition and speech: audio never leaves this computer. Choose a microphone mode and how replies are delivered.',
        defaultMode: 'Microphone mode',
        modeNote: 'The microphone listens for the name all the time, but only while it is on: say "Valera" and command recognition starts. The capybara face turns it on and off, and that choice is remembered.',
        modeContinuous: 'Continuous dialog',
        modeHold: 'Hold the button',
        modeClick: 'Tap the button',
        modeContinuousHint: 'Listens again after every answer until you stop it.',
        modeHoldHint: 'Speak while holding; release to send.',
        modeClickHint: 'One tap records; the next recording needs a new tap.',
        reply: 'Assistant reply',
        replyVoice: 'With voice',
        replyText: 'Text only',
        language: 'Recognition language',
        langRu: 'Russian',
        langEn: 'English',
        langAuto: 'Detect automatically',
        engine: 'Speech engine',
        engineSilero: 'Silero (local) — the only engine',
        voice: 'Reading voice',
        voiceHint: 'Intonation and pauses follow the punctuation: a full stop, a question, an exclamation, a dash and an ellipsis all sound different. Stress and «ё» are placed automatically.',
        speed: 'Speech rate',
        speedSlow: 'Slow',
        speedNormal: 'Normal',
        speedFast: 'Fast',
        speedHint: 'Speeds the reading up or slows it down without flattening the intonation.',
        pauses: 'Pauses',
        pauseShort: 'Short',
        pauseNormal: 'Normal',
        pauseExpressive: 'Expressive',
        pauseHint: 'Stretches the pauses at punctuation: with “Expressive”, a full stop and an ellipsis sound like a reader’s.',
        voiceBaya: 'Baya — warm female',
        voiceKseniya: 'Kseniya — calm female',
        voiceXenia: 'Xenia — soft female',
        voiceAidar: 'Aidar — low male',
        voiceEugene: 'Eugene — even male',
        voiceRandom: 'Random voice',
        sensitivity: 'Microphone sensitivity',
        sensitivityLow: 'Low',
        sensitivityNormal: 'Normal',
        sensitivityHigh: 'High',
        speakTest: 'Test voice',
        testPhrase: 'Voice check: a full stop. A pause? An exclamation! And an ellipsis…',
        status: 'Engine status',
        statusAsr: 'Recognition',
        statusTts: 'Speech',
        ready: 'ready',
        missing: 'missing',
        checking: 'checking…',
        worker: 'Local engine',
        workerStopped: 'stopped',
        workerStarting: 'starting',
        workerReady: 'ready',
        listening: 'Listening…',
        starting: 'Starting microphone…',
        holdPrompt: 'Hold the microphone and speak',
        clickPrompt: 'Tap the microphone to start',
        transcribing: 'Transcribing…',
        thinking: 'Thinking…',
        speaking: 'Speaking…',
        idle: 'Voice mode is off',
        stop: 'Stop',
        mic: 'Voice input',
        micStart: 'Start voice input',
        micStop: 'Stop voice input',
        micOnTitle: 'Microphone is on — turn off',
        micOffTitle: 'Microphone is off — turn on',
        micOffState: 'off — press the capybara',
        samplesOn: 'Save',
        samplesOff: 'Do not save',
        samplesHint: 'Stores speech samples locally to train a custom wake-word model: name utterances as positives, speech without the name as negatives.',
        reading: 'Reading',
        samplesStart: 'Record voice',
        samplesLabelName: 'Label: name',
        samplesLabelBackground: 'Label: background',
        samplesStop: 'Stop recording',
        samplesSaved: 'Sample saved',
        samplesEmpty: 'Recording is too short',
        samplesFailed: 'Could not save the sample',
        recognized: 'Recognized',
        noSpeech: 'No speech recognized. Try again.',
        noSpeechStopped: 'No speech recognized three times in a row — continuous mode is off.',
        micDenied: 'The browser denied microphone access. Allow it in the site settings.',
        micMissing: 'No microphone found.',
        micBusy: 'The microphone is busy — wait a second and press again.',
        network: 'Local engine unavailable. Check that the Voice dialog plugin is enabled.',
        engineError: 'Engine error',
        submitError: 'Could not send the message',
        pendingQuestion: 'The assistant is waiting in the conversation — answer there, then enable voice mode again.',
        busy: 'The assistant is still answering — wait for the reply.',
        addedToDraft: 'Transcript added to the draft — review and send it manually.',
        tooLong: 'The recording was too long — cancelled.',
        continuousOn: 'Continuous dialog on',
        continuousOff: 'Continuous dialog off',
        voiceOn: 'Replies with voice',
        voiceOff: 'Replies as text',
        mode: 'Mode',
        speedNote: 'The first recognition loads the model (~3–5 s), then it is faster.',
        engineNote: 'Silero speaks Russian locally: pauses and intonation follow the punctuation, and stress is placed automatically. There is no other engine — English words are read by the same voice.',
        wakeTitle: 'Wake word activation',
        wakeHint: 'The microphone listens for the wake word and starts the dialog: on a match the plugin chimes and records your question. The microphone is busy while the assistant speaks.',
        wakeOn: 'Enabled',
        wakeOff: 'Disabled',
        wakeWordsLabel: 'Wake words (comma separated)',
        wakeExample: 'valera, valerchik, valeriy',
        wakeHeard: 'Heard the name — go ahead',
        listeningPrompts: [
          'Yes, I am listening.',
          'Did you say something?',
          'I am here, go ahead.',
          'Listening.',
          'Yes, go ahead.',
        ],
        queuedAsk: 'Got it — I will answer right after the current reply.',
        stopped: 'Stopped.',
        wakeArmed: 'Listening for the wake word',
        bargeTitle: 'Voice interruption',
        bargeHint: 'While the answer is read aloud, the microphone listens for the wake word. Say it and playback stops at once so you can speak a new command. Sending a message in chat also stops playback.',
        bargeOn: 'Enabled',
        bargeOff: 'Disabled',
        bargeOffHint: 'Interruption is off: only the stop button stops playback.',
        closePanel: 'Hide panel',
        followUpTitle: 'Listen after the answer',
        followUpOff: 'Off',
        followUpShort: '3 seconds',
        followUpLong: '5 seconds',
        followUpHint: 'After a spoken answer the microphone opens for this window: ask the next question without the wake word, like in a conversation. If nothing is said, it closes and waits for the wake word again.',
        assistantSessionTitle: 'Separate "Assistant" session',
        assistantSessionOn: 'Enabled',
        assistantSessionOff: 'Disabled',
        assistantSessionHint: 'Voice questions go to a separate "Assistant" session, keeping your chats clean. When off, they go to the current chat as before.',
        dictationTitle: 'Recording length',
        dictationWhole: 'Whole take',
        dictationSplit: 'Per pause',
        dictationWholeHint: 'Records up to three minutes, transcribes the whole take at once and sends it as one message. After a long stretch it waits for a 5-second pause so a thought is not cut; a short command goes out almost immediately.',
        dictationSplitHint: 'Old behaviour: a short pause (about a second) ends the phrase and sends it as a separate message.',
        wakeNoEngine: 'Wake word activation needs local recognition.',
      },
    }

    const MODES = ['continuous', 'hold', 'click']
    const VOICES = ['baya', 'kseniya', 'xenia', 'aidar', 'eugene', 'random']
    // Speech rate is Silero's prosody percent; pauses scale every punctuation break.
    const SPEEDS = [80, 100, 120]
    const PAUSES = [0.6, 1, 1.7]
    const THRESHOLDS = { low: 0.035, normal: 0.018, high: 0.01 }
    const SILENCE_MS = { low: 1500, normal: 1100, high: 800 }
    const MAX_UTTERANCE_MS = 45000
    const MAX_HOLD_MS = 120000
    // «Целиком» — режим диктовки: до 20 минут одной записью, чтобы можно
    // надиктовать длинный промт, главу или мемуары, а не склейку из кусков.
    const WHOLE_MAX_MS = 1200000
    const MAX_SILENT_WAIT_MS = 15000
    /** Слова, которыми заканчивают диктовку: не ждать десяти секунд тишины. */
    const DICTATION_END = ['закончил', 'закончила', 'закончили', 'все сказал', 'всё сказал', 'отправляй', 'конец записи', 'закончим на этом']
    const TURN_TIMEOUT_MS = 240000
    const TURN_WATCHDOG_MS = 25000
    const EMPTY_LIMIT = 3

    function defaultPreferences() {
      return {
        mode: 'click',
        // Микрофон по умолчанию выключен: приложение не включает его само,
        // а запоминает последнее состояние пользователя.
        micOn: false,
        // Собирать образцы речи для обучения своей KWS-модели (локально).
        collectSamples: true,
        // Метка для кнопки «Запись голоса»: pos — имя, neg — речь без имени и фон.
        sampleLabel: 'pos',
        output: 'voice',
        autoSpeakForeign: true,
        bargeIn: true,
        dictation: 'whole',
        followUp: 3000,
        assistantSession: false,
        wakeEnabled: true,
        wakeWords: 'валера, валерчик, валерий',
        language: 'ru',
        tts: 'silero',
        voice: 'baya',
        speed: 100,
        pauses: 1,
        browserVoice: '',
        sensitivity: 'normal',
        autoStop: true,
      }
    }

    function loadPreferences() {
      const base = defaultPreferences()
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return base
        const parsed = JSON.parse(raw)
        return {
          ...base,
          ...parsed,
          mode: MODES.includes(parsed.mode) ? parsed.mode : base.mode,
          output: parsed.output === 'text' ? 'text' : 'voice',
          language: ['ru', 'en', 'auto'].includes(parsed.language) ? parsed.language : base.language,
          tts: 'silero',
          bargeIn: parsed.bargeIn !== false,
          dictation: parsed.dictation === 'split' ? 'split' : 'whole',
          followUp: [0, 3000, 5000].includes(Number(parsed.followUp)) ? Number(parsed.followUp) : base.followUp,
          assistantSession: parsed.assistantSession === true,
          micOn: parsed.micOn === true,
          collectSamples: parsed.collectSamples !== false,
          sampleLabel: parsed.sampleLabel === 'neg' ? 'neg' : 'pos',
          voice: VOICES.includes(parsed.voice) ? parsed.voice : base.voice,
          speed: SPEEDS.includes(Number(parsed.speed)) ? Number(parsed.speed) : base.speed,
          pauses: PAUSES.includes(Number(parsed.pauses)) ? Number(parsed.pauses) : base.pauses,
          sensitivity: Object.prototype.hasOwnProperty.call(THRESHOLDS, parsed.sensitivity) ? parsed.sensitivity : base.sensitivity,
        }
      } catch { return base }
    }

    function savePreferences(preferences) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)) } catch { /* storage may be unavailable */ }
    }

    function stringsFor(localeId) {
      return String(localeId ?? '').toLowerCase().startsWith('ru') ? DICT.ru : DICT.en
    }

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...patch }
          for (const listener of listeners) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    }

    function useStore(store) {
      return useSyncExternalStore(store.subscribe, store.get, store.get)
    }

    function encodeWave(samples) {
      const bytes = new Uint8Array(44 + samples.length * 2)
      const view = new DataView(bytes.buffer)
      const text = (at, value) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i) }
      text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data')
      view.setUint32(40, samples.length * 2, true)
      for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]))
        view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      }
      return bytes
    }

    /**
     * Обрезать запись до участка речи. Микрофон активации может висеть открытым
     * минутами, и без обрезки в распознавание уходила вся эта тишина.
     */
    /**
     * Собрать WAV 16 кГц моно из PCM16 — тот же формат, что ждёт /transcribe.
     * Нужен для нарезки из кольцевого буфера, без остановки микрофона.
     */
    function encodePcm16Wave(samples) {
      const out = new Uint8Array(44 + samples.length * 2)
      const view = new DataView(out.buffer)
      const write = (offset, text) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
      }
      write(0, 'RIFF')
      view.setUint32(4, out.length - 8, true)
      write(8, 'WAVE')
      write(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, 16000, true)
      view.setUint32(28, 32000, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      write(36, 'data')
      view.setUint32(40, samples.length * 2, true)
      out.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 44)
      return out
    }

    /** Приклеить PCM16 в начало готового WAV (звук, сказанный до записи). */
    function prependPcm(wave, pcm) {
      try {
        const body = new Uint8Array(wave.buffer, wave.byteOffset + 44, wave.byteLength - 44)
        const total = pcm.length + Math.floor(body.length / 2)
        const merged = new Int16Array(total)
        merged.set(pcm, 0)
        merged.set(new Int16Array(body.buffer, body.byteOffset, Math.floor(body.length / 2)), pcm.length)
        return encodePcm16Wave(merged)
      } catch { return wave }
    }

    function trimWave(wave, startMs, endMs) {
      try {
        const view = new DataView(wave.buffer, wave.byteOffset, wave.byteLength)
        const sampleRate = view.getUint32(24, true)
        const total = Math.floor((wave.byteLength - 44) / 2)
        const start = Math.max(0, Math.min(total, Math.floor((startMs * sampleRate) / 1000)))
        const end = Math.max(start + 1, Math.min(total, Math.ceil((endMs * sampleRate) / 1000)))
        const length = (end - start) * 2
        const out = new Uint8Array(44 + length)
        out.set(wave.subarray(0, 44), 0)
        out.set(wave.subarray(44 + start * 2, 44 + end * 2), 44)
        const outView = new DataView(out.buffer)
        outView.setUint32(4, out.length - 8, true)
        outView.setUint32(40, length, true)
        return out
      } catch { return wave }
    }

    /** Turn Markdown into text worth speaking in the browser fallback. */
    function cleanForSpeech(text) {
      return String(text ?? '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/~~~[\s\S]*?~~~/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
        .replace(/[*_~|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    }

    class CaptureError extends Error {}

    /**
     * Делим ответ на короткие фразы: первую синтезируем сразу и начинаем
     * читать, пока синтезируются следующие. Так голос звучит почти мгновенно,
     * а не после обработки всего текста.
     */
    function splitSpeechBlocks(text, maxLength = 180) {
      const sentences = String(text ?? '').split(/(?<=[.!?…])\s+/).filter(part => part.trim() !== '')
      const blocks = []
      let current = ''
      const flush = () => {
        if (current.trim() !== '') blocks.push(current.trim())
        current = ''
      }
      const add = (piece) => {
        if (current === '') current = piece
        else if ((current + ' ' + piece).length <= maxLength) current += ' ' + piece
        else { flush(); current = piece }
      }
      for (const sentence of sentences) {
        if (sentence.length <= maxLength) { add(sentence); continue }
        flush()
        for (const clause of sentence.split(/(?<=,)\s+/)) {
          let rest = clause.trim()
          while (rest.length > maxLength) {
            let cut = rest.lastIndexOf(' ', maxLength)
            if (cut < 40) cut = maxLength
            blocks.push(rest.slice(0, cut).trim())
            rest = rest.slice(cut).trim()
          }
          if (rest !== '') add(rest)
        }
      }
      flush()
      return blocks
    }

    /** One microphone capture with a live level reading and 16 kHz PCM16 output. */
    class Capture {
      constructor() {
        this.stream = undefined
        this.recorder = undefined
        this.context = undefined
        this.analyser = undefined
        this.samples = new Float32Array(512)
        this.chunks = []
        this.disposed = false
      }

      async start() {
        const devices = navigator.mediaDevices
        if (!devices) throw new CaptureError('unavailable')
        if (typeof MediaRecorder === 'undefined') throw new CaptureError('unavailable')
        let stream
        try {
          stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
        } catch (error) {
          const name = error && error.name
          if (name === 'NotAllowedError' || name === 'SecurityError') throw new CaptureError('permission')
          if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CaptureError('missing')
          // Прослушивание имени только что отпустило микрофон: Windows отдаёт
          // NotReadableError, если устройство ещё доосвобождается.
          if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') throw new CaptureError('busy')
          throw new CaptureError('unavailable')
        }
        if (this.disposed) {
          for (const track of stream.getTracks()) track.stop()
          throw new CaptureError('cancelled')
        }
        this.stream = stream
        this.context = new AudioContext()
        // Политика автовоспроизведения может держать контекст на паузе:
        // без running анализатор отдаёт нули, и кодовое слово не поймать.
        try { await this.context.resume() } catch { /* жест пользователя разбудит позже */ }
        this.analyser = this.context.createAnalyser()
        this.analyser.fftSize = 512
        this.source = this.context.createMediaStreamSource(stream)
        this.source.connect(this.analyser)
        this.recorder = new MediaRecorder(stream)
        this.recorder.ondataavailable = (event) => { if (!this.disposed && event.data.size > 0) this.chunks.push(event.data) }
        this.recorder.start()
      }

      amplitude() {
        if (!this.analyser) return 0
        this.analyser.getFloatTimeDomainData(this.samples)
        let sum = 0
        for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] * this.samples[i]
        return Math.sqrt(sum / this.samples.length)
      }

      /** Разбудить аудиоконтекст после жеста пользователя, если браузер его усыпил. */
      resume() {
        if (!this.context || this.context.state !== 'suspended') return
        try { void this.context.resume() } catch { /* останется на паузе */ }
      }

      async stop() {
        const recorder = this.recorder
        const context = this.context
        if (!recorder || !context || recorder.state !== 'recording') {
          await this.dispose()
          throw new CaptureError('empty')
        }
        try {
          await new Promise((resolve, reject) => {
            recorder.onstop = resolve
            recorder.onerror = () => reject(new CaptureError('empty'))
            recorder.stop()
          })
          for (const track of this.stream.getTracks()) track.stop()
          const blob = new Blob(this.chunks, { type: recorder.mimeType })
          if (blob.size === 0) throw new CaptureError('empty')
          const decoded = await context.decodeAudioData(await blob.arrayBuffer())
          const length = Math.max(1, Math.floor(decoded.duration * 16000))
          const offline = new OfflineAudioContext(1, length, 16000)
          const source = offline.createBufferSource()
          source.buffer = decoded
          source.connect(offline.destination)
          source.start()
          const rendered = await offline.startRendering()
          return { wave: encodeWave(rendered.getChannelData(0)), seconds: decoded.duration }
        } finally {
          await this.dispose()
        }
      }

      async dispose() {
        this.disposed = true
        try { this.detachWake?.() } catch { /* поток уже отключён */ }
        this.detachWake = undefined
        if (this.source) {
          try { this.source.disconnect() } catch { /* уже отключён */ }
          this.source = undefined
        }
        if (this.recorder && this.recorder.state === 'recording') {
          try { this.recorder.stop() } catch { /* already stopped */ }
        }
        if (this.stream) {
          for (const track of this.stream.getTracks()) track.stop()
          this.stream = undefined
        }
        if (this.context && this.context.state !== 'closed') {
          try { await this.context.close() } catch { /* already closed */ }
        }
        this.context = undefined
        this.analyser = undefined
        this.chunks = []
      }
    }

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    function looksCanceled(error) {
      return error instanceof DOMException && error.name === 'AbortError'
    }

    /** Расстояние Левенштейна: распознавание может переставить или потерять букву. */
    function editDistance(a, b) {
      if (a === b) return 0
      if (a.length === 0 || b.length === 0) return Math.max(a.length, b.length)
      let previous = new Array(b.length + 1)
      let current = new Array(b.length + 1)
      for (let j = 0; j <= b.length; j += 1) previous[j] = j
      for (let i = 1; i <= a.length; i += 1) {
        current[0] = i
        for (let j = 1; j <= b.length; j += 1) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1
          current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
        }
        const swap = previous
        previous = current
        current = swap
      }
      return previous[b.length]
    }

    /** Привести распознанный текст к виду для сравнения: без регистра, пунктуации и «ё». */
    function normalizeSpeech(text) {
      return String(text ?? '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        // Аканье и иканье: распознавание часто пишет «Олера» вместо «Валера»,
        // «валИрий» вместо «валЕрий». Сводим гласные к одной форме с обеих сторон.
        .replace(/[оа]/g, 'а')
        .replace(/[ыи]/g, 'и')
        .replace(/\s+/g, ' ')
        .trim()
    }

    /**
     * Найти кодовое слово в НАЧАЛЕ фразы.
     * Допускает одну опечатку распознавания в слове длиной от четырёх букв.
     * Возвращает остаток фразы: если он не пуст, это сразу готовая команда.
     */
    function matchWakePhrase(text, words, options = {}) {
      const anywhere = options.anywhere !== false
      const normalized = normalizeSpeech(text)
      if (normalized === '') return { hit: false, rest: '' }
      const tokens = normalized.split(' ')
      const originalTokens = String(text ?? '').trim().split(/\s+/).filter(Boolean)
      const phrases = String(words ?? '')
        .split(',')
        .map((item) => normalizeSpeech(item).split(' ').filter(Boolean))
        .filter((phrase) => phrase.length > 0)
      // Имя ищем в ЛЮБОМ месте фразы, как Алиса: важно только оно, а всё, что
      // сказано после него, считаем командой. Слова до имени игнорируем.
      // В окне продолжения ищем только в начале, иначе имя внутри команды
      // («спроси у Валеры») съело бы половину фразы.
      for (const phrase of phrases) {
        if (phrase.length > tokens.length) continue
        const maxOffset = anywhere ? tokens.length - phrase.length : 1
        for (let offset = 0; offset <= maxOffset; offset += 1) {
          if (!anywhere && offset === 1 && !WAKE_LEAD_FILLERS.has(tokens[0])) continue
          let ok = true
          for (let i = 0; i < phrase.length; i += 1) {
            const allowed = phrase[i].length >= 4 ? 1 : 0
            if (editDistance(tokens[offset + i], phrase[i]) > allowed) { ok = false; break }
          }
          if (!ok) continue
          const cut = offset + phrase.length
          const rest = originalTokens.length >= cut
            ? originalTokens.slice(cut).join(' ')
            : tokens.slice(cut).join(' ')
          return { hit: true, rest }
        }
      }
      return { hit: false, rest: '' }
    }

    /** Вводные слова, которые можно сказать перед именем. */
    const WAKE_LEAD_FILLERS = new Set(['ну', 'э', 'ээ', 'эээ', 'а', 'аа', 'так', 'вот', 'ага', 'угу', 'мм', 'ммм'])

    /** Стоп-слова: «Валера, стоп» прекращает озвучку, ничего не записывая. */
    const STOP_WORDS = new Set(['стоп', 'остановись', 'отмена', 'хватит', 'замолчи', 'тихо', 'прекрати'])

    function isStopPhrase(text) {
      const words = String(text ?? '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean)
      return words.length === 1 && STOP_WORDS.has(words[0])
    }

    /** Случайная фраза-подсказка, когда имя услышали, а команду — нет. */
    function pickListeningPrompt(strings) {
      const list = Array.isArray(strings?.listeningPrompts) && strings.listeningPrompts.length > 0
        ? strings.listeningPrompts
        : ['Да, я вас слушаю.']
      return list[Math.floor(Math.random() * list.length)]
    }

    /** Слова-заполнители: после имени их не считаем командой. */
    const WAKE_FILLERS = new Set(['э', 'ээ', 'эээ', 'а', 'аа', 'ну', 'ага', 'угу', 'мм', 'ммм', 'вот', 'так'])

    function stripWakeFillers(text) {
      const words = String(text ?? '').trim().split(/\s+/).filter(Boolean)
      while (words.length > 0) {
        const head = words[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
        if (!WAKE_FILLERS.has(head)) break
        words.shift()
      }
      return words.join(' ')
    }

    // Собственный звук плагина (сигналы) попадает в микрофон. Пока он звучит,
    // детекторы речи молчат, иначе плагин реагирует сам на себя.
    let selfSoundUntil = 0
    function markSelfSound(milliseconds) {
      selfSoundUntil = Math.max(selfSoundUntil, Date.now() + milliseconds)
    }

    /** Мягкий сигнал «готов слушать»: звучит, когда открывается окно продолжения. */
    function playReadyChime() {
      markSelfSound(600)
      try {
        const AudioCtor = window.AudioContext || window.webkitAudioContext
        if (!AudioCtor) return
        const context = new AudioCtor()
        const start = context.currentTime
        for (const [frequency, offset] of [[784, 0], [988, 0.14]]) {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          oscillator.type = 'sine'
          oscillator.frequency.value = frequency
          gain.gain.setValueAtTime(0.0001, start + offset)
          gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18)
          oscillator.connect(gain).connect(context.destination)
          oscillator.start(start + offset)
          oscillator.stop(start + offset + 0.2)
        }
        setTimeout(() => { void context.close().catch(() => undefined) }, 700)
      } catch { /* звук не критичен */ }
    }

    /** Двухтональный сигнал «услышал имя». */
    function playChime() {
      markSelfSound(700)
      try {
        const AudioCtor = window.AudioContext || window.webkitAudioContext
        if (!AudioCtor) return
        const context = new AudioCtor()
        const start = context.currentTime
        for (const [frequency, offset] of [[988, 0], [1319, 0.16]]) {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          oscillator.type = 'sine'
          oscillator.frequency.value = frequency
          gain.gain.setValueAtTime(0.0001, start + offset)
          gain.gain.exponentialRampToValueAtTime(0.22, start + offset + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22)
          oscillator.connect(gain).connect(context.destination)
          oscillator.start(start + offset)
          oscillator.stop(start + offset + 0.24)
        }
        setTimeout(() => { void context.close().catch(() => undefined) }, 900)
      } catch { /* звук не критичен для работы */ }
    }

    /** One shared controller serving both composer entries and the settings page. */
    function createController() {
      const store = createStore({
        preferences: loadPreferences(),
        strings: DICT.ru,
        phase: 'idle',
        enabled: false,
        wakeListening: false,
        activeSession: '',
        level: 0,
        transcript: '',
        heardText: '',
        wakeScore: 0,
        speakIndex: 0,
        speakTotal: 0,
        speakSkipped: 0,
        lastSpokenText: '',
        lastSpokenAt: 0,
        sampleRecording: false,
        sampleSeconds: 0,
        error: '',
        notice: '',
        engine: { asr: false, tts: false, worker: 'stopped', mode: 'auto', checked: false },
      })
      const runtime = {
        capture: undefined,
        captureSession: '',
        generation: 0,
        starting: false,
        pending: undefined,
        envs: new Map(),
        lastSpoken: new Map(),
        running: new Map(),
        vadTimer: undefined,
        turnTimer: undefined,
        watchdogTimer: undefined,
        errorTimer: undefined,
        noticeTimer: undefined,
        audio: undefined,
        audioCancel: undefined,
        ttsAbort: undefined,
        transcribeAbort: undefined,
        speechCanceled: false,
        emptyAttempts: 0,
        foreignSession: '',
        wakeCapture: undefined,
        wakeVadTimer: undefined,
        wakeBusy: false,
        wakeWarmed: false,
        wakeNextAt: 0,
        bargeCapture: undefined,
        bargeTimer: undefined,
        bargeBusy: false,
        bargeTriggers: 0,
        wakeFollowUp: false,
        wakeChimed: false,
        wakeFailNotified: false,
        wakeStarts: 0,
        wakeResponses: 0,
        wakeCalls: 0,
        // Кольцевой буфер последних 20 секунд: нарезка без остановки микрофона.
        wakeRing: { chunks: [], samples: 0, base: 0 },
        wakeSegs: 0,
        wakeSegSamples: 0,
        wakeSegText: '',
        // Звук, уже сказанный после имени: приклеим его к началу записи.
        prefixPcm: undefined,
        prefixUsed: false,
        wakePeak: 0,
        wakeLastText: '',
        wakeHits: 0,
        wakeFails: 0,
        stuckPhase: '',
        stuckSince: 0,
        wakeFollowAttempts: 0,
        followUpListen: false,
        voiceTurn: false,
        thinkCapture: undefined,
        thinkTimer: undefined,
        thinkBusy: false,
      }

      const controller = {
        store,
        lastEnv: undefined,
        setStrings(strings) { store.set({ strings }) },
        setPreferences(patch) {
          const preferences = { ...store.get().preferences, ...patch }
          savePreferences(preferences)
          store.set({ preferences })
          if (patch.mode !== undefined && patch.mode !== 'continuous' && store.get().enabled) {
            void controller.stopAll()
          }
          if (patch.wakeEnabled !== undefined) {
            if (preferences.wakeEnabled) {
              runtime.wakeNextAt = 0
              controller.notice(store.get().strings.wakeArmed)
              void controller.ensureWake()
            } else void controller.stopWake()
          }
          if (patch.bargeIn !== undefined) {
            if (preferences.bargeIn === false) void controller.stopBarge()
            else if (store.get().phase === 'speaking') void controller.startBarge()
          }
          // Динамик рядом с микрофоном: переключение на текст сразу гасит чтение.
          if (patch.output !== undefined && preferences.output === 'text') controller.stopSpeaking()
          // Тумблер микрофона: выключили — освобождаем устройство, включили — снова слушаем имя.
          if (patch.micOn !== undefined) {
            runtime.wakeNextAt = 0
            if (preferences.micOn !== true) {
              void controller.stopAll()
              void controller.stopWake()
            } else {
              void controller.ensureWake()
            }
          }
        },
        /** Клик по капибаре: включить или выключить микрофон. */
        toggleMic() {
          const on = store.get().preferences.micOn === true
          controller.setPreferences({ micOn: !on })
        },
        clearMessages() {
          clearTimeout(runtime.errorTimer)
          clearTimeout(runtime.noticeTimer)
          store.set({ error: '', notice: '' })
        },
        fail(message) {
          clearTimeout(runtime.noticeTimer)
          clearTimeout(runtime.errorTimer)
          store.set({ error: message, notice: '', phase: 'idle' })
          runtime.errorTimer = setTimeout(() => { store.set({ error: '' }) }, 10000)
        },
        notice(message) {
          clearTimeout(runtime.errorTimer)
          clearTimeout(runtime.noticeTimer)
          store.set({ notice: message, error: '' })
          runtime.noticeTimer = setTimeout(() => { store.set({ notice: '' }) }, 8000)
        },
        async refreshEngine() {
          try {
            const response = await fetch(`${BASE}/status`, { signal: AbortSignal.timeout(8000) })
            if (!response.ok) throw new Error(String(response.status))
            const value = await response.json()
            store.set({ engine: { ...value, checked: true } })
          } catch {
            store.set({ engine: { asr: false, tts: false, worker: 'stopped', mode: 'auto', checked: true } })
          }
        },
        observe(env) {
          if (!env || !env.sessionId) return
          const previous = runtime.running.get(env.sessionId)
          runtime.running.set(env.sessionId, env.running)
          runtime.envs.set(env.sessionId, env)
          controller.lastEnv = env
          if (env.running === true && previous !== true && !runtime.pending) {
            runtime.foreignSession = env.sessionId
            controller.stopSpeaking()
            void controller.stopWake()
            if (runtime.captureSession === env.sessionId && store.get().phase === 'listening') void controller.cancelListening()
          }
          if (env.running === true && runtime.pending && runtime.pending.sessionId === env.sessionId) {
            runtime.pending.sawRunning = true
          }
          if (previous === true && env.running === false) {
            if (runtime.pending && runtime.pending.sessionId === env.sessionId) {
              void controller.finishTurn(env)
              return
            }
            if (runtime.foreignSession === env.sessionId) {
              runtime.foreignSession = ''
              // Ответ на «чужой» ход (например, отправленный голосовой активацией
              // «Валера») тоже озвучиваем, если выбран голосовой ответ.
              if (!runtime.pending && store.get().preferences.output === 'voice' && store.get().preferences.autoSpeakForeign !== false) {
                void controller.speakForeign(env.sessionId)
              }
              if (store.get().enabled && store.get().preferences.mode === 'continuous' && store.get().activeSession === env.sessionId) {
                setTimeout(() => {
                  const latest = runtime.envs.get(env.sessionId)
                  if (store.get().enabled && latest && !latest.running && store.get().phase === 'idle') void controller.startRecording(latest)
                }, 400)
              }
            }
          }
        },
        /**
         * Можно ли сейчас держать микрофон открытым ради кодового слова:
         * диалог выключен, ассистент не говорит и не думает, микрофон свободен.
         */
        wakeAllowed() {
          const state = store.get()
          if (!state.preferences.wakeEnabled) return false
          // Тумблер на морде капибары: выключили — микрофон не открываем вообще.
          if (state.preferences.micOn !== true) return false
          if (state.enabled) return false
          // Фаза может рассинхронизироваться (застряла на «transcribing» и т.п.),
          // поэтому смотрим на реальные ресурсы, а не на ярлык фазы: если запись
          // не идёт и ответ не ждётся, слушать имя можно всегда.
          if (runtime.capture || runtime.wakeCapture || runtime.wakeBusy) return false
          if (runtime.pending) return false
          if (runtime.audio || runtime.ttsAbort) return false
          // Ход ассистента не мешает слушать имя: микрофон работает всегда,
          // пока включён тумблер. Раньше занятая сессия глушила активацию.
          return true
        },
        /** Передать жест пользователя аудиоконтексту прослушивания. */
        resumeAudio() {
          runtime.wakeCapture?.resume()
        },
        /** Идемпотентно запустить прослушивание кодового слова. */
        async ensureWake() {
          if (runtime.wakeCapture || runtime.wakeBusy) return
          // Состояние могло рассинхронизироваться: флаг «слушаю» без потока.
          if (!runtime.wakeCapture && store.get().wakeListening) store.set({ wakeListening: false })
          if (Date.now() < runtime.wakeNextAt) return
          if (!controller.wakeAllowed()) return
          runtime.wakeNextAt = Date.now() + 600
          await controller.startWakeCapture()
        },
        async startWakeCapture() {
          // Сессия не обязательна: микрофон слушает имя постоянно, а env
          // понадобится только чтобы отправить распознанную команду.
          const env = controller.lastEnv
          if (!runtime.wakeWarmed) {
            runtime.wakeWarmed = true
            // Готовим только распознавание: озвучка загрузится при первом ответе.
            void fetch(`${BASE}/warm`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ language: store.get().preferences.language, tts: false }),
              signal: AbortSignal.timeout(3000),
            }).catch(() => undefined)
          }
          const capture = new Capture()
          runtime.wakeCapture = capture
          // Новый захват — новый буфер: старые отсчёты не должны смешиваться.
          runtime.wakeRing = { chunks: [], samples: 0, base: 0 }
          try {
            await capture.start()
          } catch (error) {
            if (runtime.wakeCapture === capture) runtime.wakeCapture = undefined
            await capture.dispose()
            // Небольшая пауза и снова: постоянно открытый микрофон важнее.
            runtime.wakeNextAt = Date.now() + 1500
            runtime.wakeFails += 1
            // Один раз объясняем, почему молчит, а не повторяем бесконечно.
            if (!runtime.wakeFailNotified) {
              runtime.wakeFailNotified = true
              const strings = store.get().strings
              const message = error instanceof CaptureError && error.message === 'permission' ? strings.micDenied
                : error instanceof CaptureError && error.message === 'missing' ? strings.micMissing
                  : error instanceof CaptureError && error.message === 'busy' ? strings.micBusy
                    : strings.network
              controller.fail(message)
            }
            return
          }
          runtime.wakeFailNotified = false
          runtime.wakeStarts += 1
          if (runtime.wakeCapture !== capture) { await capture.dispose(); return }
          const captureStartedAt = Date.now()
          runtime.wakeStartedAt = captureStartedAt
          store.set({ wakeListening: true })
          runtime.wakeChimed = false
          runtime.wakeHost = undefined
          capture.detachWake = controller.startWakeStreaming(capture)
          // Если дорожка микрофона оборвалась, сразу переоткрываем поток,
          // иначе прослушивание остаётся «включённым», но глухим навсегда.
          try {
            for (const track of capture.stream?.getAudioTracks?.() ?? []) {
              track.addEventListener('ended', () => { void controller.stopWake(true) })
            }
          } catch { /* не критично */ }
          const threshold = THRESHOLDS[store.get().preferences.sensitivity] ?? THRESHOLDS.normal
          // Пауза после имени: сигнал всё равно звучит сразу (по частичному
          // тексту), а окно ждёт 0,9 с — короткая пауза перед командой не
          // обрывает фразу, и «Валера, …» уходит одним куском.
          const silenceMs = 900
          let heard = false
          let speechStarted = 0
          let lastVoice = Date.now()
          let windowStart = Date.now()
          let lastPublish = 0
          let stillTicks = 0
          clearInterval(runtime.wakeVadTimer)
          runtime.wakeVadTimer = setInterval(() => {
            if (runtime.wakeCapture !== capture) { clearInterval(runtime.wakeVadTimer); return }
            const state = store.get()
            // Останавливаемся только по реальным причинам: диалог выключен,
            // микрофон занят записью или ассистент читает ответ. Фаза может
            // застрять, и тогда прослушивание имени больше не включится.
            if (!state.preferences.wakeEnabled || state.preferences.micOn !== true || state.enabled || runtime.capture || runtime.audio) {
              void controller.stopWake()
              return
            }
            const now = Date.now()
            if (now < selfSoundUntil) { heard = false; lastVoice = now; return }
            capture.resume()
            const level = capture.amplitude()
            // Мёртвый поток отдаёт ровно нули: переоткрываем микрофон.
            if (level < 1e-6) {
              stillTicks += 1
              if (stillTicks > 40) { void controller.stopWake(true); return }
            } else {
              stillTicks = 0
            }
            // Уровень нужен кнопке микрофона: она подсвечивается, пока слушаем имя.
            if (now - lastPublish > 110) {
              lastPublish = now
              store.set({ level: Math.min(1, level * 6) })
            }
            if (!heard && now - windowStart > 15000) windowStart = now
            // Решает VAD в хосте (Silero), но только когда он уже услышал речь:
            // до этого работает локальный уровень, иначе на фоновом шуме VAD
            // молчит и имя перестаёт срабатывать вовсе.
            const host = runtime.wakeHost
            const hostFresh = host && now - host.at < 900
            // Срабатываем, если речь увидел VAD ИЛИ локальный уровень: тихое
            // «Валера» VAD иногда не различает, и окно не закрывалось.
            const voiced = (hostFresh && host.speech) || level >= threshold
            if (voiced) {
              if (!heard) speechStarted = now
              heard = true
              lastVoice = now
            }
            const silenceFor = hostFresh && heard ? host.silenceMs : now - lastVoice
            // Фразу разбираем из буфера, а микрофон не закрываем: если имени
            // нет, прослушивание продолжается тем же потоком.
            if (heard && silenceFor >= silenceMs && now - speechStarted >= 250) {
              heard = false
              void controller.wakeSegment({
                startMs: Math.max(0, speechStarted - 400 - captureStartedAt),
                endMs: Math.max(0, lastVoice + 700 - captureStartedAt),
              })
              return
            }
            if (heard && now - speechStarted > 12000) {
              heard = false
              void controller.wakeSegment({
                startMs: Math.max(0, speechStarted - 400 - captureStartedAt),
                endMs: Math.max(0, lastVoice + 700 - captureStartedAt),
              })
            }
          }, 80)
        },
        /**
         * Поток кодового слова: частичный текст приходит прямо во время речи,
         * поэтому сигнал звучит почти сразу после имени, а не после паузы 0,4 с.
         */
        startWakeStreaming(capture, prefix = 'wake', onUpdate) {
          const context = capture.context
          const source = capture.source
          if (!context || !source || typeof context.createScriptProcessor !== 'function') return () => undefined
          const key = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const ratio = context.sampleRate / 16000
          const processor = context.createScriptProcessor(4096, 1, 1)
          let disposed = false
          let inFlight = false
          let pending = []
          // Кадры копятся в очередь и уходят слитно: звук не теряется, поэтому
          // кольцевой буфер идёт вровень с реальным временем.
          const flush = () => {
            if (disposed || inFlight || pending.length === 0) return
            const parts = pending
            pending = []
            let total = 0
            for (const part of parts) total += part.length
            let body = parts[0]
            if (parts.length > 1) {
              body = new Int16Array(total)
              let at = 0
              for (const part of parts) { body.set(part, at); at += part.length }
            }
            inFlight = true
            fetch(`${BASE}/wake`, {
              method: 'POST',
              headers: { 'content-type': 'application/octet-stream', 'x-wake-key': key },
              body: body.buffer,
            }).then((response) => (response.ok ? response.json() : undefined))
              .then((value) => {
                if (disposed || !value) return
                runtime.wakeResponses += 1
                const update = {
                  text: typeof value.text === 'string' ? value.text : '',
                  speech: value.speech === true,
                  silenceMs: Number(value.silenceMs) || 0,
                  spoken: value.spoken === true,
                  at: Date.now(),
                }
                if (update.text !== runtime.wakeLastText) {
                  runtime.wakeLastText = update.text
                  store.set({ heardText: update.text })
                }
                if (typeof onUpdate === 'function') { onUpdate(update); return }
                runtime.wakeHost = update
                // Своя KWS-модель: хост отдаёт вероятность имени на последних 1,5 с.
                const trigger = Number(value.kws) > 0 ? Number(value.kws) : 0.85
                if (typeof value.score === 'number') store.set({ wakeScore: value.score })
                if (typeof value.score === 'number' && value.score >= trigger && !runtime.wakeChimed) {
                  runtime.wakeChimed = true
                  runtime.wakeHits += 1
                  void controller.wakeActivate()
                }
                if (update.text !== '') controller.wakePartial(update.text)
              })
              .catch(() => undefined)
              .finally(() => { inFlight = false; if (pending.length > 0) flush() })
          }
          processor.onaudioprocess = (event) => {
            if (disposed) return
            // Отправляем ВСЁ, включая тишину: VAD должен видеть конец речи,
            // иначе он залипает в состоянии «говорит» и окно не закрывается.
            const input = event.inputBuffer.getChannelData(0)
            runtime.wakeCalls += 1
            let peak = 0
            for (let k = 0; k < input.length; k += 8) peak = Math.max(peak, Math.abs(input[k]))
            runtime.wakePeak = peak
            const count = Math.max(1, Math.floor(input.length / ratio))
            // Микрофоны бывают тихими: подтягиваем уровень, иначе VAD и
            // распознавание слышат шорох вместо речи.
            const gain = peak > 1e-4 && peak < 0.15 ? Math.min(4, 0.15 / peak) : 1
            const pcm = new Int16Array(count)
            for (let index = 0; index < count; index += 1) {
              const from = Math.floor(index * ratio)
              const to = Math.min(input.length, Math.floor((index + 1) * ratio))
              let sum = 0
              for (let i = from; i < to; i += 1) sum += input[i]
              const value = to > from ? sum / (to - from) : 0
              pcm[index] = Math.max(-1, Math.min(1, value * gain)) * 32767
            }
            // Копим последние 20 секунд: когда VAD решит, что фраза кончилась,
            // нарежем кусок из буфера, не закрывая микрофон.
            if (prefix === 'wake') {
              const ring = runtime.wakeRing
              ring.chunks.push(pcm)
              ring.samples += pcm.length
              const limit = 16000 * 20
              while (ring.samples > limit && ring.chunks.length > 1) {
                const dropped = ring.chunks.shift()
                ring.samples -= dropped.length
                ring.base += dropped.length
              }
            }
            pending.push(pcm)
            flush()
          }
          source.connect(processor)
          processor.connect(context.destination)
          return () => {
            disposed = true
            try { processor.disconnect() } catch { /* уже отключён */ }
            try { source.disconnect(processor) } catch { /* уже отключён */ }
          }
        },

        /**
         * Частичный текст из потока: услышали имя — сразу открываем запись,
         * не дожидаясь конца фразы. Шум и тишину отсеивает уже запись.
         */
        wakePartial(text) {
          const state = store.get()
          if (!state.wakeListening || runtime.wakeChimed) return
          const match = matchWakePhrase(text, state.preferences.wakeWords)
          if (!match.hit) return
          if (isStopPhrase(stripWakeFillers(match.rest))) return
          runtime.wakeChimed = true
          runtime.wakeHits += 1
          void controller.wakeActivate()
        },

        /** Имя услышано — переключаемся с прослушивания на запись команды. */
        async wakeActivate() {
          if (runtime.wakeBusy) return
          if (runtime.capture) return
          const target = controller.lastEnv
          if (!target) return
          runtime.wakeBusy = true
          try {
            runtime.wakeFollowUp = true
            runtime.wakeFollowAttempts = 0
            controller.notice(store.get().strings.wakeHeard)
            // Только короткий хвост перед переключением: слова, сказанные
            // до имени, в запись попадать не должны.
            const elapsed = Date.now() - (runtime.wakeStartedAt || Date.now())
            runtime.prefixPcm = controller.wakeSegmentWave({
              startMs: Math.max(0, elapsed - 700),
              endMs: elapsed,
            })
            // Имя услышано — это положительный образец для обучения KWS.
            controller.collectSample(runtime.prefixPcm, true)
            await controller.stopWake()
            await controller.startRecording(target)
          } finally {
            runtime.wakeBusy = false
          }
        },

        /** Закрыть микрофон активации перед записью, озвучкой или выключением. */
        async stopWake(restart = false) {
          clearInterval(runtime.wakeVadTimer)
          runtime.wakeVadTimer = undefined
          const capture = runtime.wakeCapture
          runtime.wakeCapture = undefined
          if (store.get().wakeListening) store.set({ wakeListening: false, level: 0 })
          if (capture) await capture.dispose()
          runtime.wakeNextAt = Date.now() + (restart ? 400 : 0)
        },
        /** Разобрать короткий фрагмент: если это кодовое слово — запустить диалог. */
        /**
         * Образец для обучения KWS: положительный — имя услышано, отрицательный —
         * речь без имени. Пишется только при включённом сборе в настройках.
         */
        collectSample(samples, hit) {
          if (store.get().preferences.collectSamples !== true) return
          if (!samples || samples.length < 16000 * 0.4) return
          const now = Date.now()
          if (now - (runtime.sampleAt ?? 0) < 1500) return
          runtime.sampleAt = now
          runtime.samplePosts = (runtime.samplePosts ?? 0) + 1
          try {
            void fetch(`${BASE}/sample`, {
              method: 'POST',
              headers: { 'content-type': 'audio/wav', 'x-sample-label': hit ? 'pos' : 'neg' },
              body: samples instanceof Uint8Array ? samples : encodePcm16Wave(samples),
            }).catch(() => undefined)
          } catch { /* сбор образцов не должен мешать активации */ }
        },
        /** Кнопка «Запись голоса»: пишем PCM, пока не нажмут ещё раз. */
        async startVoiceRecord() {
          if (runtime.voiceRecord) return
          const strings = store.get().strings
          await controller.stopWake()
          const capture = new Capture()
          try {
            await capture.start()
          } catch {
            await capture.dispose()
            controller.fail(strings.micBusy)
            void controller.ensureWake()
            return
          }
          const context = capture.context
          const source = capture.source
          const ratio = context.sampleRate / 16000
          const processor = context.createScriptProcessor(4096, 1, 1)
          const chunks = []
          processor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0)
            const count = Math.max(1, Math.floor(input.length / ratio))
            const pcm = new Int16Array(count)
            for (let index = 0; index < count; index += 1) {
              const from = Math.floor(index * ratio)
              const to = Math.min(input.length, Math.floor((index + 1) * ratio))
              let sum = 0
              for (let k = from; k < to; k += 1) sum += input[k]
              const value = to > from ? sum / (to - from) : 0
              pcm[index] = Math.max(-1, Math.min(1, value)) * 32767
            }
            if (chunks.length < 16000 * 60 / 1365) chunks.push(pcm)
          }
          source.connect(processor)
          processor.connect(context.destination)
          runtime.voiceRecord = { capture, processor, chunks, startedAt: Date.now() }
          store.set({ sampleRecording: true, sampleSeconds: 0 })
          clearInterval(runtime.sampleTimer)
          runtime.sampleTimer = setInterval(() => {
            const record = runtime.voiceRecord
            if (!record) return
            store.set({ sampleSeconds: Math.floor((Date.now() - record.startedAt) / 1000) })
          }, 500)
          controller.notice(strings.samplesStart)
        },

        async stopVoiceRecord() {
          const record = runtime.voiceRecord
          if (!record) return
          runtime.voiceRecord = undefined
          clearInterval(runtime.sampleTimer)
          runtime.sampleTimer = undefined
          store.set({ sampleRecording: false, sampleSeconds: 0 })
          try { record.processor.disconnect() } catch { /* уже отключён */ }
          try { record.capture.source?.disconnect?.(record.processor) } catch { /* уже отключён */ }
          try { await record.capture.dispose() } catch { /* уже закрыт */ }
          const strings = store.get().strings
          const seconds = (Date.now() - record.startedAt) / 1000
          let total = 0
          for (const chunk of record.chunks) total += chunk.length
          if (total < 16000 * 0.3) {
            controller.notice(strings.samplesEmpty)
          } else {
            const merged = new Int16Array(total)
            let at = 0
            for (const chunk of record.chunks) { merged.set(chunk, at); at += chunk.length }
            try {
              const response = await fetch(`${BASE}/sample`, {
                method: 'POST',
                headers: {
                  'content-type': 'audio/wav',
                  'x-sample-label': store.get().preferences.sampleLabel === 'neg' ? 'neg' : 'pos',
                },
                body: encodePcm16Wave(merged),
              })
              if (!response.ok) throw new Error(String(response.status))
              controller.notice(`${strings.samplesSaved}: ${seconds.toFixed(1)} с`)
            } catch {
              controller.notice(strings.samplesFailed)
            }
          }
          runtime.wakeNextAt = 0
          void controller.ensureWake()
        },
        /** Вырезать участок фразы из кольцевого буфера (без остановки микрофона). */
        wakeSegmentWave(segment) {
          const ring = runtime.wakeRing
          if (ring.samples === 0) return undefined
          // Буфер скользящий: переводим абсолютные отсчёты захвата в индексы
          // буфера через его начало (ring.base), иначе нарезается не тот кусок.
          const startAbs = Math.floor(segment.startMs * 16)
          const endAbs = Math.ceil(segment.endMs * 16)
          const startS = Math.max(0, startAbs - ring.base)
          const endS = Math.min(ring.samples, endAbs - ring.base)
          if (endS - startS < 1600) return undefined
          const out = new Int16Array(endS - startS)
          let index = 0
          let written = 0
          for (const chunk of ring.chunks) {
            const chunkStart = index
            const chunkEnd = index + chunk.length
            index = chunkEnd
            if (chunkEnd <= startS || chunkStart >= endS) continue
            const from = Math.max(startS, chunkStart) - chunkStart
            const to = Math.min(endS, chunkEnd) - chunkStart
            if (to <= from) continue
            out.set(chunk.subarray(from, to), written)
            written += to - from
          }
          return written > 0 ? out.subarray(0, written) : undefined
        },
        /**
         * Разобрать фразу из буфера, НЕ закрывая микрофон: если имени нет —
         * прослушивание продолжается тем же потоком (Windows не мигает).
         */
        async wakeSegment(segment) {
          if (runtime.wakeBusy) return
          runtime.wakeBusy = true
          try {
            runtime.wakeSegs += 1
            const samples = controller.wakeSegmentWave(segment)
            runtime.wakeSegSamples = samples ? samples.length : 0
            if (!samples || samples.length < 1600) return
            // Тихий огрызок (шум, щелчок) в распознавание не отправляем:
            // иначе шум рвёт фразу на куски и имя теряется.
            let loudest = 0
            for (let i = 0; i < samples.length; i += 16) loudest = Math.max(loudest, Math.abs(samples[i]))
            if (loudest < 900) return
            const text = await controller.transcribeWake(encodePcm16Wave(samples))
            runtime.wakeSegText = text.slice(0, 40)
            const match = matchWakePhrase(text, store.get().preferences.wakeWords)
            controller.collectSample(samples, match.hit)
            if (!match.hit) return
            const rest = stripWakeFillers(match.rest)
            if (isStopPhrase(rest)) {
              controller.notice(store.get().strings.stopped)
              return
            }
              controller.notice(store.get().strings.wakeHeard)
            const target = controller.lastEnv
            if (!target) return
            if (rest !== '') {
              if (store.get().phase !== 'idle' || runtime.pending) return
              controller.submit(target, rest, runtime.generation)
              return
            }
            runtime.wakeFollowUp = true
            runtime.wakeFollowAttempts = 0
            await controller.stopWake()
            await controller.startRecording(target)
          } finally {
            runtime.wakeBusy = false
          }
        },
        async finishWake(capture, env, segment) {
          clearInterval(runtime.wakeVadTimer)
          if (runtime.wakeCapture !== capture) return
          runtime.wakeCapture = undefined
          store.set({ wakeListening: false, level: 0 })
          runtime.wakeBusy = true
          runtime.wakeNextAt = Date.now() + 1500
          try {
            const result = await capture.stop().catch(() => undefined)
            if (!result || result.seconds < 0.25) return
            const wave = segment ? trimWave(result.wave, segment.startMs, segment.endMs) : result.wave
            const text = await controller.transcribeWake(wave)
            const match = matchWakePhrase(text, store.get().preferences.wakeWords)
            if (!match.hit) return
            const rest = stripWakeFillers(match.rest)
            if (isStopPhrase(rest)) {
              controller.notice(store.get().strings.stopped)
              return
            }
            // Поток уже мог подать сигнал, как только услышал имя.
              controller.notice(store.get().strings.wakeHeard)
            const target = controller.lastEnv ?? env
            if (!target) return
            if (rest !== '') {
              if (store.get().phase !== 'idle' || runtime.pending) return
              controller.submit(target, rest, runtime.generation)
              return
            }
            runtime.wakeFollowUp = true
            runtime.wakeFollowAttempts = 0
            await controller.startRecording(target)
          } finally {
            runtime.wakeBusy = false
            runtime.wakeNextAt = Date.now() + 60
          }
        },
        /** Локальное распознавание короткого фрагмента для активации. */
        async transcribeWake(wave) {
          try {
            const response = await fetch(`${BASE}/transcribe`, {
              method: 'POST',
              headers: { 'content-type': 'audio/wav', 'x-voice-language': store.get().preferences.language },
              body: wave,
              signal: AbortSignal.timeout(20000),
            })
            if (!response.ok) return ''
            const payload = await response.json().catch(() => ({}))
            return String(payload.text ?? '')
          } catch { return '' }
        },
        /** Слушать имя, пока модель думает: можно обратиться, не дожидаясь ответа. */
        async startThinkListen() {
          if (runtime.thinkCapture || runtime.thinkBusy) return
          if (store.get().preferences.wakeEnabled !== true) return
          if (store.get().phase !== 'thinking') return
          const env = controller.lastEnv
          if (!env) return
          if (runtime.wakeCapture) await controller.stopWake()
          const capture = new Capture()
          runtime.thinkCapture = capture
          try {
            await capture.start()
          } catch {
            if (runtime.thinkCapture === capture) runtime.thinkCapture = undefined
            await capture.dispose()
            return
          }
          if (runtime.thinkCapture !== capture) { await capture.dispose(); return }
          const listenStartedAt = Date.now()
          const threshold = (THRESHOLDS[store.get().preferences.sensitivity] ?? THRESHOLDS.normal) * 1.2
          let heard = false
          let speechStarted = 0
          let lastVoice = Date.now()
          clearInterval(runtime.thinkTimer)
          runtime.thinkTimer = setInterval(() => {
            if (runtime.thinkCapture !== capture) { clearInterval(runtime.thinkTimer); return }
            if (store.get().phase !== 'thinking') { void controller.stopThinkListen(); return }
            const now = Date.now()
            if (now < selfSoundUntil) { heard = false; lastVoice = now; return }
            capture.resume()
            const level = capture.amplitude()
            if (level >= threshold) {
              if (!heard) speechStarted = now
              heard = true
              lastVoice = now
            }
            if (heard && now - lastVoice >= 500 && now - speechStarted >= 250) {
              void controller.finishThink(capture, {
                startMs: Math.max(0, speechStarted - 400 - listenStartedAt),
                endMs: Math.max(0, lastVoice + 700 - listenStartedAt),
              })
              return
            }
            if (heard && now - speechStarted > 9000) {
              void controller.finishThink(capture, {
                startMs: Math.max(0, speechStarted - 400 - listenStartedAt),
                endMs: Math.max(0, lastVoice + 700 - listenStartedAt),
              })
            }
          }, 80)
        },
        async stopThinkListen() {
          clearInterval(runtime.thinkTimer)
          runtime.thinkTimer = undefined
          const capture = runtime.thinkCapture
          runtime.thinkCapture = undefined
          if (capture) await capture.dispose()
        },
        async finishThink(capture, segment) {
          clearInterval(runtime.thinkTimer)
          if (runtime.thinkCapture !== capture) return
          runtime.thinkCapture = undefined
          runtime.thinkBusy = true
          try {
            const result = await capture.stop().catch(() => undefined)
            if (!result || result.seconds < 0.25) return
            const wave = segment ? trimWave(result.wave, segment.startMs, segment.endMs) : result.wave
            const text = await controller.transcribeWake(wave)
            const match = matchWakePhrase(text, store.get().preferences.wakeWords)
            if (!match.hit) return
            const rest = stripWakeFillers(match.rest)
            if (isStopPhrase(rest)) {
              controller.notice(store.get().strings.stopped)
              return
            }
            controller.notice(store.get().strings.wakeHeard)
            const env = controller.lastEnv
            if (rest === '' || !env) return
            if (store.get().preferences.assistantSession === true) {
              controller.notice(store.get().strings.queuedAsk)
              void controller.askAssistant(env, rest, runtime.generation)
              return
            }
            // Модель ещё думает: отправляем как обычное сообщение — оно встанет
            // в очередь и будет обработано сразу после текущего ответа.
            env.inputActions.setDraft(rest)
            env.inputActions.submit()
            controller.notice(store.get().strings.queuedAsk)
          } catch { /* сообщение не потеряно — осталось в черновике */ } finally {
            runtime.thinkBusy = false
            if (store.get().phase === 'thinking') setTimeout(() => { void controller.startThinkListen() }, 500)
          }
        },
        /** Пауза и продолжение звучащего ответа. */
        pauseSpeaking() {
          const context = runtime.audioContext
          if (!context || context.state !== 'running') return
          if (runtime.audio) runtime.audio.paused = true
          context.suspend().catch(() => undefined)
        },
        resumeSpeaking() {
          const context = runtime.audioContext
          if (context) {
            if (runtime.audio) runtime.audio.paused = false
            context.resume().catch(() => undefined)
            return
          }
          const audio = runtime.audio
          if (!audio || !audio.paused) return
          audio.play().catch(() => undefined)
          // Если браузер не дал продолжить (или элемент завис), не оставляем
          // фазу «говорю» навсегда: завершаем воспроизведение, чтобы вернуться в idle.
          setTimeout(() => {
            if (runtime.audio !== audio) return
            if (!audio.paused) return
            runtime.audioCancel?.(new DOMException('canceled', 'AbortError'))
          }, 1500)
        },
        /** Слушать микрофон во время чтения ответа ради кодового слова. */
        async startBarge() {
          if (runtime.bargeCapture || runtime.bargeBusy) return
          if (store.get().preferences.bargeIn === false) return
          if (store.get().phase !== 'speaking' || !runtime.audio) return
          // Микрофон активации закрываем: иначе два потока слушают одновременно.
          if (runtime.wakeCapture) await controller.stopWake()
          const capture = new Capture()
          runtime.bargeCapture = capture
          try {
            await capture.start()
          } catch {
            if (runtime.bargeCapture === capture) runtime.bargeCapture = undefined
            await capture.dispose()
            return
          }
          if (runtime.bargeCapture !== capture) { await capture.dispose(); return }
          const threshold = (THRESHOLDS[store.get().preferences.sensitivity] ?? THRESHOLDS.normal) * 1.4
          const startedAt = Date.now()
          let heard = false
          let speechStarted = 0
          let lastVoice = Date.now()
          let paused = false
          let loudTicks = 0
          clearInterval(runtime.bargeTimer)
          runtime.bargeTimer = setInterval(() => {
            if (runtime.bargeCapture !== capture || store.get().phase !== 'speaking') {
              clearInterval(runtime.bargeTimer)
              return
            }
            const now = Date.now()
            if (now < selfSoundUntil) return
            // Первые 700 мс не слушаем: даём эху и началу фразы устояться.
            if (!paused && now - startedAt < 700) return
            capture.resume()
            const level = capture.amplitude()
            if (level >= threshold) {
              loudTicks += 1
              if (!heard) speechStarted = now
              heard = true
              lastVoice = now
              // Пауза только после ~240 мс речи и не больше двух раз за чтение:
              // иначе собственное эхо из колонок бесконечно ставит ответ на паузу.
              if (!paused && loudTicks >= 3 && runtime.bargeTriggers < 2) {
                paused = true
                runtime.bargeTriggers += 1
                controller.pauseSpeaking()
              }
            } else {
              loudTicks = 0
            }
            if (heard && now - lastVoice >= 700 && now - speechStarted >= 300) {
              void controller.finishBarge(capture, {
                startMs: Math.max(0, speechStarted - 400 - startedAt),
                endMs: Math.max(0, lastVoice + 700 - startedAt),
              })
              return
            }
            if (heard && now - speechStarted > 9000) {
              void controller.finishBarge(capture, {
                startMs: Math.max(0, speechStarted - 400 - startedAt),
                endMs: Math.max(0, lastVoice + 700 - startedAt),
              })
            }
          }, 80)
        },
        async stopBarge() {
          clearInterval(runtime.bargeTimer)
          runtime.bargeTimer = undefined
          const capture = runtime.bargeCapture
          runtime.bargeCapture = undefined
          if (capture) await capture.dispose()
        },
        /** Разобрать фразу, сказанную поверх ответа. */
        async finishBarge(capture, segment) {
          clearInterval(runtime.bargeTimer)
          if (runtime.bargeCapture !== capture) return
          runtime.bargeCapture = undefined
          runtime.bargeBusy = true
          try {
            const result = await capture.stop().catch(() => undefined)
            if (!result || result.seconds < 0.25) { controller.resumeSpeaking(); return }
            const wave = segment ? trimWave(result.wave, segment.startMs, segment.endMs) : result.wave
            const text = await controller.transcribeWake(wave)
            const match = matchWakePhrase(text, store.get().preferences.wakeWords)
            if (!match.hit) {
              controller.resumeSpeaking()
              return
            }
            const rest = stripWakeFillers(match.rest)
            // «Валера, стоп» — гасим озвучку и ничего не записываем.
            if (isStopPhrase(rest)) {
              controller.stopSpeaking()
              controller.notice(store.get().strings.stopped)
              return
            }
            controller.notice(store.get().strings.wakeHeard)
            controller.stopSpeaking()
            const target = controller.lastEnv
            if (rest !== '') {
              controller.submit(target, rest, runtime.generation)
              return
            }
            runtime.wakeFollowUp = true
            runtime.wakeFollowAttempts = 0
            await controller.startRecording(target)
          } finally {
            runtime.bargeBusy = false
            if (store.get().phase === 'speaking' && runtime.audio && runtime.bargeTriggers < 2) {
              setTimeout(() => { void controller.startBarge() }, 400)
            }
          }
        },
        async startRecording(env) {
          if (!env || !env.sessionId) return
          if (env.pendingInteraction) { controller.notice(store.get().strings.pendingQuestion); return }
          if (env.running) { controller.notice(store.get().strings.busy); return }
          if (env.inputPhase && env.inputPhase !== 'plain') { controller.notice(store.get().strings.busy); return }
          if (runtime.capture && runtime.captureSession === env.sessionId) return
          if (runtime.starting) return
          if (runtime.capture) await controller.cancelListening()
          if (runtime.wakeCapture) await controller.stopWake()
          const generation = ++runtime.generation
          runtime.captureSession = env.sessionId
          runtime.envs.set(env.sessionId, env)
          controller.lastEnv = env
          store.set({ phase: 'starting', level: 0, transcript: '', error: '', notice: '', activeSession: env.sessionId })
          const capture = new Capture()
          runtime.capture = capture
          runtime.starting = true
          let startError
          // Микрофон только что отпустило прослушивание имени — второй попытки
          // через мгновение обычно хватает.
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              await capture.start()
              startError = undefined
              break
            } catch (error) {
              startError = error
              const busy = error instanceof CaptureError && error.message === 'busy'
              if (!busy || attempt === 1) break
              await delay(300)
            }
          }
          if (startError) {
            runtime.starting = false
            if (runtime.capture === capture) runtime.capture = undefined
            await capture.dispose()
            if (generation !== runtime.generation) return
            if (startError instanceof CaptureError && startError.message === 'cancelled') return
            const strings = store.get().strings
            const message = startError instanceof CaptureError && startError.message === 'permission' ? strings.micDenied
              : startError instanceof CaptureError && startError.message === 'missing' ? strings.micMissing
                : startError instanceof CaptureError && startError.message === 'busy' ? strings.micBusy
                  : strings.network
            store.set({ enabled: false })
            controller.fail(message)
            return
          }
          runtime.starting = false
          if (generation !== runtime.generation || runtime.capture !== capture) {
            await capture.dispose()
            return
          }
          store.set({ phase: 'listening' })
          void controller.warm(env)
          controller.trackLevel(capture, env.sessionId, generation)
        },
        async warm(env) {
          const preferences = store.get().preferences
          try {
            await fetch(`${BASE}/warm`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                language: preferences.language,
                // Load the speech model while the user is still talking.
                tts: preferences.output === 'voice' && preferences.tts === 'silero',
              }),
              signal: AbortSignal.timeout(3000),
            })
          } catch { /* best effort */ }
        },
        trackLevel(capture, sessionId, generation) {
          const threshold = THRESHOLDS[store.get().preferences.sensitivity] ?? THRESHOLDS.normal
          // «Целиком»: ждём длинную паузу, чтобы не рвать мысль на части, и
          // распознаём всю запись одним куском — одно сообщение вместо пяти.
          const whole = store.get().preferences.dictation !== 'split'
          const baseSilenceMs = SILENCE_MS[store.get().preferences.sensitivity] ?? SILENCE_MS.normal
          const maxUtteranceMs = whole ? WHOLE_MAX_MS : MAX_UTTERANCE_MS
          const maxHoldMs = whole ? WHOLE_MAX_MS : MAX_HOLD_MS
          let heardSpeech = false
          let speechStarted = 0
          let lastVoice = Date.now()
          const startedAt = Date.now()
          let lastPublish = 0
          clearInterval(runtime.vadTimer)
          // Пока идёт запись, тот же потоковый VAD решает, где конец фразы:
          // порог по громкости больше не нужен.
          runtime.recHost = undefined
          capture.detachWake = controller.startWakeStreaming(capture, 'rec', (update) => {
            runtime.recHost = update
            // Конец диктовки можно сказать словами, не дожидаясь долгой паузы.
            if (!whole || !heardSpeech) return
            const tail = String(update.text || '').slice(-80).toLowerCase()
            if (!DICTATION_END.some((word) => tail.includes(word))) return
            void controller.finish(sessionId, generation, {
              startMs: Math.max(0, speechStarted - 400 - startedAt),
              endMs: Math.max(0, lastVoice + 300 - startedAt),
            })
          })
          runtime.vadTimer = setInterval(() => {
            if (runtime.capture !== capture || runtime.generation !== generation) {
              clearInterval(runtime.vadTimer)
              return
            }
            const now = Date.now()
            const level = capture.amplitude()
            if (now - lastPublish > 90) {
              lastPublish = now
              store.set({ level: Math.min(1, level * 6) })
            }
            const host = runtime.recHost
            const hostFresh = host && now - host.at < 900
            const continueThreshold = threshold * 0.6
            if ((hostFresh && host.speech) || level >= continueThreshold) {
              if (!heardSpeech) speechStarted = now
              heardSpeech = true
              lastVoice = now
            }
            // Пауза засчитывается только если И хост, И локальный уровень
            // согласны, что речь кончилась: иначе тихий микрофон обрывал
            // фразу на середине, когда серверный VAD объявлял тишину.
            const localSilence = now - lastVoice
            const silenceFor = hostFresh && heardSpeech ? Math.min(host.silenceMs, localSilence) : localSilence
            const preference = store.get().preferences
            if (runtime.followUpListen) {
              const followUpMs = Number(preference.followUp ?? 0)
              if (!heardSpeech && followUpMs > 0 && now - startedAt > followUpMs) {
                // Тишина после ответа: закрываем микрофон и возвращаемся к кодовому слову.
                runtime.followUpListen = false
                void controller.cancelListening()
                return
              }
            } else if (preference.mode === 'hold') {
              if (now - startedAt > maxHoldMs) {
                void controller.cancelListening()
                controller.notice(store.get().strings.tooLong)
              }
              return
            }
            if (!preference.autoStop) return
            if (!heardSpeech && preference.mode === 'click' && now - startedAt > MAX_SILENT_WAIT_MS) {
              void controller.cancelListening()
              controller.notice(store.get().strings.noSpeech)
              return
            }
            // Короткая команда ждёт паузу меньше, длинная диктовка — больше:
            // иначе «который час» висит шесть секунд, а глава не рвётся на паузах.
            const spokenMs = heardSpeech ? lastVoice - speechStarted : 0
            const pauseToStop = whole
              ? (spokenMs > 10000 ? 5000 : spokenMs > 3000 ? 3500 : 1300)
              : Math.min(baseSilenceMs, 900)
            // В распознавание отправляем только участок речи, без тишины до и после.
            const segmentOf = () => ({
              startMs: Math.max(0, speechStarted - 400 - startedAt),
              endMs: Math.max(0, lastVoice + 700 - startedAt),
            })
            if (heardSpeech && silenceFor >= pauseToStop && now - speechStarted >= 400) {
              void controller.finish(sessionId, generation, segmentOf())
              return
            }
            if (heardSpeech && now - speechStarted > maxUtteranceMs) {
              void controller.finish(sessionId, generation, segmentOf())
              return
            }
            if (!heardSpeech && preference.mode === 'click' && now - startedAt > maxUtteranceMs) {
              void controller.cancelListening()
              controller.notice(store.get().strings.noSpeech)
            }
          }, 90)
        },
        async finish(sessionId, generation, segment) {
          if (generation !== runtime.generation) return
          const capture = runtime.capture
          if (!capture || runtime.captureSession !== sessionId) return
          runtime.capture = undefined
          runtime.captureSession = ''
          clearInterval(runtime.vadTimer)
          store.set({ phase: 'transcribing', level: 0 })
          let result
          try {
            result = await capture.stop()
          } catch {
            if (generation === runtime.generation) {
              controller.notice(store.get().strings.noSpeech)
              await controller.afterFailure(sessionId)
            }
            return
          }
          if (generation !== runtime.generation) return
          if (!result || result.seconds < 0.3) {
            controller.notice(store.get().strings.noSpeech)
            await controller.afterFailure(sessionId)
            return
          }
          try {
            const abort = new AbortController()
            runtime.transcribeAbort = abort
            let wave = segment ? trimWave(result.wave, segment.startMs, segment.endMs) : result.wave
            // Дописываем звук, сказанный после имени до переключения на запись:
            // иначе первое слово команды теряется.
            if (runtime.prefixPcm && runtime.prefixPcm.length > 0) {
              wave = prependPcm(wave, runtime.prefixPcm)
              runtime.prefixUsed = true
              runtime.prefixPcm = undefined
            }
            const response = await fetch(`${BASE}/transcribe`, {
              method: 'POST',
              headers: { 'content-type': 'audio/wav', 'x-voice-language': store.get().preferences.language },
              body: wave,
              signal: abort.signal,
            })
            runtime.transcribeAbort = undefined
            if (generation !== runtime.generation) return
            const payload = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(payload.error || String(response.status))
            let text = String(payload.text ?? '').trim()
            // Распознаватели помечают шум как «(звук …)», «(музыка)», «(шум)».
            // Такую пометку не отправляем в чат: это не команда.
            const withoutNoise = text.replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').trim()
            // Слово-терминатор диктовки («закончил») в текст сообщения не пишем.
            if (store.get().preferences.dictation !== 'split') {
              for (const word of DICTATION_END) {
                const cut = text.replace(new RegExp(`[,\\s]*${word}[,.!?\\s]*$`, 'i'), '').trim()
                if (cut !== '') text = cut
              }
            }
            // Сказали имя с командой — это тоже положительный образец для KWS.
            if (store.get().preferences.collectSamples === true) {
              const lead = matchWakePhrase(text, store.get().preferences.wakeWords, { anywhere: false })
              if (lead.hit) controller.collectSample(wave, true)
            }
            // Из записи с префиксом вырезаем всё до имени включительно:
            // перед ним могли звучать слова, не относящиеся к команде.
            if (runtime.prefixUsed) {
              runtime.prefixUsed = false
              const words = text.split(/\s+/).filter(Boolean)
              for (let index = 0; index < Math.min(words.length, 5); index += 1) {
                const head = words.slice(0, index + 1).join(' ')
                if (!matchWakePhrase(head, store.get().preferences.wakeWords).hit) continue
                const rest = stripWakeFillers(words.slice(index + 1).join(' '))
                if (rest !== '') { text = rest; break }
              }
              const lead = matchWakePhrase(text, store.get().preferences.wakeWords, { anywhere: false })
              if (lead.hit) {
                const rest = stripWakeFillers(lead.rest)
                if (rest !== '') text = rest
              }
            }
            if (withoutNoise === '') {
              controller.notice(store.get().strings.noSpeech)
              await controller.afterFailure(sessionId)
              return
            }
            if (text === '') {
              controller.notice(store.get().strings.noSpeech)
              await controller.afterFailure(sessionId)
              return
            }
            if (runtime.followUpListen) {
              const wake = matchWakePhrase(text, store.get().preferences.wakeWords, { anywhere: false })
              if (wake.hit) {
                text = stripWakeFillers(wake.rest)
                if (text === '') {
                  // Во время доклада сказали только имя — это повторная активация.
                  controller.notice(store.get().strings.wakeHeard)
                  runtime.followUpListen = true
                  const again = runtime.envs.get(sessionId) ?? controller.lastEnv
                  if (again) { await controller.startRecording(again); return }
                }
              }
              runtime.followUpListen = false
            }
            store.set({ transcript: text })
            const env = runtime.envs.get(sessionId)
            controller.submit(env ?? controller.lastEnv, text, generation)
          } catch (error) {
            if (generation !== runtime.generation || looksCanceled(error)) return
            controller.fail(`${store.get().strings.engineError}: ${error instanceof Error ? error.message : String(error)}`)
            await controller.afterFailure(sessionId)
          }
        },
        insertTranscript(env, text) {
          const draft = String(env.draft ?? '')
          try {
            const span = env.inputActions.captureInsertion()
            const joiner = draft === '' || /[\s\n]$/.test(draft) ? '' : ' '
            if (env.inputActions.insertText(joiner + text, span)) return true
          } catch { /* fall back to replacing the document */ }
          try {
            env.inputActions.setDraft(draft.trim() === '' ? text : `${draft.trimEnd()} ${text}`)
            return true
          } catch { return false }
        },
        /**
         * Голосовой вопрос в собственную сессию «Ассистент» через хост-агента.
         * Возвращает true, если запрос принят; false — тогда работает старый путь
         * через композер текущего чата.
         */
        async askAssistant(env, text, generation) {
          const strings = store.get().strings
          const after = runtime.assistantSeq ?? 0
          store.set({ phase: 'thinking', transcript: text })
          try {
            const response = await fetch(`${BASE}/converse`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text }),
              signal: AbortSignal.timeout(20000),
            })
            if (!response.ok) {
              store.set({ phase: 'idle' })
              return false
            }
            const value = await response.json()
            const sessionId = String(value.sessionId ?? '')
            if (sessionId === '') {
              store.set({ phase: 'idle' })
              return false
            }
            runtime.assistantSessionId = sessionId
            let reply = null
            for (let attempt = 0; attempt < 600 && !reply; attempt += 1) {
              if (generation !== runtime.generation) return true
              reply = await controller.fetchReply(sessionId, after)
              if (!reply) await delay(300)
            }
            if (!reply) {
              store.set({ phase: 'idle' })
              controller.notice(strings.submitError)
              return true
            }
            runtime.assistantSeq = reply.seq
            const preferences = store.get().preferences
            if (preferences.output === 'voice') {
              store.set({ phase: 'speaking' })
              try {
                await controller.speak(reply.text, generation)
              } catch { /* ответ остался в тексте */ }
            }
            if (generation !== runtime.generation) return true
            store.set({ phase: 'idle' })
            runtime.voiceTurn = true
            const followUpMs = Number(preferences.followUp ?? 0)
            if (followUpMs > 0 && !store.get().enabled) {
              await delay(350)
              if (generation === runtime.generation && store.get().phase === 'idle' && !runtime.pending) {
                runtime.followUpListen = true
                playReadyChime()
                await delay(600)
                await controller.startRecording(controller.lastEnv)
              }
            }
            return true
          } catch {
            store.set({ phase: 'idle' })
            return false
          }
        },
        async submit(env, text, generation) {
          if (generation !== runtime.generation) return
          // Отдельная сессия «Ассистент»: голос не пишется в текущий чат.
          if (store.get().preferences.assistantSession === true) {
            const handled = await controller.askAssistant(env, text, generation)
            if (handled) return
          }
          if (!env || !env.inputActions || !env.sessionId) {
            controller.fail(store.get().strings.submitError)
            return
          }
          const strings = store.get().strings
          if (env.running || (env.inputPhase && env.inputPhase !== 'plain')) {
            controller.insertTranscript(env, text)
            store.set({ phase: 'idle' })
            controller.notice(strings.busy)
            return
          }
          const draft = String(env.draft ?? '').trim()
          if (draft !== '') {
            controller.insertTranscript(env, text)
            store.set({ phase: 'idle', enabled: false })
            controller.notice(strings.addedToDraft)
            return
          }
          try {
            env.inputActions.setDraft(text)
            env.inputActions.submit()
          } catch {
            controller.fail(strings.submitError)
            return
          }
          runtime.emptyAttempts = 0
          runtime.wakeFollowUp = false
          runtime.wakeFollowAttempts = 0
          runtime.followUpListen = false
          runtime.voiceTurn = true
          runtime.pending = { sessionId: env.sessionId, after: runtime.lastSpoken.get(env.sessionId) ?? 0, startedAt: Date.now(), sawRunning: false }
          void controller.startThinkListen()
          store.set({ phase: 'thinking' })
          clearTimeout(runtime.turnTimer)
          clearTimeout(runtime.watchdogTimer)
          runtime.turnTimer = setTimeout(() => {
            if (!runtime.pending) return
            runtime.pending = undefined
            controller.fail(store.get().strings.submitError)
            void controller.afterFailure(env.sessionId)
          }, TURN_TIMEOUT_MS)
          runtime.watchdogTimer = setTimeout(() => {
            const pending = runtime.pending
            if (!pending || pending.sawRunning) return
            runtime.pending = undefined
            clearTimeout(runtime.turnTimer)
            controller.fail(store.get().strings.submitError)
            void controller.afterFailure(pending.sessionId)
          }, TURN_WATCHDOG_MS)
        },
        async fetchReply(sessionId, after) {
          try {
            const response = await fetch(`${BASE}/reply?session=${encodeURIComponent(sessionId)}&after=${after}`, { signal: AbortSignal.timeout(8000) })
            if (response.status === 204) return null
            if (!response.ok) return null
            const value = await response.json()
            return typeof value.text === 'string' ? value : null
          } catch { return null }
        },
        async finishTurn(env) {
          const pending = runtime.pending
          if (!pending) return
          void controller.stopThinkListen()
          const generation = runtime.generation
          pending.sawRunning = true
          runtime.pending = undefined
          clearTimeout(runtime.turnTimer)
          clearTimeout(runtime.watchdogTimer)
          let reply = null
          for (let attempt = 0; attempt < 3 && !reply; attempt++) {
            if (generation !== runtime.generation) return
            reply = await controller.fetchReply(pending.sessionId, pending.after)
            if (!reply) await delay(400 + attempt * 400)
          }
          if (generation !== runtime.generation) return
          if (reply) runtime.lastSpoken.set(pending.sessionId, reply.seq)
          const stale = reply && typeof reply.time === 'number' && reply.time < pending.startedAt - 3000
          const preferences = store.get().preferences
          if (reply && !stale && preferences.output === 'voice') {
            store.set({ phase: 'speaking' })
            try {
              await controller.speak(reply.text, generation)
            } catch (error) {
              if (!looksCanceled(error) && error instanceof Error) controller.notice(error.message)
            }
          }
          if (generation !== runtime.generation) return
          if (env && env.pendingInteraction) {
            store.set({ phase: 'idle', enabled: false })
            controller.notice(store.get().strings.pendingQuestion)
            return
          }
          if (store.get().enabled && store.get().preferences.mode === 'continuous' && store.get().activeSession === pending.sessionId) {
            await delay(250)
            const latest = runtime.envs.get(pending.sessionId)
            if (generation === runtime.generation && store.get().enabled && latest && !latest.running) {
              void controller.startRecording(latest)
              return
            }
          }
          // Если чтение прервали голосом, запись уже стартовала — не сбрасываем её фазу.
          // Любую другую фазу возвращаем в idle, иначе активация по имени замрёт.
          const settled = store.get().phase
          if (settled !== 'starting' && settled !== 'listening' && settled !== 'transcribing') store.set({ phase: 'idle' })
          runtime.wakeNextAt = Date.now() + 300
          // Как Алиса: после ответа ещё несколько секунд слушаем без имени.
          const followUpMs = Number(store.get().preferences.followUp ?? 0)
          if (runtime.voiceTurn && followUpMs > 0 && !store.get().enabled) {
            runtime.voiceTurn = false
            await delay(350)
            const env = controller.lastEnv
            if (env && store.get().phase === 'idle' && !runtime.pending && !store.get().enabled) {
              runtime.followUpListen = true
              playReadyChime()
              // Ждём, пока сигнал дозвучит: иначе микрофон запишет его как речь.
              await delay(600)
              await controller.startRecording(env)
              return
            }
          }
          runtime.voiceTurn = false
        },
        /**
         * Озвучить ответ на ход, который начал не этот плагин
         * (голосовая активация, другой инструмент или ручной ввод).
         * Берём последний ответ новее уже прочитанного, чтобы не повторяться.
         */
        async speakForeign(sessionId) {
          const generation = runtime.generation
          await controller.stopWake()
          const last = runtime.lastSpoken.get(sessionId) ?? 0
          let reply = null
          for (let attempt = 0; attempt < 3 && !reply; attempt++) {
            if (generation !== runtime.generation) return
            reply = await controller.fetchReply(sessionId, last)
            if (!reply) await delay(350 + attempt * 350)
          }
          if (!reply || generation !== runtime.generation) return
          runtime.lastSpoken.set(sessionId, reply.seq)
          store.set({ phase: 'speaking' })
          try {
            await controller.speak(reply.text, generation)
          } catch (error) {
            if (!looksCanceled(error) && error instanceof Error) controller.notice(error.message)
          } finally {
            if (generation === runtime.generation && store.get().phase === 'speaking') store.set({ phase: 'idle' })
            runtime.wakeNextAt = Date.now() + 300
          }
        },
        /** Один AudioContext на все ответы: фразы стыкуются встык, без пауз. */
        ensurePlayback() {
          const Ctor = window.AudioContext ?? window.webkitAudioContext
          if (!runtime.audioContext || runtime.audioContext.state === 'closed') {
            runtime.audioContext = new Ctor()
            runtime.playNodes = []
            runtime.playCursor = 0
          }
          return runtime.audioContext
        },
        stopPlaybackNodes() {
          const nodes = runtime.playNodes ?? []
          runtime.playNodes = []
          for (const node of nodes) {
            try { node.stop() } catch { /* уже остановлен */ }
          }
          runtime.playCursor = 0
        },
        async speak(text, generation) {
          runtime.speechCanceled = false
          const preferences = store.get().preferences
          const cleaned = cleanForSpeech(text)
          if (cleaned === '') return
          // Один и тот же ответ не озвучиваем дважды: событие конца хода и
          // «чужой» ход могут прийти почти одновременно.
          const fingerprint = `${cleaned.length}:${cleaned.slice(0, 120)}`
          if (runtime.lastSpokenText === fingerprint && Date.now() - runtime.lastSpokenAt < 4000) return
          runtime.lastSpokenText = fingerprint
          runtime.lastSpokenAt = Date.now()
          const blocks = splitSpeechBlocks(cleaned)
          if (blocks.length === 0) return
          // Видно в статусе: сколько фраз ответа реально прочитано.
          store.set({ speakIndex: 0, speakTotal: blocks.length, speakSkipped: 0 })
          const abort = new AbortController()
          runtime.ttsAbort = abort
          const request = (block) => controller.requestTts(block, preferences, abort)
          const context = controller.ensurePlayback()
          if (context.state === 'suspended') {
            try { await context.resume() } catch { /* ждём жеста пользователя */ }
          }
          // Автовоспроизведение запрещено до жеста: тогда читаем по-старому,
          // отдельными элементами — звук всё равно будет.
          if (context.state !== 'running') {
            let pending = request(blocks[0])
            for (let index = 0; index < blocks.length; index += 1) {
              let blob = null
              try {
                blob = await pending
              } catch {
                try { blob = await request(blocks[index]) } catch { blob = null }
              }
              if (generation !== runtime.generation) return
              pending = index + 1 < blocks.length ? request(blocks[index + 1]) : undefined
              if (blob) await controller.playBlob(blob, generation, Boolean(pending))
              store.set({ speakIndex: index + 1 })
              if (!pending) break
            }
            return
          }
          controller.stopPlaybackNodes()
          const marker = { paused: false }
          runtime.audio = marker
          runtime.audioCancel = () => { runtime.speechCanceled = true; controller.stopPlaybackNodes() }
          try {
            // Планируем буферы подряд: следующий начинается ровно там, где
            // закончился предыдущий, поэтому между фразами нет провалов.
            // Предзагрузка строго по индексам: очередь «сдвигом» дублировала
            // блоки — часть фраз играла дважды, часть терялась.
            let cursor = context.currentTime + 0.08
            runtime.playCursor = cursor
            const cache = new Map()
            const prefetch = (position) => {
              if (position >= blocks.length || cache.has(position)) return
              cache.set(position, request(blocks[position]))
            }
            prefetch(0)
            prefetch(1)
            prefetch(2)
            const skipped = []
            for (let index = 0; index < blocks.length; index += 1) {
              if (runtime.speechCanceled || generation !== runtime.generation) return
              let blob
              try {
                blob = await cache.get(index)
              } catch {
                // Повторяем один раз: сетевой сбой не должен съедать конец ответа.
                try { blob = await request(blocks[index]) } catch { blob = null }
              }
              cache.delete(index)
              prefetch(index + 3)
              if (runtime.speechCanceled || generation !== runtime.generation) return
              if (!blob) { skipped.push(index); continue }
              let buffer
              try {
                buffer = await context.decodeAudioData(await blob.arrayBuffer())
              } catch {
                // Один битый блок не должен глушить весь ответ.
                skipped.push(index)
                continue
              }
              if (runtime.speechCanceled || generation !== runtime.generation) return
              const startAt = Math.max(cursor, context.currentTime + 0.02)
              const source = context.createBufferSource()
              source.buffer = buffer
              source.connect(context.destination)
              source.start(startAt)
              cursor = startAt + buffer.duration
              runtime.playCursor = cursor
              runtime.playNodes.push(source)
              store.set({ speakIndex: index + 1 })
            }
            // Пропущенные фразы пробуем ещё раз и ставим в хвост: лучше
            // прочитать их с запозданием, чем потерять конец ответа.
            for (const index of skipped) {
              if (runtime.speechCanceled || generation !== runtime.generation) return
              let buffer
              try {
                const retry = await request(blocks[index])
                buffer = await context.decodeAudioData(await retry.arrayBuffer())
              } catch {
                store.set({ speakSkipped: (store.get().speakSkipped ?? 0) + 1 })
                continue
              }
              const startAt = Math.max(cursor, context.currentTime + 0.02)
              const source = context.createBufferSource()
              source.buffer = buffer
              source.connect(context.destination)
              source.start(startAt)
              cursor = startAt + buffer.duration
              runtime.playCursor = cursor
              runtime.playNodes.push(source)
            }
            // Ждём, пока доиграет последний буфер. На паузе currentTime стоит —
            // это штатно, поэтому сторож срабатывает только на 20 секунд.
            let lastTime = -1
            let stillSince = 0
            while (!runtime.speechCanceled && generation === runtime.generation) {
              const now = context.currentTime
              if (now >= runtime.playCursor - 0.03) break
              if (now === lastTime) {
                if (stillSince === 0) stillSince = Date.now()
                if (Date.now() - stillSince > 20000) break
              } else {
                stillSince = 0
                lastTime = now
              }
              await delay(80)
            }
            if (!runtime.speechCanceled && generation !== runtime.generation) return
          } finally {
            if (runtime.ttsAbort === abort) runtime.ttsAbort = undefined
            if (runtime.audio === marker) runtime.audio = undefined
            runtime.audioCancel = undefined
            controller.stopPlaybackNodes()
            if (!runtime.speechCanceled) void controller.stopBarge()
          }
        },
        requestTts(text, preferences, abort) {
          return fetch(`${BASE}/tts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              text,
              voice: preferences.voice,
              provider: 'silero',
              speed: preferences.speed,
              pauses: preferences.pauses,
            }),
            signal: abort.signal,
          }).then((response) => {
            if (!response.ok) throw new Error('silero tts failed')
            return response.blob()
          })
        },
        playBlob(blob, generation, more = false) {
          return new Promise((resolve, reject) => {
            if (generation !== runtime.generation) { resolve(); return }
            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            let pausedSince = 0
            const guard = setInterval(() => {
              if (runtime.audio !== audio || audio.ended) { clearInterval(guard); return }
              if (!audio.paused) { pausedSince = 0; return }
              // Пауза из-за голосового прерывания — штатная, её не трогаем.
              if (runtime.bargeCapture) { pausedSince = 0; return }
              if (pausedSince === 0) pausedSince = Date.now()
              if (Date.now() - pausedSince > 15000) {
                // Воспроизведение зависло: завершаем, чтобы фаза не залипла.
                clearInterval(guard)
                runtime.audioCancel?.(new DOMException('canceled', 'AbortError'))
                return
              }
              audio.play().catch(() => undefined)
            }, 2000)
            const cleanup = () => {
              clearInterval(guard)
              if (runtime.audio === audio) runtime.audio = undefined
              runtime.audioCancel = undefined
              URL.revokeObjectURL(url)
              if (!more) void controller.stopBarge()
            }
            runtime.audio = audio
            runtime.audioCancel = (error) => { cleanup(); reject(error) }
            runtime.bargeTriggers = 0
            audio.onended = () => { cleanup(); resolve() }
            audio.onerror = () => { cleanup(); reject(new Error('audio playback failed')) }
            audio.play().then(() => { void controller.startBarge() }).catch((error) => { cleanup(); reject(error) })
          })
        },
        stopSpeaking() {
          runtime.speechCanceled = true
          void controller.stopBarge()
          try { runtime.ttsAbort?.abort() } catch { /* already aborted */ }
          runtime.ttsAbort = undefined
          controller.stopPlaybackNodes()
          if (runtime.audio) {
            runtime.audioCancel?.(new DOMException('canceled', 'AbortError'))
            runtime.audio = undefined
            runtime.audioCancel = undefined
          }
          if (typeof speechSynthesis !== 'undefined') {
            try { speechSynthesis.cancel() } catch { /* not available */ }
          }
        },
        async afterFailure(sessionId) {
          const strings = store.get().strings
          store.set({ phase: 'idle' })
          runtime.wakeNextAt = Date.now() + 400
          // Активация по имени: имя услышали, а команду — нет. Спрашиваем вслух
          // (или текстом) и слушаем ещё раз, вместо тихого завершения.
          if (runtime.wakeFollowUp) {
            const env = runtime.envs.get(sessionId) ?? controller.lastEnv
            if (env && runtime.wakeFollowAttempts < 2) {
              runtime.wakeFollowAttempts += 1
              // Имя услышали, а команду — нет: отвечаем голосом «да, я слушаю»
              // (как Алиса) и только потом снова открываем запись.
              const prompt = pickListeningPrompt(strings)
              if (store.get().preferences.output === 'voice') {
                try { await controller.speak(prompt, runtime.generation) } catch { /* без озвучки */ }
              } else {
                controller.notice(prompt)
              }
              if (runtime.wakeFollowUp && !runtime.pending && !store.get().enabled) {
                await delay(500)
                await controller.startRecording(env)
                return
              }
            }
            runtime.wakeFollowUp = false
            runtime.wakeFollowAttempts = 0
          }
          if (!store.get().enabled) return
          runtime.emptyAttempts += 1
          if (runtime.emptyAttempts >= EMPTY_LIMIT) {
            runtime.emptyAttempts = 0
            store.set({ enabled: false })
            controller.notice(strings.noSpeechStopped)
            return
          }
          if (store.get().preferences.mode !== 'continuous') return
          const env = runtime.envs.get(sessionId)
          if (!env) return
          const generation = runtime.generation
          await delay(1200)
          if (generation !== runtime.generation || !store.get().enabled || env.running) return
          void controller.startRecording(env)
        },
        async cancelListening() {
          runtime.prefixPcm = undefined
          runtime.prefixUsed = false
          runtime.prefixPcm = undefined
          runtime.prefixUsed = false
          runtime.generation += 1
          clearInterval(runtime.vadTimer)
          runtime.followUpListen = false
          void controller.stopWake()
          try { runtime.transcribeAbort?.abort() } catch { /* already aborted */ }
          runtime.transcribeAbort = undefined
          const capture = runtime.capture
          runtime.capture = undefined
          runtime.captureSession = ''
          store.set({ phase: 'idle', level: 0 })
          if (capture) await capture.dispose()
        },
        async stopAll() {
          runtime.generation += 1
          clearInterval(runtime.vadTimer)
          clearTimeout(runtime.turnTimer)
          clearTimeout(runtime.watchdogTimer)
          try { runtime.transcribeAbort?.abort() } catch { /* already aborted */ }
          runtime.transcribeAbort = undefined
          runtime.pending = undefined
          runtime.speechCanceled = true
          runtime.followUpListen = false
          runtime.voiceTurn = false
          void controller.stopThinkListen()
          store.set({ enabled: false, phase: 'idle', level: 0, activeSession: '' })
          controller.stopSpeaking()
          void controller.stopWake()
          runtime.wakeNextAt = Date.now() + 400
          const capture = runtime.capture
          runtime.capture = undefined
          runtime.captureSession = ''
          if (capture) await capture.dispose()
        },
        tap(env) {
          const state = store.get()
          if (state.phase === 'starting') { void controller.stopAll(); return }
          if (state.phase === 'listening') { void controller.finish(env.sessionId, runtime.generation); return }
          if (state.phase === 'speaking') {
            controller.stopSpeaking()
            void controller.startRecording(env)
            return
          }
          if (state.phase === 'thinking' || state.phase === 'transcribing') {
            void controller.stopAll()
            return
          }
          if (state.preferences.mode === 'hold') { void controller.startRecording(env); return }
          if (state.preferences.mode === 'continuous') {
            if (state.enabled) { void controller.stopAll(); return }
            store.set({ enabled: true })
            void controller.startRecording(env)
            return
          }
          void controller.startRecording(env)
        },
        holdStart(env) {
          if (store.get().preferences.mode !== 'hold') return
          const phase = store.get().phase
          if (phase === 'listening' || phase === 'starting') return
          void controller.stopAll().then(() => controller.startRecording(env))
        },
        holdEnd(env) {
          if (store.get().preferences.mode !== 'hold') return
          if (store.get().phase !== 'listening') return
          void controller.finish(env.sessionId, runtime.generation)
        },
        holdCancel() {
          const phase = store.get().phase
          if (phase !== 'listening' && phase !== 'starting') return
          void controller.cancelListening()
        },
        stop(env) {
          if (env) controller.lastEnv = env
          void controller.stopAll()
        },
        async testVoice(text) {
          controller.clearMessages()
          store.set({ phase: 'speaking' })
          try {
            await controller.speak(text, runtime.generation)
          } finally {
            if (store.get().phase === 'speaking') store.set({ phase: 'idle' })
            void controller.refreshEngine()
          }
        },
        releaseSession(sessionId) {
          if (runtime.captureSession === sessionId) void controller.cancelListening()
          if (store.get().activeSession === sessionId) void controller.stopAll()
        },
        /** Короткий отчёт о состоянии для /voice-dialog/status. */
        diagnose() {
          const state = store.get()
          const env = controller.lastEnv
          return `phase=${state.phase} mic=${state.preferences.micOn === true} wake=${state.wakeListening}`
            + ` run=${env ? env.running === true : 'none'} pend=${Boolean(runtime.pending)}`
            + ` aud=${Boolean(runtime.audio)} tts=${Boolean(runtime.ttsAbort)}`
            + ` cap=${Boolean(runtime.capture)} wcap=${Boolean(runtime.wakeCapture)}`
            + ` busy=${Boolean(runtime.wakeBusy)} next=${Math.max(0, Math.round((runtime.wakeNextAt - Date.now()) / 1000))}`
            + ` starts=${runtime.wakeStarts} fails=${runtime.wakeFails} resp=${runtime.wakeResponses}`
            + ` spk=${state.speakIndex ?? 0}/${state.speakTotal ?? 0}` + ` skip=${state.speakSkipped ?? 0}` + ` ctx=${runtime.wakeCapture?.context?.state ?? 'none'} lvl=${state.level.toFixed(2)}`
            + ` el=${Math.round((Date.now() - (runtime.wakeStartedAt || Date.now())) / 1000)} ring=${(runtime.wakeRing.samples / 16000).toFixed(1)}s segs=${runtime.wakeSegs} smp=${runtime.wakeSegSamples} segtxt=${runtime.wakeSegText}` + ` hits=${runtime.wakeHits} calls=${runtime.wakeCalls} peak=${runtime.wakePeak.toFixed(3)} sr=${runtime.wakeCapture?.context?.sampleRate ?? 0} txt=${(runtime.wakeLastText || '').slice(0, 30)}` + ` host=${runtime.wakeHost ? (runtime.wakeHost.speech ? 'sp' : 'sil') + '/' + runtime.wakeHost.silenceMs : 'none'}`
            + ` err=${String(state.error).slice(0, 40)}`
        },
        /**
         * Сторож застрявшей фазы: если запись не идёт, звука нет и ответ не
         * ждётся, а фаза всё ещё не idle — возвращаемся в покой и снова
         * включаем прослушивание имени. Иначе один сбой навсегда глушит
         * активацию по слову.
         */
        watchdog() {
          return setInterval(() => {
            const state = store.get()
            if (state.phase === 'idle') { runtime.stuckPhase = ''; runtime.stuckSince = 0; return }
            if (runtime.capture || runtime.starting || runtime.pending || runtime.ttsAbort || runtime.audio) {
              runtime.stuckPhase = ''
              runtime.stuckSince = 0
              return
            }
            if (runtime.stuckPhase !== state.phase) {
              runtime.stuckPhase = state.phase
              runtime.stuckSince = Date.now()
              return
            }
            if (Date.now() - runtime.stuckSince < 20000) return
            runtime.stuckPhase = ''
            runtime.stuckSince = 0
            store.set({ phase: 'idle', enabled: false, level: 0 })
            runtime.wakeNextAt = 0
            void controller.ensureWake()
          }, 2000)
        },
      }
      return controller
    }

    // Пиктограмма ассистента по референсу: крупная голова капибары, маленькие
    // ушки, вихор темени, сонные глаза, ноздри и длинная линия носа с галочкой.
    // Только штрих currentColor — без рамки и плашек, поэтому знак совпадает
    // по размеру и весу с остальными иконками интерфейса.
    // `muted` перечёркивает значок: микрофон выключен.
    let capybaraMaskSeq = 0

    function CapybaraIcon({ size = 18, muted = false }) {
      const maskRef = useRef(undefined)
      if (!maskRef.current) {
        capybaraMaskSeq += 1
        maskRef.current = `voice-dialog-capybara-${capybaraMaskSeq}`
      }
      const maskId = maskRef.current
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('defs', null,
          h('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 24, height: 24 },
            h('rect', { x: 0, y: 0, width: 24, height: 24, fill: '#fff' }),
            h('circle', { cx: 5.5, cy: 6.3, r: 1.8, fill: '#000' }),
            h('circle', { cx: 18.5, cy: 6.3, r: 1.8, fill: '#000' }))),
        h('g', { mask: `url(#${maskId})` },
          h('path', {
            d: 'M12 5.8C14.6 5.45 16.6 6.05 18 7.4C20.4 9.4 21.7 12 22 14.8C22.3 17.9 21.1 21 18.7 22.2C16.7 23.1 14.3 23.35 12 23.35C9.7 23.35 7.3 23.1 5.3 22.2C2.9 21 1.7 17.9 2 14.8C2.3 12 3.6 9.4 6 7.4C7.4 6.05 9.4 5.45 12 5.8Z',
            stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
          })),
        h('circle', { cx: 5.5, cy: 6.3, r: 1.9, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('circle', { cx: 18.5, cy: 6.3, r: 1.9, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', {
          d: 'M11.55 6.05L11.95 5.15M12.45 6.05L12.05 5.15',
          stroke: 'currentColor', strokeWidth: 1.15, strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M7.3 12.77Q8.8 13.83 10.3 12.77',
          stroke: 'currentColor', strokeWidth: 1.45, strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M13.7 12.77Q15.2 13.83 16.7 12.77',
          stroke: 'currentColor', strokeWidth: 1.45, strokeLinecap: 'round',
        }),
        h('ellipse', { cx: 10.85, cy: 15.33, rx: 0.27, ry: 0.43, fill: 'currentColor' }),
        h('ellipse', { cx: 13.15, cy: 15.33, rx: 0.27, ry: 0.43, fill: 'currentColor' }),
        h('path', {
          d: 'M12 15.6V18.9M12 18.9l-.38.3M12 18.9l.38.3',
          stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round',
        }),
        // Крест-накрест: микрофон выключен.
        muted ? h('path', {
          d: 'M4.2 19.8L19.8 4.2M4.2 4.2L19.8 19.8',
          stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
        }) : null)
    }

    function StopIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true },
        h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2.5, fill: 'currentColor' }))
    }

    function SpeakerIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M2.9 9.4h3.4L10.6 5.9v12.2L6.3 14.6H2.9Z',
          stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round',
        }),
        h('path', { d: 'M13.5 8.9a4.6 4.6 0 0 1 0 6.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M16.4 6.2a8 8 0 0 1 0 11.6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
    }

    function SpeakerOffIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M2.9 9.4h3.4L10.6 5.9v12.2L6.3 14.6H2.9Z',
          stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round',
        }),
        h('path', { d: 'M14.4 9.3 19.6 14.7M19.6 9.3 14.4 14.7', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }))
    }

    const buttonBase = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)', borderRadius: 8, cursor: 'pointer',
      font: 'inherit', lineHeight: 1.2,
    }

    function levelBars(level) {
      return h('span', { style: { display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 16 }, 'aria-hidden': true },
        Array.from({ length: 5 }, (_, index) => {
          const active = level * 5 > index
          return h('span', {
            key: index,
            style: {
              width: 3,
              height: 5 + index * 2,
              borderRadius: 2,
              background: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-idle-primary)',
              opacity: active ? 1 : 0.5,
            },
          })
        }))
    }

    function phaseLabel(strings, phase, preferences) {
      if (phase === 'starting') return strings.starting
      if (phase === 'listening') return preferences.mode === 'hold' ? strings.holdPrompt : strings.listening
      if (phase === 'transcribing') return strings.transcribing
      if (phase === 'thinking') return strings.thinking
      if (phase === 'speaking') return strings.speaking
      return strings.idle
    }

    function MicButton(props) {
      const { controller, sessionId, inputActions, useSession, useInput, useSessionStatus } = props
      const state = useStore(controller.store)
      const strings = state.strings
      const draft = useInput(value => value.draft)
      const inputPhase = useInput(value => value.phase)
      const running = useSession(value => value.running)
      const status = useSessionStatus(value => value.get(sessionId))
      const env = {
        sessionId, inputActions, draft, inputPhase, running,
        pendingInteraction: Boolean(status && status.pendingInteraction),
      }
      const envRef = useRef(env)
      envRef.current = env

      useEffect(() => {
        controller.observe(envRef.current)
      })

      useEffect(() => {
        const onVisibility = () => {
          if (document.visibilityState === 'hidden') return
          if (controller.store.get().preferences.micOn === true) void controller.ensureWake()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => { document.removeEventListener('visibilitychange', onVisibility) }
      }, [])

      useEffect(() => () => { controller.releaseSession(sessionId) }, [sessionId])

      // Морда капибары — только тумблер микрофона: включить или выключить
      // прослушивание имени. Никаких записей, удержаний и панелей.
      const micOn = state.preferences.micOn === true
      const toggle = () => {
        try {
          controller.toggleMic()
        } catch (error) {
          controller.fail(`${state.strings.engineError}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const onKeyDown = (event) => {
        if (event.key !== ' ' && event.key !== 'Enter') return
        event.preventDefault()
        toggle()
      }

      const title = micOn ? strings.micOnTitle : strings.micOffTitle
      return h('button', {
        type: 'button',
        title,
        'aria-label': title,
        'aria-pressed': micOn,
        onClick: toggle,
        onKeyDown,
        style: {
          ...buttonBase,
          position: 'relative',
          width: 28,
          height: 28,
          padding: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: micOn ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        },
      },
      h(CapybaraIcon, { size: 20, muted: !micOn }))
    }

    /**
     * Динамик рядом с микрофоном: включает и выключает озвучку ответов.
     * Состояние то же, что у настройки «Способ ответа» во вкладке «Ассистент».
     */
    function SpeakerButton(props) {
      const { controller } = props
      const state = useStore(controller.store)
      const strings = state.strings
      const voice = state.preferences.output === 'voice'
      return h('button', {
        type: 'button',
        title: voice ? strings.voiceOn : strings.voiceOff,
        'aria-label': voice ? strings.voiceOn : strings.voiceOff,
        'aria-pressed': voice,
        onClick: () => controller.setPreferences({ output: voice ? 'text' : 'voice' }),
        style: {
          ...buttonBase,
          width: 30,
          height: 30,
          padding: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: voice ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        },
      }, voice ? h(SpeakerIcon, { size: 28 }) : h(SpeakerOffIcon, { size: 28 }))
    }

    // Панель статуса над композером больше не дублирует настройки: все они
    // живут во вкладке «Ассистент». Здесь остаётся только сообщение об ошибке
    // (например, браузер не дал микрофон), и оно гаснет само.
    function VoiceNotice(props) {
      const state = useStore(props.controller.store)
      if (state.error === '') return null
      return h('div', {
        role: 'alert',
        style: {
          marginTop: 6, padding: '6px 10px', borderRadius: 8, fontSize: 12,
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-state-error-primary)',
        },
      }, state.error)
    }

    function RowLabel({ children }) {
      return h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 4 } }, children)
    }

    function Choice({ label, selected, onClick }) {
      return h('button', {
        type: 'button',
        onClick,
        'aria-pressed': selected,
        style: {
          ...buttonBase, padding: '5px 10px', fontSize: 12,
          background: selected ? 'var(--dsw-alias-brand-primary)' : 'transparent',
          color: selected ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-label-primary)',
          borderColor: selected ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)',
        },
      }, label)
    }

    function VoiceSettings(props) {
      const { controller } = props
      const state = useStore(controller.store)
      const strings = state.strings
      const preferences = state.preferences
      useEffect(() => { void controller.refreshEngine() }, [])
      const workerLabel = state.engine.worker === 'ready' ? strings.workerReady
        : state.engine.worker === 'starting' ? strings.workerStarting : strings.workerStopped
      const mark = (ready) => !state.engine.checked ? strings.checking
        : ready ? h('span', { style: { color: 'var(--dsw-alias-state-success-primary)' } }, strings.ready)
          : h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, strings.missing)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 2px', maxWidth: 640, color: 'var(--dsw-alias-label-primary)' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, strings.title),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, strings.intro),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, strings.speedNote)),
        // Режимов больше нет: микрофон просто включён/выключен, а запись
        // начинается только когда услышано имя.
        h('div', null,
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, strings.modeNote)),
        h('div', null,
          h(RowLabel, null, strings.reply),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Choice, { label: strings.replyVoice, selected: preferences.output === 'voice', onClick: () => controller.setPreferences({ output: 'voice' }) }),
            h(Choice, { label: strings.replyText, selected: preferences.output === 'text', onClick: () => controller.setPreferences({ output: 'text' }) }))),
        h('div', null,
          h(RowLabel, null, strings.wakeTitle),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Choice, { label: strings.wakeOn, selected: preferences.wakeEnabled === true, onClick: () => controller.setPreferences({ wakeEnabled: true }) }),
            h(Choice, { label: strings.wakeOff, selected: preferences.wakeEnabled !== true, onClick: () => controller.setPreferences({ wakeEnabled: false }) })),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } }, strings.wakeHint),
          h('div', { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 } },
            h('div', { style: { fontSize: 12 } }, strings.wakeWordsLabel),
            h('input', {
              type: 'text',
              value: preferences.wakeWords ?? '',
              placeholder: strings.wakeExample,
              onChange: (event) => controller.setPreferences({ wakeWords: event.target.value }),
              style: {
                padding: '6px 8px', fontSize: 13, borderRadius: 6,
                border: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-base)',
                color: 'var(--dsw-alias-label-primary)',
              },
            }),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 } },
              h(Choice, { label: strings.samplesOff, selected: preferences.collectSamples !== true, onClick: () => controller.setPreferences({ collectSamples: false }) }),
              h(Choice, { label: strings.samplesOn, selected: preferences.collectSamples === true, onClick: () => controller.setPreferences({ collectSamples: true }) })),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' } },
              h('button', {
                type: 'button',
                onClick: () => {
                  if (state.sampleRecording) void controller.stopVoiceRecord()
                  else void controller.startVoiceRecord()
                },
                style: {
                  padding: '6px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  background: state.sampleRecording ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-bg-base)',
                  color: state.sampleRecording ? '#ffffff' : 'var(--dsw-alias-label-primary)',
                },
              }, state.sampleRecording ? `${strings.samplesStop} · ${state.sampleSeconds} с` : strings.samplesStart),
              h(Choice, { label: strings.samplesLabelName, selected: preferences.sampleLabel !== 'neg', onClick: () => controller.setPreferences({ sampleLabel: 'pos' }) }),
              h(Choice, { label: strings.samplesLabelBackground, selected: preferences.sampleLabel === 'neg', onClick: () => controller.setPreferences({ sampleLabel: 'neg' }) })),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, strings.samplesHint))),
        h('div', null,
          h(RowLabel, null, strings.bargeTitle),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Choice, { label: strings.bargeOn, selected: preferences.bargeIn !== false, onClick: () => controller.setPreferences({ bargeIn: true }) }),
            h(Choice, { label: strings.bargeOff, selected: preferences.bargeIn === false, onClick: () => controller.setPreferences({ bargeIn: false }) })),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } },
            preferences.bargeIn === false ? strings.bargeOffHint : strings.bargeHint)),
        h('div', null,
          h(RowLabel, null, strings.dictationTitle),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Choice, { label: strings.dictationWhole, selected: preferences.dictation !== 'split', onClick: () => controller.setPreferences({ dictation: 'whole' }) }),
            h(Choice, { label: strings.dictationSplit, selected: preferences.dictation === 'split', onClick: () => controller.setPreferences({ dictation: 'split' }) })),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } },
            preferences.dictation === 'split' ? strings.dictationSplitHint : strings.dictationWholeHint)),
        h('div', null,
          h(RowLabel, null, strings.followUpTitle),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Choice, { label: strings.followUpOff, selected: Number(preferences.followUp) === 0, onClick: () => controller.setPreferences({ followUp: 0 }) }),
            h(Choice, { label: strings.followUpShort, selected: Number(preferences.followUp) === 3000, onClick: () => controller.setPreferences({ followUp: 3000 }) }),
            h(Choice, { label: strings.followUpLong, selected: Number(preferences.followUp) === 5000, onClick: () => controller.setPreferences({ followUp: 5000 }) })),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } }, strings.followUpHint)),
        h('div', null,
          h(RowLabel, null, strings.language),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Choice, { label: strings.langRu, selected: preferences.language === 'ru', onClick: () => controller.setPreferences({ language: 'ru' }) }),
            h(Choice, { label: strings.langEn, selected: preferences.language === 'en', onClick: () => controller.setPreferences({ language: 'en' }) }),
            h(Choice, { label: strings.langAuto, selected: preferences.language === 'auto', onClick: () => controller.setPreferences({ language: 'auto' }) }))),
        h('div', null,
          h(RowLabel, null, strings.engine),
          h('div', { style: { fontSize: 12 } }, strings.engineSilero),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } }, strings.engineNote)),
        h('div', null,
          h(RowLabel, null, strings.voice),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            VOICES.map(voice => h(Choice, {
              key: voice,
              label: strings[`voice${voice.charAt(0).toUpperCase()}${voice.slice(1)}`],
              selected: preferences.voice === voice,
              onClick: () => controller.setPreferences({ voice }),
            }))),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } }, strings.voiceHint)),
        preferences.tts === 'silero' ? h('div', null,
          h(RowLabel, null, strings.speed),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Choice, { label: strings.speedSlow, selected: preferences.speed === 80, onClick: () => controller.setPreferences({ speed: 80 }) }),
            h(Choice, { label: strings.speedNormal, selected: preferences.speed === 100, onClick: () => controller.setPreferences({ speed: 100 }) }),
            h(Choice, { label: strings.speedFast, selected: preferences.speed === 120, onClick: () => controller.setPreferences({ speed: 120 }) })),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } }, strings.speedHint)) : null,
        preferences.tts === 'silero' ? h('div', null,
          h(RowLabel, null, strings.pauses),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Choice, { label: strings.pauseShort, selected: preferences.pauses === 0.6, onClick: () => controller.setPreferences({ pauses: 0.6 }) }),
            h(Choice, { label: strings.pauseNormal, selected: preferences.pauses === 1, onClick: () => controller.setPreferences({ pauses: 1 }) }),
            h(Choice, { label: strings.pauseExpressive, selected: preferences.pauses === 1.7, onClick: () => controller.setPreferences({ pauses: 1.7 }) })),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } }, strings.pauseHint)) : null,
        h('div', null,
          h(RowLabel, null, strings.sensitivity),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(Choice, { label: strings.sensitivityLow, selected: preferences.sensitivity === 'low', onClick: () => controller.setPreferences({ sensitivity: 'low' }) }),
            h(Choice, { label: strings.sensitivityNormal, selected: preferences.sensitivity === 'normal', onClick: () => controller.setPreferences({ sensitivity: 'normal' }) }),
            h(Choice, { label: strings.sensitivityHigh, selected: preferences.sensitivity === 'high', onClick: () => controller.setPreferences({ sensitivity: 'high' }) }))),
        h('div', null,
          h(RowLabel, null, strings.status),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 } },
            h('div', null, `${strings.statusAsr}: `, mark(state.engine.asr), ' · ', `${strings.statusTts}: `, mark(state.engine.tts), ' · ', `${strings.worker}: `, workerLabel),
            // Живое состояние: видно, слушает ли микрофон имя прямо сейчас.
            h('div', null, `${strings.mic}: `, state.preferences.micOn === true
              ? (state.wakeListening ? strings.wakeArmed : `${strings.idle} (${state.phase})`)
              : strings.micOffState),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, `${strings.recognized}: ${state.heardText || '—'} · KWS ${Number(state.wakeScore ?? 0).toFixed(2)}`),
            state.engine.lastError ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 } }, state.engine.lastError) : null,
            state.error !== '' ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 11 } }, state.error) : null,
            state.notice !== '' ? h('div', { style: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 11 } }, state.notice) : null)),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', {
            type: 'button',
            onClick: () => { void (async () => {
              try {
                await controller.testVoice(strings.testPhrase)
              } catch (error) {
                controller.fail(`${strings.engineError}: ${error instanceof Error ? error.message : String(error)}`)
              }
            })() },
            style: { ...buttonBase, padding: '6px 12px', fontSize: 12 },
          }, h(SpeakerIcon, { size: 14 }), strings.speakTest),
          h('button', {
            type: 'button',
            onClick: () => { void controller.refreshEngine() },
            style: { ...buttonBase, padding: '6px 12px', fontSize: 12 },
          }, strings.status)))
    }

    function AssistantIcon({ size = 18 }) {
      return h('span', {
        style: { display: 'inline-flex' },
        'data-dsh-plugin': '@local/voice-dialog',
        'data-dsh-part': 'sidebar-icon',
      }, h(CapybaraIcon, { size: Math.round(size * 1.1) }))
    }

    function AssistantPanel(props) {
      const { controller } = props
      const state = useStore(controller.store)
      const strings = state.strings
      const [profile, setProfile] = React.useState({ persona: '', address: '', corrections: '', facts: '' })
      const [status, setStatus] = React.useState('')

      React.useEffect(() => {
        let alive = true
        fetch(`${BASE}/assistant`, { signal: AbortSignal.timeout(8000) })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
          .then((value) => {
            if (!alive) return
            setProfile({
              persona: String(value.persona ?? ''),
              address: String(value.address ?? ''),
              corrections: String(value.corrections ?? ''),
              facts: String(value.facts ?? ''),
            })
          })
          .catch(() => { if (alive) setStatus(strings.profileError) })
        return () => { alive = false }
      }, [])

      const save = async () => {
        setStatus('')
        try {
          const response = await fetch(`${BASE}/assistant`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(profile),
            signal: AbortSignal.timeout(8000),
          })
          if (!response.ok) throw new Error(String(response.status))
          const value = await response.json()
          setProfile({
            persona: String(value.persona ?? ''),
            address: String(value.address ?? ''),
            corrections: String(value.corrections ?? ''),
              facts: String(value.facts ?? ''),
          })
          setStatus(strings.profileSaved)
        } catch { setStatus(strings.profileError) }
      }

      const field = {
        padding: '8px 10px', fontSize: 13, borderRadius: 8, boxSizing: 'border-box', width: '100%',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
      }
      const hint = { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 }
      return h('div', {
        style: {
          padding: '18px 22px',
          boxSizing: 'border-box',
          width: '100%',
          height: '100%',
          maxHeight: '100%',
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          color: 'var(--dsw-alias-label-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        },
      },
      h('div', null,
        h('div', { style: { fontSize: 18, fontWeight: 600 } }, strings.assistantNav),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } }, strings.assistantIntro)),
      h('div', null,
        h(RowLabel, null, strings.personaTitle),
        h('textarea', {
          rows: 6,
          value: profile.persona,
          style: field,
          onChange: (event) => setProfile({ ...profile, persona: event.target.value }),
        }),
        h('div', { style: hint }, strings.personaHint)),
      h('div', null,
        h(RowLabel, null, strings.addressTitle),
        h('input', {
          type: 'text',
          value: profile.address,
          style: field,
          onChange: (event) => setProfile({ ...profile, address: event.target.value }),
        }),
        h('div', { style: hint }, strings.addressHint)),
      h('div', null,
        h(RowLabel, null, strings.correctionsTitle),
        h('textarea', {
          rows: 5,
          value: profile.corrections,
          style: field,
          onChange: (event) => setProfile({ ...profile, corrections: event.target.value }),
        }),
        h('div', { style: hint }, strings.correctionsHint)),
      h('div', null,
        h(RowLabel, null, strings.factsTitle),
        h('textarea', {
          rows: 5,
          value: profile.facts,
          style: field,
          onChange: (event) => setProfile({ ...profile, facts: event.target.value }),
        }),
        h('div', { style: hint }, strings.factsHint)),
      h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
        h('button', {
          type: 'button',
          onClick: () => { void save() },
          style: { ...buttonBase, padding: '7px 14px', fontSize: 12 },
        }, strings.saveProfile),
        status !== '' ? h('span', {
          style: {
            fontSize: 11,
            color: status === strings.profileSaved
              ? 'var(--dsw-alias-state-success-primary)'
              : 'var(--dsw-alias-state-error-primary)',
          },
        }, status) : null),
      h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 14 } },
        h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 10 } }, strings.voiceSectionTitle),
        h(VoiceSettings, { controller })))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const controller = createController()
        controller.setStrings(stringsFor(ctx.locale.getLocale().active))
        ctx.effect(() => {
          controller.setStrings(stringsFor(ctx.locale.getLocale().active))
          return ctx.locale.subscribe(() => {
            controller.setStrings(stringsFor(ctx.locale.getLocale().active))
          })
        })
        ctx.effect(() => () => { void controller.stopAll() })

        // Кодовое слово: раз в секунду проверяем, можно ли снова слушать микрофон.
        // Сам проход идемпотентен и запускается только когда диалог выключен.
        // Проверяем чаще: после ответа микрофон должен снова слушать почти сразу,
        // иначе первое «Валера» пропадает в «глухую» секунду.
        const wakeTick = setInterval(() => { void controller.ensureWake() }, 400)
        const stuckTick = controller.watchdog()
        // Жест пользователя снимает блокировку автовоспроизведения с аудиоконтекста.
        const resumeAudio = () => { controller.resumeAudio() }
        window.addEventListener('pointerdown', resumeAudio, { once: true })
        window.addEventListener('keydown', resumeAudio, { once: true })
        // Горячая клавиша Ctrl+Alt+V: включить/выключить ассистента, не трогая мышь.
        // Работает, пока окно DSH в фокусе: глобальный хоткей требует Electron-API,
        // которого у клиентского плагина нет.
        const hotkey = (event) => {
          if (!event.ctrlKey || !event.altKey || event.code !== 'KeyV') return
          event.preventDefault()
          try { controller.toggleMic() } catch { /* гонка состояний не критична */ }
        }
        window.addEventListener('keydown', hotkey)
        ctx.effect(() => () => {
          clearInterval(wakeTick)
          clearInterval(stuckTick)
          window.removeEventListener('pointerdown', resumeAudio)
          window.removeEventListener('keydown', resumeAudio)
          window.removeEventListener('keydown', hotkey)
          void controller.stopWake()
        })

        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: 'voice-dialog-mic', order: 4,
          inject: () => ({ controller }),
        }, MicButton))

        // Динамик справа от микрофона: голос или текст в ответах.
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: 'voice-dialog-speaker', order: 5,
          inject: () => ({ controller }),
        }, SpeakerButton))

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: 'voice-dialog-notice', order: 10,
          inject: () => ({ controller }),
        }, VoiceNotice))

        // Левая колонка: отдельный пункт «Ассистент» рядом с плагинами,
        // автоматизациями и памятью. Настройки больше не привязаны к сессии.
        ctx.slots.inject('main', () => ctx.slots.inject('sidebar.panellist', () => {
          const stopMain = ctx.slots.register({
            name: 'main',
            key: 'voice-assistant',
            inject: () => ({ controller }),
          }, AssistantPanel)
          const stopIcon = ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'voice-assistant',
            order: 40,
            label: () => controller.store.get().strings.assistantNav,
          }, AssistantIcon)
          return () => {
            stopIcon?.()
            stopMain?.()
          }
        }))

        void controller.refreshEngine()
        // Report the hosting surface once per module load: the Desktop shell and
        // the served Web page reach these routes through different carriers.
        try {
          void fetch(`${BASE}/client-info`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              protocol: location.protocol,
              origin: location.origin,
              userAgent: navigator.userAgent,
            }),
          }).catch(() => undefined)
        } catch { /* diagnostics are best effort */ }
        // Диагностика: раз в 3 секунды отдаём состояние в /status (поле origin).
        // По ней видно, слушает ли клиент имя и что его блокирует.
        const pushDiag = () => {
          const snapshot = controller.store.get()
          try {
            void fetch(`${BASE}/client-info`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                protocol: location.protocol,
                origin: `diag ${controller.diagnose()}`,
                userAgent: navigator.userAgent,
              }),
            }).catch(() => undefined)
          } catch { /* best effort */ }
        }
        const diagTimer = setInterval(pushDiag, 3000)
        ctx.effect(() => () => { clearInterval(diagTimer) })
      },
    }
  },
})


// end of voice dialog client bundle

