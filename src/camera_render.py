"""Applies a per-frame camera to a clip: crops a float box from each frame (sub-pixel, bicubic) and scales it to the
output size. Usage: camera_render.py <in.mp4> <out.mp4> <camera.json> — camera.json is {"src":[w,h],"out":[w,h],
"fps":60,"boxes":[[x,y,w,h],...]} in source pixels, one box per output frame."""
import json, subprocess, sys
from PIL import Image

src, dst, cam_path = sys.argv[1:4]
cam = json.load(open(cam_path))
SW, SH = cam["src"]; OW, OH = cam["out"]; boxes = cam["boxes"]
dec = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen(["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{OW}x{OH}", "-r", str(cam["fps"]), "-i", "-",
                        "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst], stdin=subprocess.PIPE)
size = SW * SH * 3
i = 0
while True:
    buf = dec.stdout.read(size)
    if len(buf) < size:
        break
    x, y, w, h = boxes[min(i, len(boxes) - 1)]
    frame = Image.frombuffer("RGB", (SW, SH), buf, "raw", "RGB", 0, 1)
    out = frame.transform((OW, OH), Image.Transform.EXTENT, (x, y, x + w, y + h), resample=Image.Resampling.BICUBIC)
    enc.stdin.write(out.tobytes())
    i += 1
enc.stdin.close(); e = enc.wait(); d = dec.wait()
# A missing or cut-short source (e.g. the disk filled while encoding full.mp4) must fail, not leave a short clip.
if d != 0 or e != 0 or i < 0.9 * len(boxes):
    sys.exit(f"camera_render: rendered {i} of {len(boxes)} frames from {src} (decoder exit {d}, encoder exit {e})")
print(i)
