#!/usr/bin/env python3
"""Transcribe un video con faster-whisper y escribe transcript.json.

Timestamps por palabra, en coordenadas del video ORIGINAL.
Reporta "PROGRESO <0..1>" por stderr para que el server muestre avance.
"""
import argparse, json, sys, os

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("entrada")
    ap.add_argument("salida")
    ap.add_argument("--modelo", default="medium")
    ap.add_argument("--device", default="auto")     # auto | cuda | cpu
    ap.add_argument("--idioma", default="es")
    a = ap.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("Falta faster-whisper. Instala:  pip install faster-whisper")

    device = a.device
    compute = "float16"
    if device == "auto":
        try:
            import ctranslate2
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            device = "cpu"
    if device == "cpu":
        compute = "int8"

    print(f"[whisper] modelo={a.modelo} device={device} compute={compute}", file=sys.stderr)
    modelo = WhisperModel(a.modelo, device=device, compute_type=compute)

    segmentos_it, info = modelo.transcribe(
        a.entrada,
        language=None if a.idioma in ("", "auto") else a.idioma,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=300),
    )

    total = info.duration or 1.0
    segmentos = []
    for s in segmentos_it:
        segmentos.append({
            "id": len(segmentos),
            "in": round(s.start, 3),
            "out": round(s.end, 3),
            "texto": s.text.strip(),
            "palabras": [
                {"p": w.word.strip(), "in": round(w.start, 3), "out": round(w.end, 3)}
                for w in (s.words or [])
            ],
        })
        print(f"PROGRESO {min(s.end / total, 1.0):.4f}", file=sys.stderr, flush=True)

    os.makedirs(os.path.dirname(os.path.abspath(a.salida)), exist_ok=True)
    with open(a.salida, "w", encoding="utf8") as f:
        json.dump({
            "idioma": info.language,
            "modelo": a.modelo,
            "device": device,
            "duracion": round(total, 3),
            "segmentos": segmentos,
        }, f, ensure_ascii=False, indent=2)
    print(f"[whisper] {len(segmentos)} segmentos -> {a.salida}", file=sys.stderr)

if __name__ == "__main__":
    main()
