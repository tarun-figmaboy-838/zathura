"""Shared helpers for the headless Blender build scripts.

Blender axes used while modelling: +Y = ship nose, +Z = up, +X = starboard.
The glTF exporter converts to Y-up, so in Three.js the nose points to -Z.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Matrix


def out_path(default_name):
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    here = os.path.dirname(os.path.abspath(__file__))
    path = args[0] if args else os.path.join(here, "..", "assets", "models", default_name)
    return os.path.abspath(path)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


# ------------------------------------------------------------------ materials
def _principled(mat):
    nt = mat.node_tree
    for n in nt.nodes:
        if n.type == "BSDF_PRINCIPLED":
            return n
    out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if out is None:
        out = nt.nodes.new("ShaderNodeOutputMaterial")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return b


def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0,
             vertex_color=False):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = _principled(m)
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if emission is not None:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    if vertex_color:
        attr = m.node_tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        m.node_tree.links.new(attr.outputs["Color"], b.inputs["Base Color"])
    m.diffuse_color = (*color, 1.0)
    return m


# ------------------------------------------------------------------ objects
def link(ob, parent=None, loc=(0, 0, 0)):
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = loc
    return ob


def obj_from_bm(name, bm, mat, parent=None, loc=(0, 0, 0)):
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if mat is not None:
        me.materials.append(mat)
    return link(bpy.data.objects.new(name, me), parent, loc)


def empty(name, parent=None, loc=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"
    return link(ob, parent, loc)


# ------------------------------------------------------------------ geometry
def bridge_rings(bm, rings, closed_profile=False, cap_start=True, cap_end=True):
    n = len(rings[0])
    pairs = list(zip(rings, rings[1:]))
    if closed_profile:
        pairs.append((rings[-1], rings[0]))
    for r0, r1 in pairs:
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    if not closed_profile:
        if cap_start:
            bm.faces.new(rings[0])
        if cap_end:
            bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def superellipse(w, h, p, a):
    c, s = math.cos(a), math.sin(a)
    return (w * math.copysign(abs(c) ** (2.0 / p), c),
            h * math.copysign(abs(s) ** (2.0 / p), s))


def loft(stations, segs=32):
    """stations: (y, half_width, half_height, z_center, squareness[, x_center])."""
    bm = bmesh.new()
    rings = []
    for st in stations:
        y, w, h, zc, p = st[:5]
        xc = st[5] if len(st) > 5 else 0.0
        ring = []
        for i in range(segs):
            x, z = superellipse(w, h, p, 2 * math.pi * i / segs)
            ring.append(bm.verts.new((xc + x, y, zc + z)))
        rings.append(ring)
    bridge_rings(bm, rings)
    return bm


def lathe(profile, segs=32, axis="Y", closed=False, caps=(True, True), phase=0.0,
          center=(0, 0, 0), scale=(1, 1)):
    """Revolve (radius, height) pairs around the Y or Z axis."""
    bm = bmesh.new()
    rings = []
    cx, cy, cz = center
    for (r, h) in profile:
        ring = []
        for i in range(segs):
            a = phase + 2 * math.pi * i / segs
            u, v = r * math.cos(a) * scale[0], r * math.sin(a) * scale[1]
            co = (u, h, v) if axis == "Y" else (u, v, h)
            ring.append(bm.verts.new((co[0] + cx, co[1] + cy, co[2] + cz)))
        rings.append(ring)
    bridge_rings(bm, rings, closed_profile=closed, cap_start=caps[0], cap_end=caps[1])
    return bm


def box(size, center=(0, 0, 0), shape=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        if shape:
            shape(v)
        v.co += Vector(center)
    return bm


def disk(radius, center, segs=32, facing="-Y"):
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=segs, radius=radius)
    rot = {"-Y": Matrix.Rotation(math.radians(90), 3, "X"),
           "+Z": Matrix.Identity(3)}[facing]
    bmesh.ops.rotate(bm, verts=bm.verts[:], cent=(0, 0, 0), matrix=rot)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=Vector(center))
    return bm


def tube(points, radius, segs=8, caps=True, bm=None):
    """Sweep a round pipe along a polyline (parallel-transport frames, no twisting).
    Pass bm to append into an existing bmesh."""
    pts = [Vector(p) for p in points]
    bm = bm or bmesh.new()
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_n is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(ref).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        b = t.cross(n)
        prev_n = n
        rings.append([bm.verts.new(p + (n * math.cos(2 * math.pi * k / segs) + b * math.sin(2 * math.pi * k / segs)) * radius)
                      for k in range(segs)])
    bridge_rings(bm, rings, cap_start=caps, cap_end=caps)
    return bm


def truss(p0, p1, width, bays, radius=0.12, bm=None):
    """Square lattice girder from p0 to p1: four chords, rings and diagonals per bay."""
    p0, p1 = Vector(p0), Vector(p1)
    axis = p1 - p0
    length = axis.length
    t = axis.normalized()
    ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
    n = t.cross(ref).normalized()
    b = t.cross(n)
    corners = [(n + b) * width / 2, (n - b) * width / 2, (-n - b) * width / 2, (-n + b) * width / 2]
    bm = bm or bmesh.new()
    for c in corners:
        tube([p0 + c, p1 + c], radius, 6, True, bm)
    for k in range(bays):
        a0 = p0 + t * (length * k / bays)
        a1 = p0 + t * (length * (k + 1) / bays)
        for i in range(4):
            c0, c1 = corners[i], corners[(i + 1) % 4]
            tube([a0 + c0, a1 + c1], radius * 0.6, 5, True, bm)
            tube([a0 + c0, a0 + c1], radius * 0.6, 5, True, bm)
    return bm


def cubes(bm, mats):
    """Add one unit cube per 4x4 matrix into bm (fast way to build many greeble parts)."""
    for m in mats:
        bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    return bm


def blade(root_le, tip_le, chord_root, chord_tip, t_root, t_tip):
    """Tapered 6-sided airfoil between a root and a tip section (chord runs along -Y)."""
    root_le, tip_le = Vector(root_le), Vector(tip_le)
    span = tip_le - root_le
    span.y = 0
    tdir = Vector((0, 1, 0)).cross(span).normalized()
    Y = Vector((0, 1, 0))
    bm = bmesh.new()
    rings = []
    for le, chord, t in ((root_le, chord_root, t_root), (tip_le, chord_tip, t_tip)):
        pts = [le,
               le - Y * chord * 0.22 + tdir * t / 2,
               le - Y * chord * 0.65 + tdir * t / 2,
               le - Y * chord,
               le - Y * chord * 0.65 - tdir * t / 2,
               le - Y * chord * 0.22 - tdir * t / 2]
        rings.append([bm.verts.new(p) for p in pts])
    bridge_rings(bm, rings)
    return bm


def blade_band(root_le, tip_le, cr, ct, tr, tt, f0, f1, grow=0.025):
    """A slightly oversized slice of a blade between span fractions f0..f1 (livery bands)."""
    root_le, tip_le = Vector(root_le), Vector(tip_le)
    lerp = lambda a, b, f: a + (b - a) * f
    a_le, b_le = root_le.lerp(tip_le, f0), root_le.lerp(tip_le, f1)
    a_le.y += grow
    b_le.y += grow
    return blade(a_le, b_le, lerp(cr, ct, f0) + grow * 2, lerp(cr, ct, f1) + grow * 2,
                 lerp(tr, tt, f0) + grow, lerp(tr, tt, f1) + grow)


# ------------------------------------------------------------------ modifiers
SMOOTH = {}


def add_mirror(ob):
    m = ob.modifiers.new("Mirror", "MIRROR")
    m.use_axis[0] = True
    m.use_mirror_merge = True
    m.merge_threshold = 0.001
    return ob


def add_bevel(ob, width=0.03, segments=3, angle=30):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = True
    return ob


def add_subsurf(ob, levels=2):
    m = ob.modifiers.new("Subsurf", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    return ob


def shade(me, angle_deg):
    if hasattr(me, "shade_smooth"):
        me.shade_smooth()
    else:
        for p in me.polygons:
            p.use_smooth = True
    if hasattr(me, "set_sharp_from_angle"):
        me.set_sharp_from_angle(angle=math.radians(angle_deg))


def finalize(scene):
    """Apply every modifier and set smooth-by-angle shading so the export is exact."""
    tris = 0
    for ob in [o for o in scene.objects if o.type == "MESH"]:
        if ob.modifiers:
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg),
                                                 preserve_all_data_layers=True, depsgraph=dg)
            old = ob.data
            ob.modifiers.clear()
            ob.data = me
            me.name = ob.name
            if not me.materials:
                for m in old.materials:
                    me.materials.append(m)
        shade(ob.data, SMOOTH.get(ob.name, 35.0))
        tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return tris


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    wanted = dict(filepath=path, export_format="GLB", export_apply=True, export_yup=True,
                  export_extras=False, export_cameras=False, export_lights=False,
                  export_vertex_color="ACTIVE", export_texcoords=False)
    kw = {k: v for k, v in wanted.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)
    print(f"[export] {path}  ({os.path.getsize(path) / 1024:.0f} KB)")
