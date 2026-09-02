#!/usr/bin/env python3
"""Transcribe un video con faster-whisper y escribe transcript.json.

Timestamps por palabra, en coordenadas del video ORIGINAL.
Reporta "PROGRESO <0..1>" por stderr para que el server muestre avance.

En Windows registra las DLL de CUDA que instala pip (nvidia-cublas-cu12,
nvidia-cudnn-cu12), que no quedan en el PATH. Si la GPU falla de todas
formas, reintenta en CPU en vez de abortar el ingest.
"""
import argparse, json, os, sys

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")


def registrar_dlls_cuda():
    """Anade al buscador de DLL las carpetas bin de los paquetes nvidia-*-cu12."""
    if sys.platform != "win32":
        return []
    try:
        import nvidia
    except ImportError:
        return []
    encontradas = []
    for raiz in nvidia.__path__:
        for paquete in sorted(os.listdir(raiz)):
            binario = os.path.join(raiz, paquete, "bin")
            if os.path.isdir(binario):
                try:
                    os.add_dll_directory(binario)
                    os.environ["PATH"] = binario + os.pathsep + os.environ.get("PATH", "")
                    encontradas.append(paquete)
                except OSError:
                    pass
    return encontradas


def transcribir(WhisperModel, entrada, idioma, modelo, device, compute):
    m = WhisperModel(modelo, device=device, compute_type=compute)
    segmentos_it, info = m.transcribe(
        entrada,
        language=None if idioma in ("", "auto") else idioma,
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
    return info, segmentos


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

    dlls = registrar_dlls_cuda()
    if dlls:
        print(f"[whisper] DLL CUDA registradas: {', '.join(dlls)}", file=sys.stderr)

    device = a.device
    if device == "auto":
        try:
            import ctranslate2
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        except Exception:
            device = "cpu"

    intentos = [(device, "float16" if device == "cuda" else "int8")]
    if device == "cuda":
        intentos.append(("cpu", "int8"))   # respaldo si faltan cuBLAS o cuDNN

    ultimo = None
    for dev, compute in intentos:
        try:
            print(f"[whisper] modelo={a.modelo} device={dev} compute={compute}", file=sys.stderr, flush=True)
            info, segmentos = transcribir(WhisperModel, a.entrada, a.idioma, a.modelo, dev, compute)
            break
        except Exception as e:
            ultimo = e
            print(f"[whisper] fallo en {dev}: {e}", file=sys.stderr, flush=True)
            if dev == "cpu":
                sys.exit(
                    f"La transcripcion fallo tambien en CPU: {e}"
                )
            print("[whisper] reintentando en CPU (mas lento)...", file=sys.stderr, flush=True)
    else:
        sys.exit(f"La transcripcion fallo: {ultimo}")

    os.makedirs(os.path.dirname(os.path.abspath(a.salida)), exist_ok=True)
    with open(a.salida, "w", encoding="utf8") as f:
        json.dump({
            "idioma": info.language,
            "modelo": a.modelo,
            "device": dev,
            "duracion": round(info.duration or 0, 3),
            "segmentos": segmentos,
        }, f, ensure_ascii=False, indent=2)
    print(f"[whisper] {len(segmentos)} segmentos en {dev} -> {a.salida}", file=sys.stderr)


if __name__ == "__main__":
    main()
