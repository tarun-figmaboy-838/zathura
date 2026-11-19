"""Make the game's models (.glb) smaller without changing their shapes.

Blender writes every normal as three 32-bit floats. This stores them as three signed bytes (the
KHR_mesh_quantization extension, which three.js's GLTFLoader reads natively: no decoder to download),
and vertex colours as one byte per channel. A normal kept to 1/127 per axis is within about half a
degree of the original: the lighting looks the same. Positions, triangles, materials, names and the
node hierarchy are untouched (pivots and animation stay exactly as before).

blender/build_all.sh runs this after exporting. To run it by hand:

    python3 blender/compact_glb.py assets/models/*.glb
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

F32, U8, I8, U16 = 5126, 5121, 5120, 5123
SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
NUM = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
DTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


def read_glb(path):
    d = Path(path).read_bytes()
    magic, version, _ = struct.unpack('<4sII', d[:12])
    assert magic == b'glTF' and version == 2, path
    jlen = struct.unpack('<I', d[12:16])[0]
    gltf = json.loads(d[20:20 + jlen])
    pos = 20 + jlen
    blen = struct.unpack('<I', d[pos:pos + 4])[0]
    return gltf, d[pos + 8:pos + 8 + blen]


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    Path(path).write_bytes(struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<I4s', len(js), b'JSON') + js
                           + struct.pack('<I4s', len(binary), b'BIN\0') + binary)


def accessor_data(gltf, binary, a):
    """an accessor's values as a numpy array (count x components)"""
    v = gltf['bufferViews'][a['bufferView']]
    n, comp = NUM[a['type']], a['componentType']
    stride = v.get('byteStride') or n * SIZE[comp]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    raw = np.frombuffer(binary, dtype=np.uint8, count=stride * (a['count'] - 1) + n * SIZE[comp], offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], n * SIZE[comp]), strides=(stride, 1))
    return np.ascontiguousarray(rows).view(DTYPE[comp]).reshape(a['count'], n)


def compact(path):
    gltf, binary = read_glb(path)
    before = Path(path).stat().st_size
    if 'KHR_mesh_quantization' in gltf.get('extensionsUsed', []):
        print(f'{path}: already compact')
        return
    assert not any('sparse' in a for a in gltf['accessors']), 'sparse accessors are not handled'
    roles = {}                                           # accessor index -> how it is used
    for m in gltf['meshes']:
        for p in m['primitives']:
            assert 'targets' not in p, 'morph targets are not handled'
            for name, i in p['attributes'].items():
                roles.setdefault(i, set()).add(name)
    new_views, chunks, offset = [], [], 0

    def add(data, target=None, stride=None):
        nonlocal offset
        pad = -offset % 4
        chunks.append(b'\0' * pad)
        offset += pad
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if stride:
            view['byteStride'] = stride
        if target:
            view['target'] = target
        new_views.append(view)
        chunks.append(data)
        offset += len(data)
        return len(new_views) - 1

    quantized = False
    for i, a in enumerate(gltf['accessors']):
        vals = accessor_data(gltf, binary, a)
        r = roles.get(i, set())
        target = gltf['bufferViews'][a['bufferView']].get('target')
        if r == {'NORMAL'} and a['componentType'] == F32:
            q = np.clip(np.round(vals * 127), -127, 127).astype(np.int8)
            q = np.concatenate([q, np.zeros((len(q), 1), np.int8)], axis=1)      # 4-byte aligned vertices
            a.update(componentType=I8, normalized=True, bufferView=add(q.tobytes(), target, 4))
            a.pop('byteOffset', None), a.pop('min', None), a.pop('max', None)
            quantized = True
        elif r and all(x.startswith('COLOR_') for x in r) and a['componentType'] in (F32, U16):
            f = vals.astype(np.float64) / (65535 if a['componentType'] == U16 else 1)
            q = np.clip(np.round(f * 255), 0, 255).astype(np.uint8)
            if q.shape[1] == 3:
                q = np.concatenate([q, np.full((len(q), 1), 255, np.uint8)], axis=1)
                a['type'] = 'VEC4'
            a.update(componentType=U8, normalized=True, bufferView=add(q.tobytes(), target))
            a.pop('byteOffset', None), a.pop('min', None), a.pop('max', None)
        else:                                            # positions, indices and the rest: copied as they are
            a['bufferView'] = add(np.ascontiguousarray(vals).tobytes(), target)
            a.pop('byteOffset', None)
    # images and anything else stored in buffer views (none in these models, but keep them)
    for img in gltf.get('images', []):
        v = gltf['bufferViews'][img['bufferView']]
        img['bufferView'] = add(binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
    gltf['bufferViews'] = new_views
    gltf['buffers'] = [{'byteLength': offset}]
    if quantized:
        for k in ('extensionsUsed', 'extensionsRequired'):
            gltf[k] = sorted(set(gltf.get(k, [])) | {'KHR_mesh_quantization'})
    write_glb(path, gltf, b''.join(chunks))
    print(f'{path}: {before // 1024} KB -> {Path(path).stat().st_size // 1024} KB')


if __name__ == '__main__':
    for p in sys.argv[1:]:
        compact(p)
