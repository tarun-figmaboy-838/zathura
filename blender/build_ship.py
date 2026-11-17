"""DRIFTBOUND gunship with a 360-degree dorsal cannon turret.

  Blender -b --factory-startup -P blender/build_ship.py -- assets/models/ship.glb

Node names the game relies on:
  TurretMount > TurretYaw > TurretPitch > Barrel_L/Barrel_R > Muzzle_L/Muzzle_R
  EngineGlow_L / EngineGlow_C / EngineGlow_R, NavLight_L / NavLight_R, Beacon
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SMOOTH, add_bevel, add_mirror, add_subsurf, blade, blade_band, box, cubes,
                    disk, empty, export_glb, finalize, lathe, loft, material, obj_from_bm,
                    out_path, reset_scene, superellipse, tube)
import bmesh
from mathutils import Matrix, Vector

OUT = out_path("ship.glb")
scene = reset_scene()
rng = random.Random(7)

M = dict(
    hull=material("HullPaint", (0.56, 0.58, 0.61), 0.35, 0.42),
    accent=material("Accent", (0.85, 0.28, 0.04), 0.2, 0.45),
    dark=material("DarkMetal", (0.045, 0.05, 0.055), 0.85, 0.36),
    gun=material("Gunmetal", (0.16, 0.17, 0.19), 0.85, 0.3),
    glass=material("Glass", (0.01, 0.015, 0.025), 1.0, 0.05),
    engine=material("EngineGlow", (0, 0, 0), 0.0, 0.5, emission=(0.35, 0.75, 1.0), strength=6.0),
    trim=material("TrimLight", (0, 0, 0), 0.0, 0.5, emission=(0.2, 0.9, 1.0), strength=4.0),
    navL=material("NavRed", (0, 0, 0), 0.0, 0.5, emission=(1.0, 0.05, 0.03), strength=10.0),
    navR=material("NavGreen", (0, 0, 0), 0.0, 0.5, emission=(0.05, 1.0, 0.25), strength=10.0),
    beacon=material("BeaconRed", (0, 0, 0), 0.0, 0.5, emission=(1.0, 0.1, 0.05), strength=10.0),
    cannon=material("CannonGlow", (0, 0, 0), 0.0, 0.5, emission=(1.0, 0.42, 0.08), strength=6.0),
)

ship = empty("Ship")

# ------------------------------------------------------------------ fuselage
# (y, half width, half height, z center, squareness)
H = [(-6.4, 0.95, 0.70, 0.15, 2.6),
     (-6.0, 1.25, 0.88, 0.15, 3.0),
     (-4.5, 1.50, 1.00, 0.18, 3.2),
     (-1.5, 1.62, 1.06, 0.20, 3.2),
     (1.2, 1.48, 0.96, 0.12, 3.0),
     (3.4, 1.10, 0.74, 0.00, 2.6),
     (5.4, 0.62, 0.46, -0.12, 2.3),
     (6.8, 0.22, 0.20, -0.20, 2.0),
     (7.1, 0.06, 0.06, -0.22, 2.0)]
hull = obj_from_bm("Hull", loft(H, 32), M["hull"], ship)
add_subsurf(hull, 2)
SMOOTH["Hull"] = 80


def hull_top(x, y):
    for a, b in zip(H, H[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            _, w, h, zc, p = [a[i] + (b[i] - a[i]) * t for i in range(5)]
            u = min(abs(x) / w, 0.999)
            return zc + h * (1 - u ** p) ** (1 / p)
    return 0.0


# canopy
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=1.0)
for v in bm.verts:
    v.co = Vector((v.co.x * 0.62, v.co.y * 1.5, v.co.z * 0.5)) + Vector((0, 2.7, 0.66))
obj_from_bm("Canopy", bm, M["glass"], ship)
SMOOTH["Canopy"] = 80
# canopy frame: a thin oversized band around the canopy base
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=1.0)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.32 or v.co.z < 0.12], context="VERTS")
for v in bm.verts:
    v.co = Vector((v.co.x * 0.66, v.co.y * 1.54, v.co.z * 0.52)) + Vector((0, 2.7, 0.66))
frame = obj_from_bm("CanopyFrame", bm, M["gun"], ship)
SMOOTH["CanopyFrame"] = 80

# ------------------------------------------------------------------ wings
W_ROOT, W_TIP, W_CR, W_CT, W_TR, W_TT = (1.1, 0.4, -0.05), (6.2, -3.3, -0.5), 4.6, 1.8, 0.32, 0.12
wing = obj_from_bm("Wing", blade(W_ROOT, W_TIP, W_CR, W_CT, W_TR, W_TT), M["hull"], ship)
add_mirror(wing)
add_bevel(wing, 0.025, 2, 25)
band = obj_from_bm("WingBand", blade_band(W_ROOT, W_TIP, W_CR, W_CT, W_TR, W_TT, 0.70, 0.80), M["accent"], ship)
add_mirror(band)
add_bevel(band, 0.01, 1, 25)

# wingtip pods + nav lights
POD = (6.25, 0, -0.52)
pod_prof = [(0.04, -1.9), (0.13, -2.15), (0.21, -2.6), (0.24, -3.4), (0.24, -4.6), (0.19, -5.3), (0.10, -5.5)]
pod = obj_from_bm("WingPod", lathe(pod_prof, 24, "Y", center=POD), M["accent"], ship)
add_mirror(pod)
SMOOTH["WingPod"] = 50
for side, sx, mat in (("L", -1, M["navL"]), ("R", 1, M["navR"])):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.075)
    obj_from_bm(f"NavLight_{side}", bm, mat, ship, (sx * (POD[0] + 0.25), -3.0, POD[2]))
    SMOOTH[f"NavLight_{side}"] = 80

# ------------------------------------------------------------------ engines
NAC = (1.95, 0, 0.05)
nac_prof = [(0.30, -1.4), (0.47, -1.7), (0.62, -2.4), (0.66, -3.8), (0.64, -5.6), (0.56, -6.4)]
nac = obj_from_bm("Nacelle", lathe(nac_prof, 32, "Y", center=NAC), M["hull"], ship)
add_mirror(nac)
SMOOTH["Nacelle"] = 50
intake = obj_from_bm("Intake", lathe([(0.27, -1.36), (0.37, -1.30), (0.50, -1.62), (0.42, -1.68)],
                                     32, "Y", closed=True, center=NAC), M["dark"], ship)
add_mirror(intake)
noz_prof = [(0.50, -6.3), (0.60, -6.35), (0.68, -7.15), (0.62, -7.2), (0.47, -6.55)]
noz = obj_from_bm("Nozzle", lathe(noz_prof, 32, "Y", closed=True, center=NAC), M["dark"], ship)
add_mirror(noz)
SMOOTH["Nozzle"] = 40
# nacelle accent band
nband = obj_from_bm("NacelleBand", lathe([(0.67, -2.9), (0.69, -2.95), (0.69, -3.45), (0.67, -3.5)],
                                         32, "Y", closed=True, center=NAC), M["accent"], ship)
add_mirror(nband)

main_noz = [(0.60, -6.25), (0.78, -6.35), (0.86, -7.05), (0.78, -7.1), (0.58, -6.55)]
obj_from_bm("MainNozzle", lathe(main_noz, 40, "Y", closed=True, center=(0, 0, 0.2)), M["dark"], ship)
SMOOTH["MainNozzle"] = 40

obj_from_bm("EngineGlow_L", disk(0.47, (0, 0, 0)), M["engine"], ship, (-NAC[0], -6.62, NAC[2]))
obj_from_bm("EngineGlow_R", disk(0.47, (0, 0, 0)), M["engine"], ship, (NAC[0], -6.62, NAC[2]))
obj_from_bm("EngineGlow_C", disk(0.60, (0, 0, 0), 40), M["engine"], ship, (0, -6.6, 0.2))

# ------------------------------------------------------------------ tail + keel
F_ROOT, F_TIP, F_CR, F_CT, F_TR, F_TT = (0.55, -3.6, 0.8), (1.55, -5.7, 2.45), 2.9, 1.1, 0.18, 0.08
fin = obj_from_bm("Fin", blade(F_ROOT, F_TIP, F_CR, F_CT, F_TR, F_TT), M["hull"], ship)
add_mirror(fin)
add_bevel(fin, 0.02, 2, 25)
fband = obj_from_bm("FinBand", blade_band(F_ROOT, F_TIP, F_CR, F_CT, F_TR, F_TT, 0.78, 1.0, 0.02), M["accent"], ship)
add_mirror(fband)
add_bevel(fband, 0.01, 1, 25)
keel = obj_from_bm("Keel", blade((0, -2.6, -0.55), (0, -4.6, -1.45), 3.0, 1.4, 0.16, 0.07), M["hull"], ship)
add_bevel(keel, 0.02, 2, 25)

# ------------------------------------------------------------------ greebles
TURRET_Y = -1.0
for i in range(10):
    y = rng.uniform(-5.6, 1.0)
    if abs(y - TURRET_Y) < 1.6:
        continue
    x = rng.uniform(0.25, 0.95)
    sx, sy, sz = rng.uniform(0.12, 0.38), rng.uniform(0.3, 1.1), rng.uniform(0.05, 0.12)
    z = hull_top(x, y) - 0.06
    g = obj_from_bm(f"Greeble_{i}", box((sx, sy, sz * 2), (x, y, z)),
                    M["dark"] if rng.random() < 0.6 else M["gun"], ship)
    add_mirror(g)
    add_bevel(g, 0.015, 2)
# side vents
for i, y in enumerate((-0.2, 0.5, 1.2)):
    v = obj_from_bm(f"Vent_{i}", box((0.1, 0.45, 0.32), (1.5, y, 0.05)), M["dark"], ship)
    add_mirror(v)
    add_bevel(v, 0.02, 2)
# antenna + beacon
ant_base = (-0.55, -4.7, hull_top(0.55, -4.7) - 0.05)
obj_from_bm("Antenna", lathe([(0.05, 0.0), (0.03, 0.15), (0.018, 0.95)], 8, "Z", center=ant_base), M["gun"], ship)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.06)
obj_from_bm("Beacon", bm, M["beacon"], ship, (ant_base[0], ant_base[1], ant_base[2] + 0.98))
# ------------------------------------------------------------------ used-future detail
def hull_section(y):
    for a, b in zip(H, H[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return [a[i] + (b[i] - a[i]) * t for i in range(5)]
    return list(H[0])


def hull_point(y, angle_deg, out=0.06):
    _, w, h, zc, p = hull_section(y)
    x, z = superellipse(w * 0.985, h * 0.985, p, math.radians(angle_deg))
    n = Vector((x / w, 0, z / h)).normalized()
    return Vector((x, y, zc + z)) + n * out


# framed cockpit: cross ribs + a centre strut over the glass
for i, y in enumerate((1.85, 2.6, 3.35)):
    s = math.sqrt(max(0.0, 1 - ((y - 2.7) / 1.5) ** 2))
    rib = obj_from_bm(f"CanopyRib_{i}", lathe([(1.0, y - 0.035), (1.05, y), (1.0, y + 0.035), (0.985, y)], 40, "Y",
                                              closed=True, center=(0, 0, 0.66), scale=(0.62 * s, 0.5 * s)), M["gun"], ship)
    SMOOTH[rib.name] = 60
strut = [(0, 2.7 + 1.53 * math.cos(math.radians(a)), 0.66 + 0.515 * math.sin(math.radians(a))) for a in range(20, 165, 8)]
obj_from_bm("CanopyStrut", tube(strut, 0.03, 6), M["gun"], ship)

# conduits along the shoulders and the forward flanks
shoulder = [hull_point(y, 35, 0.07) for y in (-5.4, -4.4, -3.2, -2.0, -0.6, 0.6)]
pipe = obj_from_bm("PipeShoulder", tube(shoulder, 0.065, 8), M["dark"], ship)
add_mirror(pipe)
SMOOTH[pipe.name] = 50
flank = [hull_point(y, 8, 0.06) for y in (-1.0, 0.2, 1.4, 2.6, 3.4)]
pipe2 = obj_from_bm("PipeFlank", tube(flank, 0.05, 8), M["gun"], ship)
add_mirror(pipe2)
SMOOTH[pipe2.name] = 50
# radial cooling fins around each nacelle exhaust
fin_mats = []
for k in range(10):
    a = 2 * math.pi * k / 10
    fin_mats.append(Matrix.Translation((NAC[0], -5.55, NAC[2])) @ Matrix.Rotation(a, 4, "Y")
                    @ Matrix.Translation((0, 0, 0.69)) @ Matrix.Diagonal((0.05, 1.1, 0.12, 1.0)))
fins = obj_from_bm("CoolingFins", cubes(bmesh.new(), fin_mats), M["dark"], ship)
add_mirror(fins)
add_bevel(fins, 0.012, 1)

# squadron band around the nose
_, w0, h0, zc0, p0 = hull_section(4.55)
_, w1, h1, zc1, p1 = hull_section(4.95)
band_nose = obj_from_bm("NoseBand", loft([(4.55, w0 * 0.985 + 0.012, h0 * 0.985 + 0.012, zc0, p0),
                                          (4.95, w1 * 0.985 + 0.012, h1 * 0.985 + 0.012, zc1, p1)], 32), M["accent"], ship)
SMOOTH[band_nose.name] = 60

# ------------------------------------------------------------------ 360 turret
mount = empty("TurretMount", ship, (0, TURRET_Y, 1.12))
mount.scale = (1.35, 1.35, 1.35)  # oversized so the 360 cannon reads instantly
base = obj_from_bm("TurretBase", lathe([(1.22, -0.30), (1.24, -0.02), (1.14, 0.12), (1.0, 0.17)], 48, "Z"),
                   M["gun"], mount)
add_bevel(base, 0.02, 2)

yaw = empty("TurretYaw", mount, (0, 0, 0.17))
HOUSING = [(0.98, 0.0), (1.02, 0.12), (0.94, 0.48), (0.66, 0.74), (0.34, 0.82)]
house = obj_from_bm("TurretHousing", lathe(HOUSING, 8, "Z", phase=math.pi / 8, scale=(1.0, 1.22)), M["gun"], yaw)
add_bevel(house, 0.035, 3, 25)
trim = obj_from_bm("TurretTrim", lathe([(0.99, 0.22), (1.015, 0.23), (1.005, 0.30), (0.985, 0.31)], 8, "Z",
                                       closed=True, phase=math.pi / 8, scale=(1.0, 1.22)), M["trim"], yaw)
cheek = obj_from_bm("TurretCheek", box((0.16, 0.95, 0.62), (0.56, 0.18, 0.92),
                                       shape=lambda v: setattr(v.co, "z", v.co.z * (0.75 if v.co.y > 0 else 1.0))),
                    M["accent"], yaw)
add_mirror(cheek)
add_bevel(cheek, 0.03, 3)

pitch = empty("TurretPitch", yaw, (0, 0.2, 0.98))


def mantlet_shape(v):
    if v.co.y > 0:
        v.co.x *= 0.88
        v.co.z *= 0.78


mant = obj_from_bm("TurretMantlet", box((0.88, 0.75, 0.46), (0, 0.12, 0), shape=mantlet_shape), M["gun"], pitch)
add_bevel(mant, 0.035, 3)
BARREL = [(0.13, 0.0), (0.13, 0.55), (0.10, 0.66), (0.10, 1.70), (0.085, 1.78), (0.08, 2.75),
          (0.115, 2.80), (0.125, 3.10), (0.095, 3.16)]
for side, sx in (("L", -0.22), ("R", 0.22)):
    b = obj_from_bm(f"Barrel_{side}", lathe(BARREL, 20, "Y"), M["dark"], pitch, (sx, 0.35, 0.03))
    SMOOTH[b.name] = 40
    empty(f"Muzzle_{side}", b, (0, 3.2, 0))
    # glowing energy coils + muzzle ring (children of the barrel so they recoil with it)
    for k, (y0, r0) in enumerate(((1.0, 0.1), (1.32, 0.1), (2.05, 0.08), (2.37, 0.08))):
        coil = obj_from_bm(f"Coil_{side}{k}", lathe([(r0 + 0.008, y0), (r0 + 0.03, y0 + 0.03), (r0 + 0.03, y0 + 0.13), (r0 + 0.008, y0 + 0.16)],
                                                    16, "Y", closed=True), M["cannon"], b)
        SMOOTH[coil.name] = 50
    tip = obj_from_bm(f"MuzzleRing_{side}", lathe([(0.1, 3.1), (0.135, 3.12), (0.135, 3.17), (0.1, 3.19)], 16, "Y", closed=True), M["cannon"], b)
# sensor pod on the turret roof
sensor = obj_from_bm("TurretSensor", box((0.26, 0.34, 0.16), (-0.42, -0.25, 0.86)), M["dark"], yaw)
add_bevel(sensor, 0.02, 2)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.06)
obj_from_bm("TurretLens", bm, M["trim"], yaw, (-0.42, -0.08, 0.88))

# ------------------------------------------------------------------ export
tris = finalize(scene)
print(f"[ship] triangles: {tris}")
export_glb(OUT)
