#!/bin/sh
# Rebuild every model with headless Blender.
# Override the Blender path with: BLENDER=/path/to/blender ./blender/build_all.sh
set -e
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-tools/Blender.app/Contents/MacOS/Blender}"
"$BLENDER" -b --factory-startup -P blender/build_ship.py -- assets/models/ship.glb
"$BLENDER" -b --factory-startup -P blender/build_asteroids.py -- assets/models/asteroids.glb
"$BLENDER" -b --factory-startup -P blender/build_raider.py -- assets/models/raider.glb
"$BLENDER" -b --factory-startup -P blender/build_station.py -- assets/models/station.glb
"$BLENDER" -b --factory-startup -P blender/build_boss.py -- assets/models/boss.glb
# store normals and colours compactly (shapes unchanged; three.js reads it natively)
python3 blender/compact_glb.py assets/models/*.glb
echo "Models rebuilt in assets/models/"
