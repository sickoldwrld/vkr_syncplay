#!/usr/bin/env python3
"""Генератор клик-трека для измерения рассинхрона SyncPlay-клиентов.

Каждый клик — короткий импульс с мгновенной атакой: резкий передний фронт
хорошо виден в Audacity и точно ловится кросс-корреляцией. Проигрывается
через SyncPlay на обеих машинах, обе дорожки пишутся в UMC22, сдвиг между
левым и правым каналами = рассинхрон воспроизведения.
"""
import argparse
import wave

import numpy as np


def make_click(sr: int, freq: float, dur_ms: float) -> np.ndarray:
    """Один клик: тон с мгновенной атакой и экспоненциальным затуханием."""
    n = int(sr * dur_ms / 1000.0)
    t = np.arange(n) / sr
    tone = np.sin(2 * np.pi * freq * t)
    # Мгновенная атака (фронт = первый сэмпл) + быстрый спад -> резкий пик.
    env = np.exp(-t / (dur_ms / 1000.0 / 4.0))
    return (tone * env).astype(np.float32)


def build(sr, total_s, interval_s, freq, dur_ms, lead_s):
    total = np.zeros(int(sr * total_s), dtype=np.float32)
    click = make_click(sr, freq, dur_ms)
    first = int(sr * lead_s)  # тишина в начале, чтобы поймать старт
    pos = first
    step = int(sr * interval_s)
    count = 0
    while pos + len(click) <= len(total):
        total[pos:pos + len(click)] += click
        pos += step
        count += 1
    return total, count


def main():
    p = argparse.ArgumentParser(description="Клик-трек для измерения рассинхрона")
    p.add_argument("-o", "--out", default="clicktrack.wav")
    p.add_argument("--sr", type=int, default=48000, help="частота дискретизации")
    p.add_argument("--duration", type=float, default=60.0, help="длина трека, с")
    p.add_argument("--interval", type=float, default=2.0, help="период кликов, с")
    p.add_argument("--freq", type=float, default=3000.0, help="частота клика, Гц")
    p.add_argument("--click-ms", type=float, default=4.0, help="длина клика, мс")
    p.add_argument("--lead", type=float, default=1.0, help="тишина в начале, с")
    p.add_argument("--gain", type=float, default=0.8, help="амплитуда (0..1)")
    a = p.parse_args()

    sig, count = build(a.sr, a.duration, a.interval, a.freq, a.click_ms, a.lead)
    sig = np.clip(sig * a.gain, -1.0, 1.0)
    pcm = (sig * 32767).astype(np.int16)

    with wave.open(a.out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(a.sr)
        w.writeframes(pcm.tobytes())

    print(f"{a.out}: {count} кликов, {a.duration:.0f}с, {a.sr} Гц, "
          f"клик {a.freq:.0f}Гц/{a.click_ms:.0f}мс каждые {a.interval:.0f}с")


if __name__ == "__main__":
    main()
