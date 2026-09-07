"""Offline comment-only extension. Existing brief/new-upload limits are unchanged."""
import importlib.util
import io
import json
import pathlib
import sys

spec = importlib.util.spec_from_file_location('brief_media', pathlib.Path(__file__).with_name('native-brief-media-validate.py'))
brief = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brief)  # existing network/process denial hooks

def validate(data, mime):
    limit = 100 * 1024 * 1024 if mime in ('video/mp4', 'video/quicktime') else 50 * 1024 * 1024
    if not 0 < len(data) <= limit:
        raise ValueError('size')
    if mime == 'font/otf':
        from fontTools.ttLib import TTFont
        if data[:4] != b'OTTO':
            raise ValueError('otf signature')
        with TTFont(io.BytesIO(data), lazy=False, checkChecksums=2) as font:
            if not {'head', 'hhea', 'maxp', 'hmtx', 'cmap', 'name', 'post', 'CFF '}.issubset(font.keys()):
                raise ValueError('otf tables')
            for tag in font.keys():
                font[tag]  # force structural decoding, no rasterization or install
            if not 0 < len(font.getGlyphOrder()) <= 65535:
                raise ValueError('otf glyphs')
        return 'download'
    if mime in ('video/mp4', 'video/quicktime') and len(data) > 50 * 1024 * 1024:
        # Comment-only large-video path; same parser settings and I/O refusal.
        # Keep the frozen brief validator bytes/pins and its 50 MiB cap intact.
        import av
        if len(data) < 12 or data[4:8] != b'ftyp':
            raise ValueError('video container')
        with av.open(io.BytesIO(data), format='mov', io_open=brief.refuse_external_io,
                     options={'protocol_whitelist': '', 'enable_drefs': '0', 'use_absolute_path': '0'}) as video:
            if not video.streams.video:
                raise ValueError('video stream')
            decoded = False
            for packet in video.demux():
                if packet.stream.type == 'video' and not decoded:
                    decoded = bool(packet.decode())
            if not decoded:
                raise ValueError('video decode')
    else:
        brief.validate(data, mime)
    return 'download'

if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(100 * 1024 * 1024 + 1)
        print(json.dumps({'ok': True, 'display': validate(raw, sys.argv[1])}))
    except Exception:
        print('{"ok":false,"reason":"comment_media_bytes_held"}')
        sys.exit(2)
