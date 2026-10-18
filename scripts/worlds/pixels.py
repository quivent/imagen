"""Numerical image IO and explicit display-RGB comparison; no image display."""
import struct
import zlib
from pathlib import Path
import numpy as np


def read_png(path):
    raw = Path(path).read_bytes()
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Expected PNG')
    offset = 8
    data = bytearray()
    palette = None
    while offset < len(raw):
        size = struct.unpack_from('!I', raw, offset)[0]
        kind = raw[offset+4:offset+8]
        value = raw[offset+8:offset+8+size]
        if zlib.crc32(kind+value) & 0xffffffff != struct.unpack_from('!I', raw, offset+8+size)[0]:
            raise ValueError('PNG CRC mismatch')
        if kind == b'IHDR':
            width,height,depth,color,compression,filtering,interlace = struct.unpack('!2I5B',value)
            if depth != 8 or interlace or compression or filtering:
                raise ValueError('Only noninterlaced 8-bit PNG is supported')
            channels = {0:1,2:3,3:1,4:2,6:4}.get(color)
            if channels is None:
                raise ValueError('Unsupported PNG color type')
        elif kind == b'IDAT':
            data.extend(value)
        elif kind == b'PLTE':
            palette = np.frombuffer(value,dtype=np.uint8).reshape(-1,3)
        offset += size+12
    scan = zlib.decompress(data)
    stride = width*channels
    if len(scan) != height*(stride+1):
        raise ValueError('PNG scanline size mismatch')
    image = np.empty((height,stride),dtype=np.uint8)
    previous = np.zeros(stride,dtype=np.uint8)
    for y in range(height):
        start = y*(stride+1)
        mode = scan[start]
        row = np.frombuffer(scan[start+1:start+1+stride],dtype=np.uint8).copy()
        if mode == 1:
            for c in range(channels):
                row[c::channels] = np.cumsum(row[c::channels],dtype=np.uint64).astype(np.uint8)
        elif mode == 2:
            row = ((row.astype(np.uint16)+previous)%256).astype(np.uint8)
        elif mode in (3,4):
            for x in range(stride):
                left = int(row[x-channels]) if x>=channels else 0
                up = int(previous[x])
                corner = int(previous[x-channels]) if x>=channels else 0
                if mode == 3:
                    predictor = (left+up)//2
                else:
                    prediction = left+up-corner
                    distances = [abs(prediction-left),abs(prediction-up),abs(prediction-corner)]
                    predictor = [left,up,corner][distances.index(min(distances))]
                row[x] = (int(row[x])+predictor)%256
        elif mode != 0:
            raise ValueError('Invalid PNG filter')
        image[y] = row
        previous = row
    image = image.reshape(height,width,channels)
    if color == 3:
        return palette[image[:,:,0]]
    if channels < 3:
        return np.repeat(image[:,:,:1],3,axis=2)
    return image[:,:,:3].copy()


def write_png(path, image):
    image = np.asarray(image,dtype=np.uint8)
    height,width,channels = image.shape
    if channels not in (3,4):
        raise ValueError('RGB or RGBA expected')
    def chunk(kind,data):
        return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
    rows = b''.join(b'\0'+row.tobytes() for row in image)
    data = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',width,height,8,2 if channels==3 else 6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
    Path(path).write_bytes(data)


def resize_area(image, size):
    image = np.asarray(image)
    height,width = image.shape[:2]
    if height%size or width%size:
        raise ValueError('Area resize requires dimensions divisible by target size')
    return image.astype(np.float64).reshape(size,height//size,size,width//size,3).mean(axis=(1,3))


def components(source, candidate):
    source = np.asarray(source,dtype=np.float64)/255.
    candidate = np.asarray(candidate,dtype=np.float64)/255.
    if source.shape != candidate.shape or source.shape[0] != source.shape[1]:
        raise ValueError('Equal square frames required')
    coarse = float(np.abs(resize_area(source,16)-resize_area(candidate,16)).mean())
    fine = float(np.abs(resize_area(source,64)-resize_area(candidate,64)).mean())
    def edges(image):
        gray = resize_area(image,64) @ np.array([.2126,.7152,.0722])
        dy,dx = np.gradient(gray)
        return np.sqrt(dx*dx+dy*dy)
    a,b = edges(source),edges(candidate)
    scale = max(float(np.percentile(a,95)),.02)
    edge = float(np.abs(np.clip(a/scale,0,1)-np.clip(b/scale,0,1)).mean())
    total = .6*coarse+.25*edge+.15*fine
    return {'coarse_rgb_l1':coarse,'edge_magnitude_l1':edge,'fine_rgb_l1':fine,'weighted_total':total}


def literal_components(source, candidate):
    """Version2: literal pixel coverage, local structure and full-frame RGB error."""
    source = np.asarray(source, dtype=np.float64)/255.
    candidate = np.asarray(candidate, dtype=np.float64)/255.
    if source.shape != candidate.shape or source.ndim != 3 or source.shape[2] != 3 or source.shape[0] != source.shape[1] or source.shape[0] % 64:
        raise ValueError('Equal RGB square frames divisible by 64 required')
    if not np.isfinite(source).all() or not np.isfinite(candidate).all():
        raise ValueError('Finite image values required')
    error = np.sqrt(np.mean((source-candidate)**2, axis=2))
    mismatch = float(np.mean(error > .1))
    rms = float(error.mean())
    luminance = np.array([.2126, .7152, .0722])
    side = source.shape[0]//64
    def moments(image):
        blocks = (image @ luminance).reshape(64, side, 64, side).transpose(0, 2, 1, 3).reshape(64, 64, -1)
        mean = blocks.mean(axis=2)
        centered = blocks-mean[:, :, None]
        return mean, centered, (centered**2).mean(axis=2)
    ma, ca, va = moments(source)
    mb, cb, vb = moments(candidate)
    covariance = (ca*cb).mean(axis=2)
    ssim = ((2*ma*mb+.01**2)*(2*covariance+.03**2))/((ma**2+mb**2+.01**2)*(va+vb+.03**2))
    structure = float(np.clip(1-ssim, 0, 1).mean())
    total = .5*mismatch+.35*structure+.15*rms
    return {'pixel_mismatch_10pct': mismatch, 'local_structure_delta': structure, 'full_rgb_rms': rms, 'weighted_total': total}
