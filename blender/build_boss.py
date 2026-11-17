"""Warden carrier: the level-5 boss. A faceted wedge carrier (~42 units) with four dorsal
cannon turrets, a recessed reactor core, side hangar pods, a command tower and a bank of
four thrusters.

  Blender -b --factory-startup -P blender/build_boss.py -- assets/models/boss.glb

Node names the game relies on:
  TurretHead_0..3 (yaw pivots) > TurretMuzzle_0..3,  Core,  Hangar,  EngineGlow_0..3
Nose is +Y here, -Z in Three.js.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SMOOTH, add_bevel, add_mirror, box, cubes, disk, empty, export_glb, finalize, lathe, loft,
                    material, obj_from_bm, out_path, reset_scene, superellipse, tube)
import bmesh
from mathutils import Matrix, Vector

OUT = out_path("boss.glb")
scene = reset_scene()
rng = random.Random(5)

M = dict(
    hull=material("BossHull", (0.3, 0.31, 0.33), 0.55, 0.42),
    plate=material("BossPlate", (0.06, 0.065, 0.075), 0.65, 0.35),
    mark=material("BossMark", (0.45, 0.04, 0.03), 0.3, 0.45),
    glow=material("BossGlow", (0, 0, 0), 0.0, 0.5, emission=(1.0, 0.25, 0.06), strength=6.0),
    core=material("BossCore", (0, 0, 0), 0.0, 0.5, emission=(1.0, 0.08, 0.05), strength=9.0),
    gun=material("BossGun", (0.05, 0.05, 0.055), 0.9, 0.3),
)

root = empty("Boss")

# ------------------------------------------------------------------ faceted wedge hull
H = [(-20, 6.0, 2.6, 0.0, 1.35), (-16, 10.0, 3.6, 0.2, 1.35), (-6, 12.0, 4.0, 0.3, 1.35),
     (6, 10.0, 3.4, 0.2, 1.35), (14, 6.0, 2.4, 0.0, 1.35), (20, 2.2, 1.2, -0.2, 1.35), (22, 0.4, 0.3, -0.3, 1.35)]
hull = obj_from_bm("Hull", loft(H, 8), M["hull"], root)
add_bevel(hull, 0.12, 2, 20)


def section(y):
    for a, b in zip(H, H[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return [a[i] + (b[i] - a[i]) * t for i in range(5)]
    return list(H[0])


def top(x, y):
    _, w, h, zc, p = section(y)
    u = min(abs(x) / w, 0.999)
    return zc + h * (1 - u ** p) ** (1 / p)


# dark armour plating along the dorsal ridge and red flank stripes
plates = cubes(bmesh.new(), [Matrix.Translation((0, y, top(0, y) - 0.05)) @ Matrix.Diagonal((2.2, 3.2, 0.5, 1))
                             for y in (12, 3.5, -9)])
obj_from_bm("SpinePlates", plates, M["plate"], root)
stripe = obj_from_bm("FlankStripe", box((0.3, 18, 0.6), (11.4, 0, 0.4)), M["mark"], root)
add_mirror(stripe)

# ------------------------------------------------------------------ hangar pods + engines
pod = obj_from_bm("HangarPod", lathe([(1.2, 7.5), (2.4, 6.4), (2.7, 4.0), (2.7, -12.0), (2.3, -14.5)], 8, "Y",
                                     center=(12.5, 0, 0.2), phase=math.pi / 8), M["hull"], root)
add_mirror(pod)
add_bevel(pod, 0.08, 1, 25)
for i, y in enumerate((2.0, -6.0)):
    band = obj_from_bm(f"PodBand_{i}", lathe([(2.72, y), (2.85, y + 0.1), (2.85, y + 1.0), (2.72, y + 1.1)], 8, "Y", closed=True,
                                             center=(12.5, 0, 0.2), phase=math.pi / 8), M["mark"], root)
    add_mirror(band)
ENG = [(-8.0, 0.2), (-3.0, 0.5), (3.0, 0.5), (8.0, 0.2)]
for i, (x, z) in enumerate(ENG):
    obj_from_bm(f"Thruster_{i}", lathe([(1.3, -19.0), (1.7, -19.4), (1.8, -21.2), (1.55, -21.3), (1.2, -19.6)], 6, "Y",
                                       closed=True, center=(x, 0, z), phase=math.pi / 6), M["gun"], root)
    obj_from_bm(f"EngineGlow_{i}", disk(1.25, (0, 0, 0), 6), M["glow"], root, (x, -20.4, z))
empty("Hangar", root, (0, 15.5, -1.4))
mouth = obj_from_bm("HangarMouth", box((5.0, 0.6, 1.6), (0, 15.2, -1.0)), M["glow"], root)

# ------------------------------------------------------------------ command tower
ty = -13.0
tz = top(0, ty)
tower = obj_from_bm("Tower", cubes(bmesh.new(), [
    Matrix.Translation((0, ty, tz + 1.3)) @ Matrix.Diagonal((5.0, 6.0, 2.6, 1)),
    Matrix.Translation((0, ty + 0.6, tz + 3.2)) @ Matrix.Diagonal((3.6, 3.6, 1.4, 1)),
]), M["hull"], root)
add_bevel(tower, 0.1, 2)
obj_from_bm("Bridge", box((3.0, 0.15, 0.35), (0, ty + 2.42, tz + 3.25)), M["glow"], root)
obj_from_bm("Mast", tube([(1.2, ty, tz + 3.8), (1.2, ty, tz + 6.5)], 0.12, 8), M["gun"], root)

# ------------------------------------------------------------------ reactor core in a socket
cy = -1.0
cz = top(0, cy)
sock = obj_from_bm("CoreSocket", lathe([(3.6, cz - 0.6), (3.6, cz + 0.4), (3.0, cz + 0.6), (2.5, cz + 0.2)], 16, "Z",
                                       closed=True), M["plate"], root)
SMOOTH[sock.name] = 40
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=2.2)
obj_from_bm("Core", bm, M["core"], root, (0, cy, cz + 0.5))
SMOOTH["Core"] = 80

# ------------------------------------------------------------------ four dorsal cannon turrets
TURRETS = [(-4.2, 8.5), (4.2, 8.5), (-5.6, -6.5), (5.6, -6.5)]
for i, (x, y) in enumerate(TURRETS):
    z = top(x, y)
    obj_from_bm(f"TurretBase_{i}", lathe([(2.5, z - 0.5), (2.5, z + 0.4), (2.0, z + 0.8)], 12, "Z", center=(x, y, 0)),
                M["plate"], root)
    head = empty(f"TurretHead_{i}", root, (x, y, z + 0.8))
    head.scale = (1.8, 1.8, 1.8)  # big, readable weak points from the top camera
    dome = obj_from_bm(f"TurretDome_{i}", lathe([(1.1, 0.0), (1.05, 0.5), (0.7, 0.95), (0.25, 1.05)], 8, "Z",
                                                phase=math.pi / 8), M["hull"], head)
    add_bevel(dome, 0.05, 1, 25)
    for side in (-1, 1):
        b = obj_from_bm(f"TurretBarrel_{i}_{side}", lathe([(0.22, 0.4), (0.22, 1.0), (0.16, 1.1), (0.16, 3.0), (0.22, 3.05), (0.22, 3.3)],
                                                           10, "Y", center=(side * 0.38, 0, 0.5)), M["gun"], head)
        SMOOTH[b.name] = 40
    obj_from_bm(f"TurretEye_{i}", box((0.7, 0.12, 0.18), (0, 0.95, 0.65)), M["glow"], head)
    empty(f"TurretMuzzle_{i}", head, (0, 3.45, 0.5))

# a few greebles on the deck
for i in range(10):
    y = rng.uniform(-16, 15)
    x = rng.uniform(1.5, max(1.6, section(y)[1] * 0.6))
    if any(abs(x - abs(tx)) < 2.4 and abs(y - ty_) < 2.4 for tx, ty_ in TURRETS) or abs(y - cy) < 4.5:
        continue
    g = obj_from_bm(f"Greeble_{i}", box((rng.uniform(0.6, 1.6), rng.uniform(1, 3), 0.4), (x, y, top(x, y) - 0.1)),
                    M["plate"] if i % 2 else M["hull"], root)
    add_mirror(g)
    add_bevel(g, 0.04, 1)

tris = finalize(scene)
print(f"[boss] triangles: {tris}")
export_glb(OUT)
