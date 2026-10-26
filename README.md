# chrislinesamc.github.io

Personal site of Chrisline Sam C. Plain static files: push to `master` and GitHub Pages serves them, no build step.

| Path | What |
|---|---|
| `index.html` | Home: who I am, highlights, selected work, papers, timeline, contact |
| `projects/*.html` | One page per project, each a scroll story followed by its paper |
| `assets/css/site.css` | Styles |
| `assets/js/neurons.js` | The neuron network behind every page: spikes travel along axons and set off neighbours |
| `assets/js/story.js` | Scroll stories: fades each `[data-beat]` in and out and reports the scroll position to the page's visual |
| `assets/js/brain.js` | Brain volumes rendered live with WebGL2, driven by scroll: FB74 behind the home page, the DHARANI growth story, the three ANCHOR brainstems and the C-Stroke brain (one choreography per page) |
| `assets/js/sequence.js` | Open the Mind page: scrubs a pre-rendered frame sequence (`assets/img/otm/seq/`) |
| `assets/js/tiles.js` | Registration page: the tile-by-tile algorithm, played on a Nissl section |
| `assets/js/site.js` | Smooth scroll (Lenis), reveal on scroll, nav state, copy buttons, local time |
| `assets/volumes/` | Brain volumes and their `volumes.json` (sizes, colour tables): DHARANI at the top level, `anchor/` and `cstroke/` in their own folders |
| `tools/volumes.py` | Rebuilds `assets/volumes/` from NIfTI files |
| `assets/img/logo.svg` | The logo: a brain in side view, folded cortex in front of the central sulcus and circuitry behind it (the folds grown by a reaction-diffusion simulation) |
| `assets/img/favicon.svg`, `apple-touch-icon.png` | The tab icon (the logo simplified so it reads at 16 px) and the home-screen icon |
| `data_portals.html`, `img/data_portals.html` | Targets of the printed poster's QR code: keep both at these paths |

## Adding a project

Copy one of the pages in `projects/`, keep its `[data-story]` section of `[data-beat]` blocks, and give it a visual that
listens to `Story.onChange(beat => …)`. Then add a card to the "Selected work" grid and a line to "Papers and posters"
in `index.html`.

## Rebuilding the brain volumes

The page plays the volumes in `assets/volumes/volumes.json` in order. To use other brains, rebuild that folder:

```
python tools/volumes.py assets/volumes FB40.nii.gz:FB40:14 FB74.nii.gz:FB74:17 FB34.nii.gz:FB34:21 FB62.nii.gz:FB62:22 FB85.nii.gz:FB85:24
```

Each argument is `<NIfTI file>:<id>:<label>` (a gestational week for DHARANI). The script reads RGB or 8-bit volumes with a white background
and uses each file's sform to orient them. The DHARANI files are public (CC BY 4.0) at
`s3://dharani-fetal-brain-atlas/data3d/` (`*_nisl_128mpp_rgb_masked.nii.gz`). With a different number of brains,
also change the week beats in `projects/dharani.html` (one `beat-short` block per brain), the `.gw` ticker list and the
`brain` track in `assets/js/brain.js`.

ANCHOR (the 9-year-old specimen's block-face volume, at its full 0.16 mm in-plane resolution) and C-Stroke (whole-brain histology) are greyscale on black, so they use the bright mode:

```
python tools/volumes.py assets/volumes/anchor --mode bright --max-dim 400 --lut ice --display-mm 72 --equalize yes --smooth 1 \
  --credit "..." HB25_bfi_ds.nii.gz:S2:"9 years"
python tools/volumes.py assets/volumes/cstroke --mode bright --max-dim 200 --lut teal --display-mm 72 \
  --credit "..." histo.nii.gz:HB02:"Case 1"
```

The source files are on the atlases' servers: `anchor.humanbrain.in/mri_bfi_data/…/bfi/` and
`c-stroke.humanbrain.in/store/3d-brain-data/histology_hb02cv/histo.nii.gz`.

## Testing locally

```
python3 -m http.server 8000
```

then open <http://localhost:8000/>. On the DHARANI page, add `?force3d` to run the WebGL brain even on a software
renderer, and `?scale=1` to render it at full resolution.
