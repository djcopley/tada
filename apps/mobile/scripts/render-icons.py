"""Render the tada mark with true alpha. No image libs available (no sharp/PIL/
cairosvg), and qlmanage flattens SVG onto white -- so rasterize analytically.

Geometry mirrors assets/logo.svg in a 1024x1024 design space: a rounded ink
tile, six orange capsule rays from the centre, and a hub circle. Coverage comes
from signed distances, so edges antialias and transparent stays transparent.
"""
import math, struct, zlib

INK = (0x1B, 0x16, 0x13)
ORANGE = (0xEF, 0x8B, 0x3F)
WHITE = (0xFF, 0xFF, 0xFF)
S = 1024.0            # design space
TILE_R = 228.0        # tile corner radius
RAY_LEN, RAY_R, HUB_R = 330.0, 75.0, 150.0
SECTOR = math.pi / 3  # 60deg -> 6-fold symmetry
ROT = math.pi / 2     # put a ray straight up, matching the wordmark glyph

def star_sd(x, y):
    """Signed distance to the asterisk. Fold into one 60deg sector so a single
    capsule evaluation covers all six rays."""
    r = math.hypot(x, y)
    if r > 1e-9:
        a = math.atan2(y, x) - ROT
        a -= SECTOR * round(a / SECTOR)
        x, y = r * math.cos(a), r * math.sin(a)
    # capsule from (0,0) to (RAY_LEN,0)
    h = min(max(x, 0.0), RAY_LEN)
    ray = math.hypot(x - h, y) - RAY_R
    return min(ray, r - HUB_R)

def tile_sd(x, y):
    """Signed distance to the rounded tile, centred on the origin."""
    b = S / 2 - TILE_R
    qx, qy = abs(x) - b, abs(y) - b
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - TILE_R

def render(size, *, tile, opaque=False, star_color=ORANGE, inset=1.0, bare=False):
    """tile: draw the ink tile behind the star. opaque: no alpha channel (iOS).
    bare: solid ink fill only, no star. inset: scale the mark (adaptive safe zone)."""
    px = S / size              # design units per output pixel
    aa = px * 0.5              # half-pixel AA band
    rows = []
    for py in range(size):
        y = (py + 0.5) * px - S / 2
        row = bytearray()
        for pxi in range(size):
            x = (pxi + 0.5) * px - S / 2
            # tile alpha: full square when opaque, rounded otherwise
            if opaque:
                ta = 1.0
            elif tile:
                ta = min(max(0.5 - tile_sd(x, y) / (2 * aa), 0.0), 1.0)
            else:
                ta = 0.0
            sa = 0.0
            if not bare:
                sx, sy = x / inset, y / inset
                sa = min(max(0.5 - star_sd(sx, sy) / (2 * aa / inset), 0.0), 1.0)
            a = max(ta, sa)
            if a <= 0.0:
                row += b'\x00\x00\x00\x00' if not opaque else bytes(INK)
                continue
            # star over ink, then the whole thing over transparency
            k = sa / a if a else 0.0
            rgb = tuple(round(INK[i] + (star_color[i] - INK[i]) * k) for i in range(3))
            row += bytes(rgb) if opaque else bytes(rgb) + bytes((round(a * 255),))
        rows.append(b'\x00' + bytes(row))
    return png(size, b''.join(rows), opaque)

def png(size, raw, opaque):
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2 if opaque else 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def ico(pngs):
    """Multi-size ICO with PNG-compressed 32-bit entries (real alpha)."""
    head = struct.pack('<HHH', 0, 1, len(pngs))
    off = 6 + 16 * len(pngs)
    dirs, blob = b'', b''
    for size, data in pngs:
        dirs += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), off)
        blob += data
        off += len(data)
    return head + dirs + blob


if __name__ == '__main__':
    import pathlib
    here = pathlib.Path(__file__).resolve().parent.parent
    a = here / 'assets'
    # iOS/general icon: full-bleed and opaque -- iOS applies its own mask, and
    # an alpha channel here is rejected by App Store validation.
    (a / 'icon.png').write_bytes(render(1024, tile=True, opaque=True))
    # Web favicon source (rounded, transparent corners). Expo resizes this to
    # the 16/32/48 entries of the generated favicon.ico and preserves alpha, so
    # the corners stay transparent -- keep the alpha channel intact here.
    (a / 'favicon.png').write_bytes(render(256, tile=True))
    # Android adaptive layers: the foreground must be transparent outside the
    # mark, and sits in the 66% safe zone the launcher may crop to.
    (a / 'android-icon-foreground.png').write_bytes(render(1024, tile=False, inset=0.72))
    (a / 'android-icon-monochrome.png').write_bytes(
        render(1024, tile=False, inset=0.72, star_color=WHITE))
    (a / 'android-icon-background.png').write_bytes(render(1024, tile=False, opaque=True, bare=True))
    print('wrote icon.png, favicon.png, android-icon-*.png')
