"""Orbital station "Haven-9" and the round landing platform the player's ship launches from.

  Blender -b --factory-startup -P blender/build_station.py -- assets/models/station.glb

The parked ship's centre is the origin (nose +Y). It rests on a circular landing pad
cantilevered off the station: support columns cradle the hull and engine pods, clamp jaws
grip them, and service posts plug umbilical hoses into the flanks.

Animated nodes the game relies on:
  Support_FL / Support_FR / Support_RL / Support_RR   cradle columns (retract down into the deck)
  Clamp_FL / Clamp_FR / Clamp_RL / Clamp_RR           clamp jaws (swing outward about the ship's long axis)
  Umbilical_L / Umbilical_R                           hoses (swing down to the deck on release)
  PadLights (material PadAmber)                       rim beacons that chase during launch
  Floodlight_L / Floodlight_R                         spotlight positions aimed at the ship
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SMOOTH, add_bevel, add_mirror, box, cubes, disk, empty, export_glb, finalize, lathe,
                    material, obj_from_bm, out_path, reset_scene, truss, tube)
import bmesh
from mathutils import Matrix, Vector

OUT = out_path("station.glb")
scene = reset_scene()

M = dict(
    deck=material("PadDeck", (0.36, 0.37, 0.39), 0.55, 0.5),
    hull=material("StationHull", (0.44, 0.45, 0.47), 0.5, 0.5),
    dark=material("StationDark", (0.07, 0.072, 0.08), 0.8, 0.4),
    hazard=material("Hazard", (0.85, 0.55, 0.05), 0.2, 0.5),
    window=material("Window", (0, 0, 0), 0.0, 0.5, emission=(1.0, 0.78, 0.5), strength=3.5),
    amber=material("PadAmber", (0, 0, 0), 0.0, 0.5, emission=(1.0, 0.55, 0.08), strength=6.0),
    ring=material("PadRing", (0, 0, 0), 0.0, 0.5, emission=(0.3, 0.85, 1.0), strength=3.0),
    lamp=material("Lamp", (0, 0, 0), 0.0, 0.5, emission=(1.0, 0.95, 0.85), strength=12.0),
    solar=material("SolarPanel", (0.02, 0.035, 0.1), 0.75, 0.22),
)

station = empty("Station")
DECK = -2.4          # top of the landing deck (ship centre is z = 0)
PAD_R = 11.0
HUB = Vector((0, -44.0, -9.0))


def M4(loc, size, rot=None):
    m = Matrix.Translation(loc)
    if rot:
        m = m @ rot
    return m @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))


# ------------------------------------------------------------------ round landing pad
pad = obj_from_bm("Pad", lathe([(0.6, DECK - 1.0), (PAD_R, DECK - 1.0), (PAD_R + 0.4, DECK - 0.7),
                                (PAD_R + 0.4, DECK - 0.2), (PAD_R + 0.1, DECK), (0.6, DECK)], 96, "Z",
                               closed=True), M["deck"], station)
SMOOTH["Pad"] = 30
under = obj_from_bm("PadUnderside", lathe([(PAD_R - 0.4, DECK - 1.0), (7.5, DECK - 3.0), (3.0, DECK - 4.4),
                                           (1.2, DECK - 4.8)], 64, "Z", caps=(False, True)), M["dark"], station)
SMOOTH["PadUnderside"] = 40
# deck markings: hazard ring and the glowing landing circle
obj_from_bm("HazardRing", lathe([(9.5, DECK - 0.01), (10.2, DECK - 0.01), (10.2, DECK + 0.025), (9.5, DECK + 0.025)],
                                96, "Z", closed=True), M["hazard"], station)
obj_from_bm("LandingRing", lathe([(5.3, DECK - 0.01), (5.55, DECK - 0.01), (5.55, DECK + 0.03), (5.3, DECK + 0.03)],
                                 96, "Z", closed=True), M["ring"], station)
# hazard chevrons across the launch lane in front of the nose
chev = []
for i in range(5):
    y = 7.2 + i * 0.75
    for sx in (-1, 1):
        chev.append(M4((sx * 0.55, y, DECK + 0.012), (1.3, 0.22, 0.03), Matrix.Rotation(sx * math.radians(35), 4, "Z")))
obj_from_bm("LaunchChevrons", cubes(bmesh.new(), chev), M["hazard"], station)
# rim beacons
lights = bmesh.new()
for k in range(28):
    a = 2 * math.pi * k / 28
    bmesh.ops.create_uvsphere(lights, u_segments=8, v_segments=5, radius=0.16,
                              matrix=Matrix.Translation((math.cos(a) * 10.75, math.sin(a) * 10.75, DECK + 0.05)))
obj_from_bm("PadLights", lights, M["amber"], station)
SMOOTH["PadLights"] = 80

# ------------------------------------------------------------------ cradle supports + clamp jaws
# front pair cradles the fuselage, rear pair cradles the engine pods
SUPPORTS = {"F": (1.15, 1.6, -0.62), "R": (1.95, -3.6, -0.66)}
for tag, (x, y, top) in SUPPORTS.items():
    for side, sx in (("L", -1), ("R", 1)):
        sup = empty(f"Support_{tag}{side}", station, (sx * x, y, DECK))
        h = top - DECK
        col = obj_from_bm(f"Column_{tag}{side}", lathe([(0.34, 0.0), (0.34, 0.3), (0.22, 0.5), (0.22, h - 0.25),
                                                       (0.3, h - 0.2), (0.3, h - 0.12)], 16, "Z"), M["hull"], sup)
        SMOOTH[col.name] = 45
        saddle = obj_from_bm(f"Saddle_{tag}{side}", box((0.62, 1.0, 0.12), (0, 0, h - 0.06)), M["dark"], sup)
        add_bevel(saddle, 0.03, 2)
        piston = obj_from_bm(f"Piston_{tag}{side}", lathe([(0.12, 0.3), (0.12, h - 0.3)], 10, "Z", center=(sx * 0.3, 0, 0)),
                             M["dark"], sup)
        # jaw hinge just outboard of the saddle; the jaw hugs the hull / engine pod side
        reach = 0.42 if tag == "F" else 0.78
        hinge = empty(f"Clamp_{tag}{side}", sup, (sx * reach, 0, h - 0.1))
        jaw_pts = [(0, 0, 0), (sx * 0.14, 0, 0.42), (sx * 0.05, 0, 0.82), (-sx * 0.14, 0, 1.0)] if tag == "F" else \
                  [(0, 0, 0), (sx * 0.1, 0, 0.3), (-sx * 0.02, 0, 0.55), (-sx * 0.16, 0, 0.66)]
        jaw = obj_from_bm(f"Jaw_{tag}{side}", tube(jaw_pts, 0.1, 8), M["hazard"], hinge)
        SMOOTH[jaw.name] = 45
        knuckle = obj_from_bm(f"Knuckle_{tag}{side}", lathe([(0.15, -0.3), (0.15, 0.3)], 12, "Y"), M["dark"], hinge)
        SMOOTH[knuckle.name] = 45

# ------------------------------------------------------------------ service posts + umbilicals
for side, sx in (("L", -1), ("R", 1)):
    base = (sx * 3.6, -0.6, DECK)
    post = obj_from_bm(f"ServicePost_{side}", cubes(bmesh.new(), [
        M4((base[0], base[1], DECK + 1.3), (0.5, 0.5, 2.6)),
        M4((base[0], base[1], DECK + 0.15), (0.9, 0.9, 0.3)),
    ]), M["hull"], station)
    add_bevel(post, 0.04, 2)
    stripe = obj_from_bm(f"PostStripe_{side}", box((0.52, 0.52, 0.3), (base[0], base[1], DECK + 2.2)), M["hazard"], station)
    piv = empty(f"Umbilical_{side}", station, (base[0], base[1], DECK + 2.6))
    hose = [(0, 0, 0), (-sx * 0.5, 0, 0.12), (-sx * 1.2, 0, 0.0), (-sx * 1.85, 0, -0.18)]
    hs = obj_from_bm(f"Hose_{side}", tube(hose, 0.1, 10), M["dark"], piv)
    SMOOTH[hs.name] = 70
    plug = obj_from_bm(f"Plug_{side}", box((0.22, 0.32, 0.32), (-sx * 1.95, 0, -0.2)), M["hazard"], piv)
    add_bevel(plug, 0.03, 2)

# ------------------------------------------------------------------ floodlight masts
for side, sx in (("L", -1), ("R", 1)):
    mx, my = sx * 9.8, -1.0
    obj_from_bm(f"Mast_{side}", tube([(mx, my, DECK), (mx, my, DECK + 6.0), (mx * 0.92, my * 0.92, DECK + 7.0)], 0.16, 8),
                M["dark"], station)
    head = obj_from_bm(f"FloodHead_{side}", box((0.9, 0.5, 0.5), (mx * 0.9, my * 0.9, DECK + 7.1)), M["hull"], station)
    add_bevel(head, 0.04, 2)
    obj_from_bm(f"FloodLens_{side}", disk(0.22, (mx * 0.9, my * 0.9 - 0.26, DECK + 7.1), 14), M["lamp"], station)
    empty(f"Floodlight_{side}", station, (mx * 0.9, my * 0.9 - 0.4, DECK + 7.1))

# ------------------------------------------------------------------ cantilever arm to the station
obj_from_bm("PadArm", truss((0, -6.0, DECK - 3.6), (0, HUB.y + 9.5, HUB.z + 1.0), 2.6, 9, 0.18), M["dark"], station)
SMOOTH["PadArm"] = 50
obj_from_bm("PadArm2", truss((0, -2.5, DECK - 4.6), (0, HUB.y + 9.5, HUB.z - 3.5), 1.8, 10, 0.13), M["dark"], station)
SMOOTH["PadArm2"] = 50

# ------------------------------------------------------------------ hub module
hub_prof = [(5.5, -38), (9.0, -35), (10.0, -32), (10.0, 32), (9.0, 35), (5.5, 38)]
bm = lathe(hub_prof, 48, "Y")
bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "Z"))
bmesh.ops.translate(bm, verts=bm.verts[:], vec=HUB)
obj_from_bm("Hub", bm, M["hull"], station)
SMOOTH["Hub"] = 40
for i, x in enumerate((-26, -14, -2, 10, 22)):
    for prof, mat, name in (([(10.02, x - 0.5), (10.08, x - 0.4), (10.08, x + 0.4), (10.02, x + 0.5)], M["window"], "WindowBand"),
                            ([(10.0, x + 1.4), (10.5, x + 1.6), (10.5, x + 2.6), (10.0, x + 2.8)], M["dark"], "HubRib")):
        bm = lathe(prof, 48, "Y", closed=True)
        bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, "Z"))
        bmesh.ops.translate(bm, verts=bm.verts[:], vec=HUB)
        o = obj_from_bm(f"{name}_{i}", bm, mat, station)
        SMOOTH[o.name] = 40
for sx in (-1, 1):
    port = lathe([(3.0, 0), (3.0, 2.5), (3.6, 2.7), (3.6, 3.5), (2.0, 3.8)], 24, "Y")
    bmesh.ops.rotate(port, verts=port.verts[:], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90 * sx), 3, "Z"))
    bmesh.ops.translate(port, verts=port.verts[:], vec=HUB + Vector((sx * 37.5, 0, 0)))
    p = obj_from_bm(f"EndPort_{sx}", port, M["dark"], station)
    SMOOTH[p.name] = 40
rad = obj_from_bm("Radiators", cubes(bmesh.new(), [M4(HUB + Vector((x, -3, 12.5)), (0.25, 9, 5)) for x in range(-24, 25, 6)]),
                  M["dark"], station)
add_bevel(rad, 0.05, 1)
dish = lathe([(0.3, 0), (2.5, 0.35), (4.5, 1.2), (5.0, 1.6)], 32, "Z", caps=(True, False),
             center=(HUB.x - 16, HUB.y - 2, HUB.z + 14))
obj_from_bm("Dish", dish, M["hull"], station)
SMOOTH["Dish"] = 50
obj_from_bm("DishMast", tube([(HUB.x - 16, HUB.y - 2, HUB.z + 9.6), (HUB.x - 16, HUB.y - 2, HUB.z + 14)], 0.35, 10),
            M["dark"], station)

# ------------------------------------------------------------------ solar wings
for sx in (-1, 1):
    obj_from_bm(f"Boom_{sx}", truss(HUB + Vector((sx * 38, 0, 0)), HUB + Vector((sx * 128, 0, 0)), 2.2, 14, 0.16),
                M["dark"], station)
    panels, frames = [], []
    for k in range(4):
        cx = HUB.x + sx * (50 + k * 21)
        for sz in (-1, 1):
            c = Vector((cx, HUB.y, HUB.z + sz * 9.5))
            panels.append(M4(c, (19, 0.18, 15)))
            frames.append(M4(c + Vector((0, 0, sz * 7.6)), (19.4, 0.3, 0.3)))
            frames.append(M4(c + Vector((sx * 9.6, 0, 0)), (0.3, 0.3, 15.4)))
    obj_from_bm(f"Solar_{sx}", cubes(bmesh.new(), panels), M["solar"], station)
    obj_from_bm(f"SolarFrame_{sx}", cubes(bmesh.new(), frames), M["hull"], station)

tris = finalize(scene)
print(f"[station] triangles: {tris}")
export_glb(OUT)
