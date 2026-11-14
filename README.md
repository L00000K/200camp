# House Designer

A browser-based 3D layout designer built around the 17 Dec 2021 scan of the house. It's plain HTML/JS (three.js, vendored), so it runs as a static site on GitHub Pages and needs no build step.

## What it does

- **Cleaned scan**: furniture and clutter are removed from the scan automatically. Walls, floor and ceiling are kept, and the gaps left in the floor are filled with a blended texture.
- **Tidy scan** tab: tools to finish the clean-up yourself.
  - **Erase / Restore brush**: paint over the scan to remove leftovers, or bring back parts the automatic pass removed. "Protect floor" stops you erasing the floor by mistake.
  - **Box**: move, resize or rotate a box, then remove or restore everything inside it.
  - **Remove floating bits**: removes small disconnected fragments.
  - **Show removed parts in red**, undo/redo, reset, and an export of the cleaned model as `.glb`.
- **Furniture** tab: about 40 parametric indoor and outdoor items (sofas, beds, tables, wardrobes, rugs, loungers, parasol, BBQ, planters, hot tub, plus basic boxes, partitions and doors). Drag items to move them. You can set width, depth, height, raise, rotation and colour.
- **Views**: 3D orbit, top-down **Plan**, and first-person **Walk**. The **Cut** slider slices off the top of the scan so you can see into rooms.
- **Floorplan** (Display tab): the listing floorplan is aligned to the scan. You can show it as a drawing in plan view, add clean walls extruded from it to the scan, or use the clean walls on their own with the plan drawn on the floor.
- **Measure** tool (`M`): click two points to get a distance.
- **Layouts**: keep several named layouts, duplicate them to try out ideas, and share them as a link or a `.json` file.

Your edits are saved in your browser's local storage.

## Publishing on GitHub Pages

1. Merge this branch into `main`.
2. In the repo, go to **Settings → Pages**, set **Source** to "Deploy from a branch", choose `main` and `/ (root)`, then save.
3. The site will appear at `https://<user>.github.io/200camp/`.

### Making your scan clean-up the default

Scan edits are saved per browser. To share your edits with everyone, go to **Tidy scan → Download clean-up (mask.bin)** and commit that file as `assets/mask.bin`. The app loads it in place of the automatic clean-up.

## Running locally

Browsers block module scripts from `file://`, so serve the folder:

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Files

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | The app |
| `js/furniture.js` | Furniture catalogue: add new items here |
| `js/scan.js` | Scan loading, visibility mask and tidy tools |
| `assets/scan.glb` | Original scan (unchanged) |
| `assets/labels.bin` | Per-triangle class from the automatic clean-up (0 clutter, 1 floor, 2 wall, 3 ceiling) |
| `assets/floorfill.glb` | Floor patch with an inpainted texture that fills the gaps under removed furniture |
| `assets/meta.json` | Floor height grid used to sit furniture on the floor |
| `tools/classify.py`, `tools/floorfill.py` | Scripts that generated the files above (Python, trimesh + scipy) |
| `js/floorplan.js`, `assets/floorplan.*` | Clean walls and overlay built from the floorplan |
| `tools/floorplan.py` | Extracts walls and windows from `tools/floorplan-source.png` using the fitted alignment in `tools/floorplan-align.json` |
| `vendor/` | three.js r170 and three-mesh-bvh (MIT) |
