"""Offline existing-media admission only. Never renders PDF/SVG or follows links."""
import io
import json
import sys
import warnings


def validate(data, mime):
    if not 0 < len(data) <= 50 * 1024 * 1024:
        raise ValueError('size')
    if mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp'):
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = 100_000_000
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        expected = {'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WEBP'}[mime]
        with Image.open(io.BytesIO(data)) as image:
            if image.format != expected:
                raise ValueError('format')
            image.verify()
        # Decode every frame, preserving the original bytes (no lossy conversion).
        with Image.open(io.BytesIO(data)) as image:
            frames = getattr(image, 'n_frames', 1)
            if frames > 1000:
                raise ValueError('frames')
            pixels = 0
            for frame in range(frames):
                image.seek(frame)
                width, height = image.size
                pixels += width * height
                if min(width, height) < 1 or max(width, height) > 32768 or pixels > 250_000_000:
                    raise ValueError('pixels')
                image.load()
        return 'inline'
    if mime == 'application/pdf':
        import fitz
        if not data.startswith(b'%PDF-') or b'%%EOF' not in data[-1024:]:
            raise ValueError('pdf framing')
        with fitz.open(stream=data, filetype='pdf') as document:
            if document.needs_pass or document.is_repaired or not 0 < document.page_count <= 10000:
                raise ValueError('pdf structure')
            for page in document:
                if page.rect.is_empty or page.rect.is_infinite:
                    raise ValueError('pdf page')
        return 'download'
    if mime == 'image/svg+xml':
        from defusedxml import ElementTree
        root = ElementTree.fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
        if root.tag not in ('svg', '{http://www.w3.org/2000/svg}svg'):
            raise ValueError('svg root')
        # Scripts/references are never executed: these bytes are download-only,
        # stored as octet-stream, never inserted into HTML or an image element.
        return 'download'
    if mime in ('video/mp4', 'video/quicktime'):
        import av
        if len(data) < 12 or data[4:8] != b'ftyp':
            raise ValueError('video container')
        with av.open(io.BytesIO(data), format='mov') as video:
            if not video.streams.video:
                raise ValueError('video stream')
            # Parse the container and all local packets; decode one video frame.
            # Download-only admission does not certify full playback of all frames.
            decoded = False
            for packet in video.demux():
                if packet.stream.type == 'video' and not decoded:
                    decoded = bool(packet.decode())
            if not decoded:
                raise ValueError('video decode')
        return 'download'
    raise ValueError('unsupported')


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(50 * 1024 * 1024 + 1)
        mode = validate(raw, sys.argv[1])
        print(json.dumps({'ok': True, 'display': mode}))
    except Exception:
        print('{"ok":false,"reason":"existing_media_bytes_held"}')
        sys.exit(2)
