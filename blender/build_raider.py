"""Raider: the hostile interceptor. Faceted grey armour, dark wing plates with heavy
anhedral, a red visor slit, long chin cannons and twin hex thrusters. Original design in
a utilitarian "used-future" style.

  Blender -b --factory-startup -P blender/build_raider.py -- assets/models/raider.glb

Node names the game relies on: Gun_L / Gun_R (muzzles), EngineGlow_L / EngineGlow_R, Eye.
Nose is +Y here, -Z in Three.js. ~6.4 units long, ~8.6 wingspan.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SMOOTH, add_bevel, add_mirror, blade, blade_band, box, disk, empty, export_glb,
                    finalize, lathe, loft, material, obj_from_bm, out_path, reset_scene, tube)
import bmesh
from mathutils import Vector

OUT = out_path("raider.glb")
scene = reset_scene()
rng = random.Random(11)

M = dict(
    hull=material("RaiderHull", (0.36, 0.37, 0.39), 0.5, 0.42),
    plate=material("RaiderPlate", (0.06, 0.065, 0.075), 0.6, 0.35),
    mark=material("RaiderMark", (0.42, 0.04, 0.03), 0.3, 0.45),
    glass=material("RaiderGlass", (0.01, 0.01, 0.015), 1.0, 0.05),
    glow=material("RaiderGlow", (0, 0, 0), 0.0, 0.5, emission=(1.0, 0.22, 0.06), strength=7.0),
    gun=material("RaiderGun", (0.05, 0.05, 0.055), 0.9, 0.3),
)

root = empty("Raider")

# ------------------------------------------------------------------ faceted body
B = [(-2.9, 0.50, 0.38, 0.05, 1.5),
     (-2.3, 0.90, 0.58, 0.08, 1.5),
     (-0.7, 1.05, 0.64, 0.10, 1.5),
     (0.9, 0.80, 0.50, 0.05, 1.5),
     (2.3, 0.36, 0.24, -0.02, 1.5),
     (3.15, 0.08, 0.06, -0.05, 1.5)]
body = obj_from_bm("Body", loft(B, 8), M["hull"], root)
add_bevel(body, 0.035, 2, 20)

# canopy + red visor slit
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0)
for v in bm.verts:
    v.co = Vector((v.co.x * 0.42, v.co.y * 0.95, v.co.z * 0.32)) + Vector((0, 0.8, 0.5))
canopy = obj_from_bm("Canopy", bm, M["glass"], root)
add_bevel(canopy, 0.02, 1, 25)
eye = obj_from_bm("Eye", box((0.5, 0.07, 0.06), (0, 1.68, 0.55)), M["glow"], root)
add_bevel(eye, 0.015, 1)

# ------------------------------------------------------------------ wings
W = ((0.8, 0.6, 0.0), (4.3, -2.1, -1.15), 3.0, 1.0, 0.14, 0.06)
wing = obj_from_bm("Wing", blade(*W), M["plate"], root)
add_mirror(wing)
add_bevel(wing, 0.02, 2, 25)
spar = obj_from_bm("WingSpar", tube([Vector(W[0]) + Vector((0, 0.02, 0)), Vector(W[1]) + Vector((0, 0.02, 0))], 0.09, 8),
                   M["hull"], root)
add_mirror(spar)
SMOOTH["WingSpar"] = 50
mark = obj_from_bm("WingMark", blade_band(*W, 0.72, 0.84, 0.015), M["mark"], root)
add_mirror(mark)
tipglow = obj_from_bm("WingTipGlow", blade_band(*W, 0.95, 1.0, 0.012), M["glow"], root)
add_mirror(tipglow)
stab = obj_from_bm("Stabilizer", blade((0.35, -1.0, 0.5), (1.3, -2.6, 1.7), 1.6, 0.5, 0.1, 0.04), M["plate"], root)
add_mirror(stab)
add_bevel(stab, 0.015, 2, 25)

# ------------------------------------------------------------------ chin cannons
cannon = obj_from_bm("Cannon", lathe([(0.11, 0.3), (0.11, 1.0), (0.075, 1.1), (0.075, 2.9), (0.1, 2.95),
                                      (0.1, 3.15), (0.06, 3.2)], 12, "Y", center=(1.05, 0, -0.28)), M["gun"], root)
add_mirror(cannon)
SMOOTH["Cannon"] = 40
mount = obj_from_bm("CannonMount", box((0.3, 1.1, 0.26), (1.0, 0.6, -0.18)), M["hull"], root)
add_mirror(mount)
add_bevel(mount, 0.03, 2)
empty("Gun_L", root, (-1.05, 3.25, -0.28))
empty("Gun_R", root, (1.05, 3.25, -0.28))

# ------------------------------------------------------------------ twin hex thrusters
NZ = (0.55, 0, 0.05)
noz = obj_from_bm("Nozzle", lathe([(0.30, -2.75), (0.40, -2.8), (0.42, -3.3), (0.36, -3.33), (0.28, -2.95)],
                                  6, "Y", closed=True, center=NZ, phase=math.pi / 6), M["gun"], root)
add_mirror(noz)
add_bevel(noz, 0.015, 1, 25)
for side, sx in (("L", -1), ("R", 1)):
    obj_from_bm(f"EngineGlow_{side}", disk(0.3, (0, 0, 0), 6), M["glow"], root, (sx * NZ[0], -3.0, NZ[2]))

# ------------------------------------------------------------------ greebles
gb = []
for i in range(9):
    y = rng.uniform(-2.4, 0.2)
    x = rng.uniform(0.15, 0.55)
    g = obj_from_bm(f"Greeble_{i}", box((rng.uniform(0.1, 0.3), rng.uniform(0.25, 0.7), 0.1),
                                        (x, y, 0.6 + 0.04 * (1 - abs(y) / 3))), M["plate"] if i % 2 else M["hull"], root)
    add_mirror(g)
    add_bevel(g, 0.012, 1)
side_pipe = obj_from_bm("SidePipe", tube([(0.98, -2.2, 0.0), (1.05, -0.7, 0.02), (0.82, 0.9, 0.0)], 0.05, 8), M["gun"], root)
add_mirror(side_pipe)

tris = finalize(scene)
print(f"[raider] triangles: {tris}")
export_glb(OUT)
