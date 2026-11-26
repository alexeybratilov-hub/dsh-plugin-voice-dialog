"""Цифры в тексте — словами по-русски, чтобы голос их проговаривал.

Русская Silero-модель цифры не читает: блок вида «123» или «в 2026 году»
превращался в пустоту (0 секунд звука). Поэтому числа заменяем словами до
синтеза: «15 задач» → «пятнадцать задач», «1,5» → «одна целая пять десятых»
(упрощённо: «один точка пять»), «-3» → «минус три».
"""
from __future__ import annotations

import re

UNITS_M = ("ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять")
UNITS_F = ("ноль", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять")
TEENS = (
    "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
    "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать",
)
TENS = ("", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто")
HUNDREDS = ("", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот")

SCALES = (
    (None, None, None),
    ("тысяча", "тысячи", "тысяч"),
    ("миллион", "миллиона", "миллионов"),
    ("миллиард", "миллиарда", "миллиардов"),
    ("триллион", "триллиона", "триллионов"),
)


def _plural(index: int, forms: tuple[str, str, str]) -> str:
    """Русская форма для числа: 1 тысяча, 2 тысячи, 5 тысяч."""
    if index is None:
        return ""
    last_two = index % 100
    last = index % 10
    if 11 <= last_two <= 14:
        return forms[2]
    if last == 1:
        return forms[0]
    if 2 <= last <= 4:
        return forms[1]
    return forms[2]


def _basic(index: int, feminine: bool = False) -> str:
    """Число 0..999 словами."""
    if index == 0:
        return UNITS_M[0]
    parts: list[str] = []
    hundreds, rest = divmod(index, 100)
    if hundreds:
        parts.append(HUNDREDS[hundreds])
    if 10 <= rest <= 19:
        parts.append(TEENS[rest - 10])
        return " ".join(parts)
    tens, units = divmod(rest, 10)
    if tens:
        parts.append(TENS[tens])
    if units:
        parts.append((UNITS_F if feminine else UNITS_M)[units])
    return " ".join(parts)


def number_to_words(value: int) -> str:
    """Целое число словами: 1234567 → «один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь»."""
    if value == 0:
        return UNITS_M[0]
    sign = ""
    if value < 0:
        sign = "минус "
        value = -value
    groups: list[tuple[int, int]] = []
    while value > 0:
        groups.append((value % 1000, len(groups)))
        value //= 1000
    parts: list[str] = []
    for index in range(len(groups) - 1, -1, -1):
        chunk, power = groups[index]
        if chunk == 0:
            continue
        # Тысячи — женского рода: «одна тысяча», «две тысячи».
        words = _basic(chunk, feminine=power == 1)
        parts.append(words)
        if power < len(SCALES):
            scale = SCALES[power]
            if scale[0]:
                parts.append(_plural(chunk, scale))
    return sign + " ".join(word for word in parts if word)


def _decimal_to_words(raw: str) -> str:
    """«1.42» → «один точка четыре два»: точкой читаем только цифры."""
    whole, _, fraction = raw.partition(".")
    words = number_to_words(int(whole)) if whole else "ноль"
    digits = " ".join(UNITS_M[int(digit)] for digit in fraction if digit.isdigit())
    return f"{words} точка {digits}".strip()


TIME_PATTERN = re.compile(r"\b(\d{1,2}):(\d{2})\b")
THOUSANDS_PATTERN = re.compile(r"(?<![\d.,])\d{1,3}(?:[ \u00a0]\d{3})+(?![\d.,])")
VERSION_PATTERN = re.compile(r"(?<![\d.,])\d+(?:[.,]\d+){2,}(?![\d.,])")
DECIMAL_PATTERN = re.compile(r"(?<![\d.,])\d+[.,]\d+(?![\d.,])")
NUMBER_PATTERN = re.compile(r"-?\d+")


def _digits_words(raw: str) -> str:
    return " ".join(UNITS_M[int(digit)] for digit in raw if digit.isdigit())


def replace_numbers(text: str) -> str:
    """Заменить все числа в тексте словами (время, версии, дроби, тысячи)."""
    if not text:
        return text

    def convert_time(match: re.Match[str]) -> str:
        hours = int(match.group(1))
        minutes = int(match.group(2))
        if minutes == 0:
            return f"{number_to_words(hours)} ноль ноль"
        return f"{number_to_words(hours)} {number_to_words(minutes)}"

    def convert_version(match: re.Match[str]) -> str:
        parts = re.split(r"[.,]", match.group(0))
        return " точка ".join(_digits_words(part) for part in parts)

    def convert_decimal(match: re.Match[str]) -> str:
        whole, fraction = re.split(r"[.,]", match.group(0))
        return f"{number_to_words(int(whole))} точка {_digits_words(fraction)}"

    def convert_thousands(match: re.Match[str]) -> str:
        raw = re.sub(r"[ \u00a0]", "", match.group(0))
        return number_to_words(int(raw))

    def convert(match: re.Match[str]) -> str:
        raw = match.group(0)
        negative = raw.startswith("-")
        if negative:
            raw = raw[1:]
        # Ведущие нули («007») читаем по цифрам, как код.
        if len(raw) > 1 and raw[0] == "0":
            words = _digits_words(raw)
        else:
            words = number_to_words(int(raw))
        return ("минус " + words) if negative else words

    result = TIME_PATTERN.sub(convert_time, text)
    result = THOUSANDS_PATTERN.sub(convert_thousands, result)
    result = VERSION_PATTERN.sub(convert_version, result)
    result = DECIMAL_PATTERN.sub(convert_decimal, result)
    return NUMBER_PATTERN.sub(convert, result)