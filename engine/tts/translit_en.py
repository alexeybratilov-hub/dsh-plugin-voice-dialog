"""Английские слова — кириллицей по произношению, чтобы читал русский голос.

Идея: один голос (Silero ru) читает и русский, и английский текст. Английские
слова переводим не побуквенно, а по фонемам из CMU Pronouncing Dictionary
(ARPAbet), затем раскладываем фонемы в русские буквы. Так «Hello world»
становится «хэлоу уорлд» — узнаваемо, как читает Алиса.
"""
from __future__ import annotations

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DICT_CANDIDATES = (
    os.path.join(os.path.dirname(HERE), "models", "english", "cmudict.dict"),
)

VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}

# ARPAbet → кириллица. Для гласных отдельно обрабатываем безударную «AH».
PHONEMES = {
    "AA": "а", "AE": "э", "AH": "а", "AO": "о", "AW": "ау", "AY": "ай",
    "EH": "э", "ER": "эр", "EY": "эй", "IH": "и", "IY": "и", "OW": "оу",
    "OY": "ой", "UH": "у", "UW": "у",
    "B": "б", "CH": "ч", "D": "д", "DH": "з", "F": "ф", "G": "г", "HH": "х",
    "JH": "дж", "K": "к", "L": "л", "M": "м", "N": "н", "NG": "нг", "P": "п",
    "R": "р", "S": "с", "SH": "ш", "T": "т", "TH": "с", "V": "в", "W": "у",
    "Y": "й", "Z": "з", "ZH": "ж",
}

# Слова, где правила дают неверный или неудобный результат.
OVERRIDES = {
    "the": "зэ", "a": "э", "i": "ай", "you": "ю", "to": "ту", "of": "ов",
    "and": "энд", "is": "из", "are": "ар", "was": "уоз", "were": "уэар",
    "how": "хау", "what": "уот", "where": "уэар", "who": "ху", "why": "уай",
    "one": "уан", "two": "ту", "three": "сри", "four": "фо", "five": "файв",
    "hello": "хэлоу", "world": "уорлд", "google": "гугл", "windows": "уиндоус",
    "linux": "линукс", "python": "пайтон", "javascript": "джаваскрипт",
    "browser": "браузер", "server": "сёрвер", "client": "клиент",
    "chat": "чат", "api": "эй-пи-ай", "gpt": "джи-пи-ти", "dsn": "ди-эс-эн",
    "dsh": "ди-эс-эйч", "ok": "окей", "okay": "окей", "error": "эррор",
}

LETTER_FALLBACK = {
    "a": "а", "b": "б", "c": "к", "d": "д", "e": "е", "f": "ф", "g": "г",
    "h": "х", "i": "и", "j": "дж", "k": "к", "l": "л", "m": "м", "n": "н",
    "o": "о", "p": "п", "q": "к", "r": "р", "s": "с", "t": "т", "u": "у",
    "v": "в", "w": "у", "x": "кс", "y": "и", "z": "з",
}

DIGRAPHS = (
    ("sch", "ск"), ("tch", "ч"), ("ough", "оу"), ("tion", "шн"), ("sion", "жн"),
    ("ph", "ф"), ("sh", "ш"), ("ch", "ч"), ("th", "с"), ("wh", "у"), ("ck", "к"),
    ("oo", "у"), ("ee", "и"), ("ea", "и"), ("ai", "эй"), ("ay", "эй"),
    ("ou", "ау"), ("ow", "оу"), ("oa", "оу"), ("oi", "ой"), ("oy", "ой"),
    ("er", "ер"), ("ir", "ер"), ("ur", "ер"), ("ar", "ар"), ("or", "ор"),
    ("igh", "ай"), ("qu", "кв"), ("ng", "нг"),
)

_dict: dict[str, str] | None = None


def resolve_dict_path() -> str | None:
    for candidate in DICT_CANDIDATES:
        if os.path.exists(candidate):
            return candidate
    return None


def load_dict() -> dict[str, str]:
    """Читаем CMU-словарь один раз: word -> первая строка фонем."""
    global _dict
    if _dict is not None:
        return _dict
    path = resolve_dict_path()
    table: dict[str, str] = {}
    if path:
        with open(path, encoding="utf-8", errors="replace") as handle:
            for line in handle:
                parts = line.split()
                if len(parts) < 2 or parts[0].startswith(";;;"):
                    continue
                word = re.sub(r"\(\d+\)$", "", parts[0].lower())
                if word not in table:
                    table[word] = " ".join(parts[1:])
    _dict = table
    return _dict


def _aa_sound(spelling: str) -> str:
    """AA в «hot/dog/stop» звучит как «о», в «car/star/father» — как «а»."""
    if "ar" in spelling or "al" in spelling:
        return "а"
    if "o" in spelling:
        return "о"
    return "а"


def phonemes_to_cyrillic(phonemes: str, spelling: str = "") -> str:
    items = [raw for raw in phonemes.split() if raw]
    bases = [raw[:-1] if raw[-1:].isdigit() else raw for raw in items]
    out: list[str] = []
    aa = _aa_sound(spelling)
    for index, raw in enumerate(items):
        stress = raw[-1] if raw[-1:].isdigit() else ""
        base = bases[index]
        if base == "AH":
            out.append("э" if stress == "0" else "а")
            continue
        if base == "AA":
            out.append(aa)
            continue
        # S между гласными по-русски озвончается: «сэнвис» → «сэрвис».
        if base == "S" and 0 < index < len(items) - 1 and bases[index - 1] in VOWELS and bases[index + 1] in VOWELS:
            out.append("з")
            continue
        if base == "TH" and 0 < index < len(items) - 1 and bases[index - 1] in VOWELS and bases[index + 1] in VOWELS:
            out.append("з")
            continue
        out.append(PHONEMES.get(base, ""))
    return "".join(out)


def word_to_cyrillic(word: str) -> str:
    lowered = word.lower()
    if lowered in OVERRIDES:
        return OVERRIDES[lowered]
    table = load_dict()
    phonemes = table.get(lowered)
    if phonemes:
        return phonemes_to_cyrillic(phonemes, lowered)
    # Незнакомое слово: правила по буквосочетаниям, затем по буквам.
    result = ""
    rest = lowered
    while rest:
        for pattern, sound in DIGRAPHS:
            if rest.startswith(pattern):
                result += sound
                rest = rest[len(pattern):]
                break
        else:
            result += LETTER_FALLBACK.get(rest[0], "")
            rest = rest[1:]
    return result


def text_to_cyrillic(text: str) -> str:
    """Английский текст → кириллица, пунктуация и пробелы сохраняются."""
    pieces: list[str] = []
    for token in re.split(r"([A-Za-z][A-Za-z'’-]*)", text):
        if re.fullmatch(r"[A-Za-z][A-Za-z'’-]*", token or ""):
            cleaned = token.replace("'", "").replace("’", "").replace("-", " ")
            pieces.append(" ".join(word_to_cyrillic(part) for part in cleaned.split()))
        else:
            pieces.append(token)
    return "".join(pieces)
