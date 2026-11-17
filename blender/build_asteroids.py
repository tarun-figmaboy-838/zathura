"""Eight cratered asteroid variants with baked vertex colour, normalised to radius ~1.

  Blender -b --factory-startup -P blender/build_asteroids.py -- assets/models/asteroids.glb
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SMOOTH, export_glb, finalize, material, obj_from_bm, out_path, reset_scene
import bmesh
from mathutils import Vector, noise

OUT = out_path("asteroids.glb")
scene = reset_scene()
rock_mat = material("Rock", (0.2, 0.18, 0.16), 0.0, 0.92, vertex_color=True)
VARIANTS = 8
BASIS = "PERLIN_ORIGINAL"


def rand_dir(r):
    return Vector((r.gauss(0, 1), r.gauss(0, 1), r.gauss(0, 1))).normalized()


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def build(i, subdivisions, suffix, rmax_ref=None):
    r = random.Random(100 + i)
    off = Vector((r.uniform(-50, 50), r.uniform(-50, 50), r.uniform(-50, 50)))
    stretch = Vector((r.uniform(0.75, 1.3), r.uniform(0.6, 1.0), r.uniform(0.8, 1.45)))
    craters = [(rand_dir(r), r.uniform(0.12, 0.42), r.uniform(0.05, 0.14)) for _ in range(r.randint(5, 11))]
    lumpiness = r.uniform(0.25, 0.45)

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1.0)
    data = []
    for v in bm.verts:
        n = v.co.normalized()
        h = noise.noise(n * 0.9 + off * 0.5, noise_basis=BASIS) * lumpiness
        h += noise.fractal(n * 2.2 + off, 0.6, 2.0, 5, noise_basis=BASIS) * 0.12
        h += noise.ridged_multi_fractal(n * 4.0 + off, 0.9, 2.1, 4, 0.9, 2.0, noise_basis=BASIS) * 0.025
        crater = 0.0
        for c, rad, depth in craters:
            x = math.acos(max(-1.0, min(1.0, n.dot(c)))) / rad
            if x < 1.0:
                crater += depth * (x * x - 1.0)
            if x < 1.4:
                crater += depth * 0.3 * max(0.0, 1.0 - ((x - 1.0) / 0.35) ** 2)
        h += crater
        v.co = Vector((n.x * stretch.x, n.y * stretch.y, n.z * stretch.z)) * (1.0 + h)
        data.append((h, crater, noise.noise(n * 3.0 + off * 2.0, noise_basis=BASIS)))

    # normalise so the farthest vertex sits at radius 1 (the LOD reuses the hi-res scale)
    rmax = rmax_ref or max(v.co.length for v in bm.verts)
    for v in bm.verts:
        v.co /= rmax

    me_name = f"Asteroid_{i}{suffix}"
    ob = obj_from_bm(me_name, bm, rock_mat)
    me = ob.data
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    base_a = (0.105, 0.095, 0.085)   # dark basalt
    base_b = (0.21, 0.185, 0.155)    # dusty regolith
    rust = (0.24, 0.13, 0.07)
    for idx, (h, crater, patch) in enumerate(data):
        t = max(0.0, min(1.0, 0.5 + h * 1.6))
        c = mix(base_a, base_b, t)
        if patch > 0.25:
            c = mix(c, rust, min(1.0, (patch - 0.25) * 1.8) * 0.6)
        dark = max(0.55, 1.0 + crater * 3.5)  # crater floors are darker
        col.data[idx].color = (c[0] * dark, c[1] * dark, c[2] * dark, 1.0)
    me.color_attributes.active_color = col
    try:
        me.color_attributes.render_color_index = 0
    except Exception:
        pass
    ob.location = (i * 3.0, 0, 3.0 if suffix else 0)
    SMOOTH[me_name] = 180
    return rmax


for i in range(VARIANTS):
    rmax = build(i, 5, "")            # 5120 tris, used up close
    build(i, 4, "_lod", rmax)         # 1280 tris, used at range and for debris

tris = finalize(scene)
print(f"[asteroids] triangles total: {tris}")
export_glb(OUT)
