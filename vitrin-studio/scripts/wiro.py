#!/usr/bin/env python3
"""Wiro AI runner — CLAUDE.md'deki doğrulanmış sözleşme.
kullanım: wiro.py <model> <out.png> "<prompt>" [size] [quality] [background]
  model: gpt-image-1-5 (alpha) | gpt-image-2
"""
import hashlib, hmac, json, os, pathlib, subprocess, sys, time

def env(name):
    # Önce ortam değişkeni, yoksa vitrin-studio/.env.
    if os.environ.get(name):
        return os.environ[name]
    dotenv = pathlib.Path(__file__).resolve().parent.parent / ".env"
    if dotenv.exists():
        for line in dotenv.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    sys.exit(f"{name} yok: vitrin-studio/.env içine ekle")

KEY = env("WIRO_API_KEY")
SECRET = env("WIRO_API_SECRET")

def headers():
    nonce = str(int(time.time()))
    sig = hmac.new(KEY.encode(), (SECRET + nonce).encode(), hashlib.sha256).hexdigest()
    return ["-H", f"x-api-key: {KEY}", "-H", f"x-nonce: {nonce}", "-H", f"x-signature: {sig}",
            "-H", "Content-Type: application/json"]

def post(url, payload, tries=8):
    # Wiro'nun kenarı ara ara 520 döndürüyor (Cloudflare origin hatası) — JSON
    # gelmezse artan bekleme ile yeniden dene; ilk hatada işi düşürme.
    last = ""
    for i in range(tries):
        out = subprocess.run(["curl", "-s", "-X", "POST", url, *headers(), "-d", json.dumps(payload)],
                             capture_output=True, text=True, timeout=120).stdout
        try:
            return json.loads(out)
        except Exception:
            last = out
            time.sleep(3 + i * 3)
    raise SystemExit(f"JSON değil: {last[:400]}")

def run(model, outpath, prompt, size="2:3", quality="medium", background="transparent"):
    payload = {"prompt": prompt, "quality": quality, "outputFormat": "png",
               "samples": 1, "moderation": "low"}
    if model == "gpt-image-2-custom":
        # size = "2400x1600" gibi piksel
        w, h = size.lower().split("x")
        payload["width"] = int(w); payload["height"] = int(h)
    elif model == "gpt-image-2":
        payload["ratio"] = size; payload["resolution"] = background or "2K"
    else:
        payload["size"] = size
        payload["background"] = background
    r = post(f"https://api.wiro.ai/v1/Run/openai/{model}", payload)
    tok = r.get("socketaccesstoken")
    if not tok:
        raise SystemExit(f"Run hatası: {r}")
    print(f"task {r.get('taskid')} başladı", file=sys.stderr)
    for _ in range(120):
        time.sleep(4)
        d = post("https://api.wiro.ai/v1/Task/Detail", {"tasktoken": tok})
        tl = (d.get("tasklist") or [{}])[0]
        st = tl.get("status")
        if st == "task_postprocess_end":
            if str(tl.get("pexit")) != "0":
                raise SystemExit(f"task hata: {json.dumps(tl)[:600]}")
            url = tl["outputs"][0]["url"]
            subprocess.run(["curl", "-s", "-L", "-o", outpath, url], check=True)
            print(outpath)
            return outpath
    raise SystemExit("zaman aşımı")

if __name__ == "__main__":
    a = sys.argv[1:]
    run(a[0], a[1], a[2], *(a[3:6]))
