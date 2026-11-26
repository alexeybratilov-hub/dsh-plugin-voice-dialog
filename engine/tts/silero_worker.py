"""Silero Russian TTS worker for the voice dialog plugin.

The model stays loaded between utterances, so the first answer pays the model
load once and later answers only pay synthesis. The protocol is one JSON object
per line on stdin and one JSON reply per line on fd 3 (stdout and stderr are
left to the libraries, which like to print there):

    {"id": 1, "cmd": "synth", "text": "Привет.", "voice": "baya",
     "out": "C:/tmp/answer.wav"}

Silero v5 understands SSML, so the text is spoken as one continuous phrase with
explicit `<break>` pauses that follow the punctuation. Older v4 archives are
still supported by speaking sentence by sentence and joining the audio.
"""

from __future__ import annotations

import inspect
import json
import os
import re
import sys
import time
import traceback
import wave
import translit_en
import numerals_ru
import units_ru

# Take the reply channel before importing the engine: PyTorch prints runtime
# warnings on stdout, and that must never land in the JSON stream.
try:
    _proto = os.fdopen(3, "w", buffering=1, encoding="utf-8", newline="\n")
except OSError:
    _proto = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8", newline="\n")

import numpy as np  # noqa: E402 - imported after the protocol channel is taken
import torch  # noqa: E402 - imported after the protocol channel is taken

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_CANDIDATES = ("v5_6_ru.pt", "v5_5_ru.pt", "v5_ru.pt", "v4_ru.pt")
SAMPLE_RATE = 48000
DEFAULT_VOICE = "baya"
MAX_TEXT = 6000
BLOCK_CHARS = 900

SENTENCE_SPLIT = re.compile(r"(?<=[.!?\u2026])\s+")
PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")

# Pause length in milliseconds for the punctuation that closes a phrase.
STRONG_PAUSE = {"\u2026": 700, "?": 520, "!": 500, ".": 430, ":": 350, ";": 380, "\u2014": 300}
COMMA_PAUSE = 0
MAX_SEGMENT = 210

_model = None
_model_name = ""
_speakers: list[str] = []
_ssml = False


def emit(payload: dict) -> None:
    _proto.write(json.dumps(payload, ensure_ascii=False) + "\n")
    _proto.flush()


def resolve_model_path() -> str:
    for name in MODEL_CANDIDATES:
        candidate = os.path.join(HERE, "models", name)
        if os.path.exists(candidate):
            return candidate
    raise FileNotFoundError("no Silero model in " + os.path.join(HERE, "models"))


def load_model() -> None:
    global _model, _model_name, _speakers, _ssml
    started = time.time()
    path = resolve_model_path()
    # Silero ships its models as torch.package archives, not plain TorchScript files.
    from torch.package import PackageImporter

    _model = PackageImporter(path).load_pickle("tts_models", "model")
    _model_name = os.path.basename(path)
    _speakers = list(getattr(_model, "speakers", []))
    _ssml = "ssml_text" in inspect.signature(_model.apply_tts).parameters
    # The first synthesis pays kernel warm-up (several seconds at 48 kHz), so do
    # it now while the user is still speaking instead of on the first answer.
    warmup_started = time.time()
    with torch.no_grad():
        _model.apply_tts(text="\u0420\u0430\u0437.", speaker=_speakers[0] if _speakers else DEFAULT_VOICE, sample_rate=SAMPLE_RATE)
    elapsed = time.time() - started
    print(
        f"[silero] {_model_name} loaded in {elapsed:.1f}s (warm-up {time.time() - warmup_started:.1f}s), "
        f"ssml={_ssml}, speakers={_speakers}",
        file=sys.stderr,
        flush=True,
    )


def escape_ssml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def pause_after(text: str) -> int:
    """Pause implied by the punctuation that ends the phrase, in milliseconds."""
    stripped = text.rstrip(" \u00a0\u00bb\u201d\"')")
    if stripped.endswith("\u2026"):
        return STRONG_PAUSE["\u2026"]
    for mark in "?!.":
        if stripped.endswith(mark):
            return STRONG_PAUSE[mark]
    if stripped.endswith(":"):
        return STRONG_PAUSE[":"]
    if stripped.endswith(";"):
        return STRONG_PAUSE[";"]
    if stripped.endswith("\u2014"):
        return STRONG_PAUSE["\u2014"]
    if stripped.endswith(","):
        return COMMA_PAUSE
    return 0


def to_ssml(text: str, pause_scale: float = 1.0, rate_percent: int = 100) -> str:
    """Put the punctuation into SSML breaks so phrases breathe like a reader.

    ``pause_scale`` stretches or shortens every break; ``rate_percent`` is the
    Silero prosody rate (70-130, where 100 is the model's own pace).
    """
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    paragraphs = [part.strip() for part in PARAGRAPH_SPLIT.split(normalized) if part.strip()]
    parts: list[str] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        paragraph = re.sub(r"[ \t]+", " ", paragraph)
        sentences = [part.strip() for part in SENTENCE_SPLIT.split(paragraph) if part.strip()]
        for sentence_index, sentence in enumerate(sentences):
            parts.append(escape_ssml(sentence))
            if sentence_index < len(sentences) - 1:
                pause = int((pause_after(sentence) or 430) * pause_scale)
                parts.append(f'<break time="{max(60, pause)}ms"/>')
        if paragraph_index < len(paragraphs) - 1:
            parts.append(f'<break time="{max(120, int(700 * pause_scale))}ms"/>')
    body = " ".join(parts)
    if rate_percent != 100:
        body = f'<prosody rate="{rate_percent}%">{body}</prosody>'
    return f"<speak>{body}</speak>"


def split_long(sentence: str) -> list[str]:
    """Split an over-long sentence at a natural break, never mid-word."""
    if len(sentence) <= MAX_SEGMENT:
        return [sentence]
    pieces: list[str] = []
    rest = sentence
    while len(rest) > MAX_SEGMENT:
        window = rest[:MAX_SEGMENT]
        cut = -1
        for separator in ("; ", " \u2014 ", ": ", ", "):
            index = window.rfind(separator)
            if index > cut:
                cut = index + len(separator)
        if cut < 60:
            space = window.rfind(" ")
            cut = space if space > 60 else MAX_SEGMENT
        pieces.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        pieces.append(rest)
    return pieces


def segment_text(text: str) -> list[tuple[str, int]]:
    """Fallback for v4: spoken segments with the pause that follows each one."""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    segments: list[tuple[str, int]] = []
    paragraphs = [part.strip() for part in PARAGRAPH_SPLIT.split(normalized) if part.strip()]
    for paragraph in paragraphs:
        paragraph = re.sub(r"[ \t]+", " ", paragraph).strip()
        sentences = [part.strip() for part in SENTENCE_SPLIT.split(paragraph) if part.strip()]
        for sentence_index, sentence in enumerate(sentences):
            pieces = split_long(sentence)
            for piece_index, piece in enumerate(pieces):
                if piece_index == len(pieces) - 1:
                    pause = pause_after(piece) or 430
                    if sentence_index == len(sentences) - 1:
                        pause = max(pause, 560)
                else:
                    pause = pause_after(piece) or 190
                segments.append((piece, pause))
    return segments


def split_blocks(text: str) -> list[str]:
    """Bound one synthesis call so a long answer still starts quickly."""
    blocks: list[str] = []
    paragraphs = [part.strip() for part in PARAGRAPH_SPLIT.split(text) if part.strip()]
    current = ""
    for paragraph in paragraphs:
        if len(current) + len(paragraph) + 1 <= BLOCK_CHARS:
            current = f"{current}\n\n{paragraph}".strip()
            continue
        if current:
            blocks.append(current)
        if len(paragraph) <= BLOCK_CHARS:
            current = paragraph
            continue
        sentences = [part.strip() for part in SENTENCE_SPLIT.split(paragraph) if part.strip()]
        chunk = ""
        for sentence in sentences:
            if len(chunk) + len(sentence) + 1 > BLOCK_CHARS and chunk:
                blocks.append(chunk)
                chunk = sentence
            else:
                chunk = f"{chunk} {sentence}".strip()
        current = chunk
    if current:
        blocks.append(current)
    return blocks or [text]


CYRILLIC = re.compile(r"[\u0400-\u04FF]")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

# Русская модель отбрасывает латиницу: без кириллицы текст становится пустым и
# Silero бросает ValueError. Для чисто английских фраз подставляем похожие
# кириллические буквы, чтобы ответ всё-таки прозвучал.
LATIN_TO_CYRILLIC = str.maketrans({
    "a": "а", "b": "б", "c": "к", "d": "д", "e": "е", "f": "ф", "g": "г",
    "h": "х", "i": "и", "j": "дж", "k": "к", "l": "л", "m": "м", "n": "н",
    "o": "о", "p": "п", "q": "к", "r": "р", "s": "с", "t": "т", "u": "у",
    "v": "в", "w": "в", "x": "кс", "y": "и", "z": "з",
    "A": "А", "B": "Б", "C": "К", "D": "Д", "E": "Е", "F": "Ф", "G": "Г",
    "H": "Х", "I": "И", "J": "ДЖ", "K": "К", "L": "Л", "M": "М", "N": "Н",
    "O": "О", "P": "П", "Q": "К", "R": "Р", "S": "С", "T": "Т", "U": "У",
    "V": "В", "W": "В", "X": "КС", "Y": "И", "Z": "З",
})


def sanitize_for_tts(text: str) -> str:
    """Turn characters the Russian model cannot parse into spoken words.

    Silero's SSML parser chokes on bare ``&``/``<``/``>``, and its symbol table
    drops Latin letters, so an all-English block ends up empty and raises.
    """
    value = text.replace("&", " и ").replace("<", " меньше ").replace(">", " больше ")
    value = CONTROL.sub(" ", value)
    return value


def ensure_cyrillic(text: str) -> str:
    """Латинский блок модель не произнесёт: подставляем похожие кириллические буквы."""
    if CYRILLIC.search(text):
        return text
    return text.translate(LATIN_TO_CYRILLIC)


def synthesize_plain(text: str, speaker: str) -> list[np.ndarray]:
    """Send one block through the plain (non-SSML) path, sentence by sentence.

    Used as a fallback when the SSML parser rejects a block or the model calls
    it too long: short segments always fit the model's trained input length.
    """
    chunks: list[np.ndarray] = []
    for segment, pause in segment_text(text):
        if not CYRILLIC.search(segment):
            continue
        audio = _model.apply_tts(
            text=segment,
            speaker=speaker,
            sample_rate=SAMPLE_RATE,
            put_accent=True,
            put_yo=True,
        )
        chunks.append(np.asarray(audio.detach().cpu().numpy(), dtype=np.float32).reshape(-1))
        chunks.append(silence(pause))
    return chunks


EN_MODEL_FILE = "v3_en.pt"
EN_DEFAULT_VOICE = "en_0"
_model_en = None
_speakers_en: list[str] = []


def resolve_en_model_path() -> str | None:
    candidate = os.path.join(HERE, "models", EN_MODEL_FILE)
    return candidate if os.path.exists(candidate) else None


def load_model_en():
    """Английская модель Silero: грузим по первому английскому куску."""
    global _model_en, _speakers_en
    if _model_en is not None:
        return _model_en
    path = resolve_en_model_path()
    if path is None:
        return None
    from torch.package import PackageImporter

    started = time.time()
    model = PackageImporter(path).load_pickle("tts_models", "model")
    _model_en = model
    _speakers_en = [str(name) for name in getattr(model, "speakers", [])]
    print(
        f"[silero] {EN_MODEL_FILE} loaded in {time.time() - started:.1f}s, voices={len(_speakers_en)}",
        file=sys.stderr,
        flush=True,
    )
    return _model_en


def split_runs(text: str) -> list[tuple[str, str]]:
    """Разбить текст на русские и английские куски по алфавиту букв."""
    runs: list[tuple[str, str]] = []
    current: list[str] = []
    language = ""
    for char in text:
        if re.match(r"[A-Za-z]", char):
            tag = "en"
        elif CYRILLIC.match(char):
            tag = "ru"
        else:
            tag = language
        if not tag:
            tag = "ru"
        if current and tag != language:
            runs.append((language, "".join(current)))
            current = []
        language = tag
        current.append(char)
    if current:
        runs.append((language, "".join(current)))
    return runs


def synthesize_english(text: str, pause_scale: float = 1.0) -> list[np.ndarray]:
    """Английский кусок читает Piper; если его нет — Silero en, иначе пусто."""
    chunks: list[np.ndarray] = []
    for segment, pause in segment_text(text):
        if not re.search(r"[A-Za-z]", segment):
            continue
        audio = synthesize_english_piper(segment)
        if audio is None:
            audio = synthesize_english_silero(segment)
        if audio is None or audio.size == 0:
            continue
        chunks.append(audio)
        chunks.append(silence(int(pause * max(pause_scale, 0.3))))
    return chunks


def english_voice_paths() -> tuple[str, str, str] | None:
    """Пути piper.exe, .onnx и .onnx.json — или None, если чего-то нет."""
    engine = os.path.dirname(HERE)
    exe = os.path.join(engine, "_disabled", "piper", "piper", "piper.exe")
    model = os.path.join(engine, "models", "piper-en", "en_US-lessac-medium.onnx")
    config = model + ".json"
    if os.path.exists(exe) and os.path.exists(model) and os.path.exists(config):
        return exe, model, config
    return None


def synthesize_english_piper(segment: str) -> np.ndarray | None:
    """Piper: ONNX без TorchScript, на фразу уходит ~0.2 с."""
    paths = english_voice_paths()
    if paths is None:
        return None
    exe, model, config = paths
    import subprocess
    import tempfile
    import wave as wave_module

    handle, target = tempfile.mkstemp(suffix=".wav")
    os.close(handle)
    try:
        result = subprocess.run(
            [exe, "-m", model, "-c", config, "-f", target],
            input=segment.encode("utf-8"),
            capture_output=True,
            timeout=60,
        )
        if result.returncode != 0 or not os.path.exists(target):
            print(f"[silero] piper failed: {result.stderr[-200:]!r}", file=sys.stderr, flush=True)
            return None
        with wave_module.open(target, "rb") as handle:
            rate = handle.getframerate()
            frames = handle.readframes(handle.getnframes())
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
        if rate != SAMPLE_RATE and samples.size > 1:
            # Приводим 22.05 кГц к 48 кГц: остальному пайплайну нужен один формат.
            count = int(round(samples.size * SAMPLE_RATE / rate))
            original = np.linspace(0.0, 1.0, samples.size, endpoint=False)
            scaled = np.linspace(0.0, 1.0, count, endpoint=False)
            samples = np.interp(scaled, original, samples).astype(np.float32)
        return samples
    except Exception as error:  # noqa: BLE001 - без Piper пробуем Silero en
        print(f"[silero] piper error ({type(error).__name__}: {error})", file=sys.stderr, flush=True)
        return None
    finally:
        try:
            os.remove(target)
        except OSError:
            pass


def synthesize_english_silero(segment: str) -> np.ndarray | None:
    """Запасной вариант — английская Silero (медленнее на новых длинах)."""
    model = load_model_en()
    if model is None:
        return None
    voice = EN_DEFAULT_VOICE if EN_DEFAULT_VOICE in _speakers_en else (_speakers_en[0] if _speakers_en else EN_DEFAULT_VOICE)
    try:
        with torch.jit.optimized_execution(False), torch.no_grad():
            audio = model.apply_tts(text=segment, speaker=voice, sample_rate=SAMPLE_RATE)
        return np.asarray(audio.detach().cpu().numpy(), dtype=np.float32).reshape(-1)
    except Exception as error:  # noqa: BLE001 - пропускаем кусок, а не ответ
        print(f"[silero] english block skipped ({type(error).__name__}: {error})", file=sys.stderr, flush=True)
        return None

def synthesize(text: str, speaker: str, pause_scale: float = 1.0, rate_percent: int = 100) -> np.ndarray:
    # Сокращения и единицы — словами, затем цифры, затем род числительного.
    text = sanitize_for_tts(text)
    text = units_ru.expand_units(text)
    text = numerals_ru.replace_numbers(text)
    text = units_ru.fix_feminine(text)
    # Совсем без букв (цифры, знаки) произносить нечего.
    if not re.search(r"[A-Za-z\u0400-\u04FF]", text):
        return np.zeros(0, dtype=np.float32)
    chunks: list[np.ndarray] = []
    with torch.no_grad():
        # Русские и английские куски читаем разными моделями: русская латиницу
        # не произносит, и раньше английский текст превращался в кашу.
        for language, run in split_runs(text):
            if language == "en":
                mode = os.environ.get("VOICE_EN_MODE", "translit").lower()
                if mode == "piper":
                    english = synthesize_english(run, pause_scale)
                    if english:
                        chunks.extend(english)
                        continue
                elif mode == "silero":
                    audio = synthesize_english_silero(run)
                    if audio is not None and audio.size > 0:
                        chunks.append(audio)
                        chunks.append(silence(int(300 * max(pause_scale, 0.3))))
                        continue
                # По умолчанию — транслитерация в кириллицу: читает тот же
                # русский голос, без второго тембра в ответе.
                transliterated = translit_en.text_to_cyrillic(run)
                if not transliterated.strip():
                    continue
                run = transliterated
            blocks = split_blocks(run) if _ssml else [run]
            for raw_block in blocks:
                block = ensure_cyrillic(raw_block)
                if not CYRILLIC.search(block):
                    continue
                if _ssml:
                    try:
                        audio = _model.apply_tts(
                            ssml_text=to_ssml(block, pause_scale, rate_percent),
                            speaker=speaker,
                            sample_rate=SAMPLE_RATE,
                            put_accent=True,
                            put_yo=True,
                        )
                        chunks.append(np.asarray(audio.detach().cpu().numpy(), dtype=np.float32).reshape(-1))
                        # Пауза между фразами: клиент уже режет по предложениям,
                        # длинная пауза здесь превращалась в «заикание».
                        chunks.append(silence(120))
                        continue
                    except Exception as error:  # noqa: BLE001 - any parser/model refusal
                        print(
                            f"[silero] ssml failed ({type(error).__name__}: {error}); plain fallback",
                            file=sys.stderr,
                            flush=True,
                        )
                try:
                    chunks.extend(synthesize_plain(block, speaker))
                except Exception as error:  # noqa: BLE001 - skip a block instead of failing the answer
                    print(
                        f"[silero] block skipped ({type(error).__name__}: {error})",
                        file=sys.stderr,
                        flush=True,
                    )
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks)


def silence(milliseconds: int) -> np.ndarray:
    return np.zeros(int(SAMPLE_RATE * milliseconds / 1000), dtype=np.float32)


def write_wave(path: str, samples: np.ndarray) -> None:
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm.tobytes())


def pick_speaker(voice: str) -> str:
    if voice == "random":
        choices = [name for name in _speakers if name != "random"] or _speakers or [DEFAULT_VOICE]
        return str(np.random.choice(choices))
    return voice if voice in _speakers else DEFAULT_VOICE


def handle_synth(request: dict) -> dict:
    text = str(request.get("text") or "")
    voice = str(request.get("voice") or DEFAULT_VOICE)
    out = str(request.get("out") or "")
    if not out:
        return {"ok": False, "error": "missing output path"}
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT]
    if text.strip() == "":
        return {"ok": False, "error": "nothing to speak"}
    # 70-130 is the range Silero's prosody rate handles well; 100 is its own pace.
    rate_percent = max(70, min(130, int(float(request.get("speed") or 100))))
    pause_scale = max(0.3, min(2.5, float(request.get("pauses") or 1.0)))
    started = time.time()
    audio = synthesize(text, pick_speaker(voice), pause_scale, rate_percent)
    if audio.size == 0:
        return {"ok": False, "error": "nothing to speak"}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    write_wave(out, audio)
    return {
        "ok": True,
        "out": out,
        "model": _model_name,
        "speed": rate_percent,
        "pauses": pause_scale,
        "ms": int((time.time() - started) * 1000),
        "durationMs": int(audio.size / SAMPLE_RATE * 1000),
    }


KWS_SCORER = None


def load_kws():
    """Скорер имени: грузим по первому запросу, чтобы TTS не ждал понапрасну."""
    global KWS_SCORER
    if KWS_SCORER is not None:
        return KWS_SCORER
    kws_dir = os.environ.get("KWS_DIR") or os.path.join(os.path.dirname(HERE), "..", "kws")
    kws_dir = os.path.abspath(kws_dir)
    if kws_dir not in sys.path:
        sys.path.insert(0, kws_dir)
    from kws_runtime import KwsScorer

    KWS_SCORER = KwsScorer()
    print(f"[kws] loaded {KWS_SCORER.path}", file=sys.stderr, flush=True)
    return KWS_SCORER


def handle_kws(request: dict) -> dict:
    import base64

    import numpy as np

    raw = base64.b64decode(request.get("pcm") or "")
    if len(raw) < 2:
        return {"ok": False, "error": "empty pcm"}
    pcm = np.frombuffer(raw, dtype=np.int16)
    score = load_kws().score(pcm)
    return {"ok": True, "score": round(float(score), 4)}

def main() -> int:
    try:
        # Requests are UTF-8 JSON regardless of the Windows console codepage.
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - older interpreters may not support reconfigure
        pass
    torch.set_num_threads(max(1, min(4, (os.cpu_count() or 2) - 1)))
    try:
        load_model()
    except Exception as error:  # noqa: BLE001 - report through the protocol
        print(f"[silero] failed to load model: {error}", file=sys.stderr, flush=True)
        emit({"ok": False, "fatal": str(error)})
        return 1

    emit({"ok": True, "ready": True, "voices": _speakers, "model": _model_name, "ssml": _ssml})
    # Английскую модель грузим здесь же, в главном потоке: TorchScript-модель,
    # созданная в другом потоке, потом выполняется в разы медленнее (RTF ~2
    # вместо 0.15), поэтому фоновая загрузка экономила старт, но тормозила речь.
    if resolve_en_model_path() is not None:
        try:
            load_model_en()
        except Exception as error:  # noqa: BLE001 - без англ. модели просто транслитерация
            print(f"[silero] english model failed: {error}", file=sys.stderr, flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            emit({"ok": False, "error": f"bad request: {error}"})
            continue
        command = request.get("cmd", "synth")
        request_id = request.get("id")
        try:
            if command == "ping":
                reply = {"ok": True, "ready": True, "voices": _speakers, "model": _model_name, "ssml": _ssml}
            elif command == "kws":
                reply = handle_kws(request)
            elif command == "shutdown":
                emit({"id": request_id, "ok": True})
                return 0
            else:
                reply = handle_synth(request)
        except Exception as error:  # noqa: BLE001 - one failed answer must not kill the worker
            trace = traceback.format_exc()
            print(f"[silero] synth failed: {trace}", file=sys.stderr, flush=True)
            last_line = trace.strip().splitlines()[-1] if trace.strip() else ''
            reply = {"ok": False, "error": f"{type(error).__name__}: {error} | {last_line} | {trace.strip()[-700:]}"}
        reply["id"] = request_id
        emit(reply)
    return 0


if __name__ == "__main__":
    sys.exit(main())
