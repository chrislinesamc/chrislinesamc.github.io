"""Build brain volumes for the site's WebGL renderer from NIfTI files.

usage: python tools/volumes.py <out_dir> [options] <file.nii.gz>:<id>:<label> [...]
e.g.   python tools/volumes.py assets/volumes FB40.nii.gz:FB40:14 FB74.nii.gz:FB74:17 ...      (DHARANI)
       python tools/volumes.py assets/volumes/anchor --mode bright --max-dim 200 --lut ice --display-mm 72 \
              --credit "..." S1.nii.gz:S1:"25 GW" S2.nii.gz:S2:"9 years" S3.nii.gz:S3:"54 years"

--mode stain   (default) RGB or 8-bit stained sections on a white background: density = 255 - luminance, and the
               colour table is the tissue's own mean colour. Block-averaged in-plane by 3 and across sections by 6.
--mode bright  8-bit volumes on a black background (block-face images, histology reconstructions): density = the
               intensity, coloured with a palette (--lut ice | teal). Block-averaged per axis to about --max-dim
               voxels along the longest side. --equalize yes evens out the brightness of each section;
               --smooth N blurs N passes of [1 2 1]/4 along each axis to take camera noise off the surfaces.
Each volume is reoriented with its sform so that u = left->right, v = inferior->superior, w = posterior->anterior,
cropped to the tissue and written as <id>.bin.gz (uint8, C order [w][v][u]). volumes.json lists them in the order
given: dims, spacing, size, colour table; "gw" when the label is a number, else "label". --display-mm sets the size
the renderer draws the largest volume at (relative sizes kept). Needs numpy.
"""
import gzip
import json
import os
import struct
import sys

import numpy as np

IN_PLANE_BLOCK, SECTION_BLOCK = 3, 6


def read_nifti(path):
    with gzip.open(path, "rb") as f:
        raw = f.read()
    e = "<" if struct.unpack("<i", raw[:4])[0] == 348 else ">"
    dim = struct.unpack(e + "8h", raw[40:56])
    dtype = struct.unpack(e + "h", raw[70:72])[0]
    pixdim = struct.unpack(e + "8f", raw[76:108])
    offset = int(struct.unpack(e + "f", raw[108:112])[0])
    srow = np.array(struct.unpack(e + "12f", raw[280:328])).reshape(3, 4)[:, :3]
    nx, ny, nz = dim[1:4]
    data = np.frombuffer(raw, np.uint8, offset=offset)
    if dtype == 128:                                            # RGB24: channels interleaved
        rgb = data[: nx * ny * nz * 3].reshape(nz, ny, nx, 3).transpose(3, 0, 1, 2)
    elif dtype == 2 and dim[0] == 5 and dim[5] == 3:            # uint8 with RGB as the 5th dimension
        rgb = data[: 3 * nx * ny * nz].reshape(3, nz, ny, nx)
    elif dtype == 2:                                            # 8-bit grey
        rgb = np.broadcast_to(data[: nx * ny * nz].reshape(1, nz, ny, nx), (3, nz, ny, nx))
    else:
        raise ValueError(f"{path}: unsupported datatype {dtype}")
    return rgb, srow, pixdim


def reorient(arr, srow, spacing_ijk):
    """arr axes (k, j, i) -> (w, v, u), each voxel axis going to its dominant world axis (R -> u, S -> v, A -> w)."""
    array_axis = {0: 2, 1: 1, 2: 0}                              # voxel axis -> axis of `arr` (k, j, i)
    target = {0: 2, 2: 1, 1: 0}                                  # world axis -> output axis (w, v, u)
    perm, flips, spacing = [None] * 3, [], [None] * 3
    for vox in range(3):
        world = int(np.argmax(np.abs(srow[:, vox])))
        perm[target[world]] = array_axis[vox]
        if srow[world, vox] < 0:
            flips.append(target[world])
        spacing[2 - target[world]] = float(spacing_ijk[vox])
    arr = np.transpose(arr, perm)
    for a in flips:
        arr = np.flip(arr, a)
    idx = np.argwhere(arr > 6)
    lo, hi = np.maximum(idx.min(0) - 2, 0), np.minimum(idx.max(0) + 3, arr.shape)
    return np.ascontiguousarray(arr[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]), spacing


PALETTES = {                                                     # (position, colour) stops for --mode bright
    "ice": [(0, (64, 56, 128)), (0.5, (172, 164, 232)), (0.85, (226, 222, 250)), (1, (248, 246, 255))],
    "teal": [(0, (6, 52, 46)), (0.45, (26, 150, 128)), (0.8, (128, 226, 196)), (1, (228, 252, 240))],
}


def palette(name):
    stops = PALETTES[name]
    x = np.linspace(0, 1, 256)
    return np.stack([np.interp(x, [s[0] for s in stops], [s[1][c] for s in stops]) for c in range(3)], 1).astype(np.uint8)


def equalize(grey, px):
    """Block-face stacks: every section is lit a little differently. Scale each section (along the finest axis, the
    one it was cut along) so its median tissue brightness matches the whole stack's."""
    axis = 2 - int(np.argmin(px))                                # spacing (i, j, k) -> array axis (k, j, i)
    g = np.moveaxis(grey, axis, 0).astype(np.float32)
    tissue = g[g >= 10]
    target = np.median(tissue)
    for s in range(g.shape[0]):
        sl = g[s]
        m = sl >= 10
        if m.sum() > 50:
            sl[m] = np.clip(sl[m] * (target / np.median(sl[m])), 10, 255)
    return np.moveaxis(g, 0, axis)


def smooth(a, passes):
    """Binomial [1, 2, 1] / 4 blur along each axis, `passes` times: takes the camera noise off block-face surfaces."""
    for _ in range(passes):
        for ax in range(3):
            p = np.pad(a, [(1, 1) if i == ax else (0, 0) for i in range(3)], mode="edge")
            s = [slice(None)] * 3
            lo, mid, hi = (tuple(s[:ax] + [slice(o, o + a.shape[ax])] + s[ax + 1:]) for o in (0, 1, 2))
            a = 0.25 * p[lo] + 0.5 * p[mid] + 0.25 * p[hi]
    return a


def prepare_bright(path, max_dim, lut_name, even=False, passes=0):
    rgb, srow, pixdim = read_nifti(path)
    grey = rgb[0]                                                # (k, j, i); grey volumes repeat one channel
    nz, ny, nx = grey.shape
    px = np.abs(np.array([pixdim[1], pixdim[2], pixdim[3]]))      # spacing along i, j, k
    if even:
        grey = equalize(grey, px)
    target_mm = max(nx * px[0], ny * px[1], nz * px[2]) / max_dim
    bi, bj, bk = (max(1, int(round(target_mm / s))) for s in px)
    NZ, NY, NX = nz // bk, ny // bj, nx // bi
    dens = np.zeros((NZ, NY, NX), np.float32)
    for z in range(NZ):                                          # one slab of sections at a time
        c = grey[z * bk:(z + 1) * bk, : NY * bj, : NX * bi].astype(np.float32)
        c[c < 10] = 0                                            # background
        dens[z] = c.reshape(bk, NY, bj, NX, bi).mean((0, 2, 4))
    if passes:
        dens = smooth(dens, passes)
    scale = 235.0 / np.percentile(dens[dens > 4], 99.5)          # tissue 99.5th percentile -> 235
    dens = np.clip(dens * scale, 0, 255).astype(np.uint8)
    arr, spacing = reorient(dens, srow, [px[0] * bi, px[1] * bj, px[2] * bk])
    return arr, spacing, palette(lut_name)


def prepare(path):
    rgb, srow, pixdim = read_nifti(path)
    _, nz, ny, nx = rgb.shape
    bi, bk = IN_PLANE_BLOCK, SECTION_BLOCK
    NZ, NY, NX = nz // bk, ny // bi, nx // bi
    dens = np.zeros((NZ, NY, NX), np.float32)
    hist_n, hist_rgb = np.zeros(256), np.zeros((256, 3))
    rng = np.random.default_rng(0)
    for z in range(NZ):                                         # one slab of sections at a time
        c = rgb[:, z * bk:(z + 1) * bk, : NY * bi, : NX * bi].astype(np.float32)
        d = 255.0 - (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
        tissue = np.any(c < 250, 0)
        d[~tissue] = 0
        dens[z] = d.reshape(bk, NY, bi, NX, bi).mean((0, 2, 4))
        idx = np.flatnonzero(tissue)
        if len(idx):
            idx = rng.choice(idx, min(len(idx), 20000), replace=False)
            di = np.clip(d.reshape(-1)[idx], 0, 255).astype(int)
            np.add.at(hist_n, di, 1)
            for k in range(3):
                np.add.at(hist_rgb[:, k], di, c[k].reshape(-1)[idx])

    scale = 235.0 / np.percentile(dens[dens > 4], 99.5)         # tissue 99.5th percentile -> 235
    dens = np.clip(dens * scale, 0, 255).astype(np.uint8)
    have = hist_n > 20
    lut = np.stack([np.interp(np.arange(256), np.arange(256)[have] * scale, hist_rgb[have, k] / hist_n[have])
                    for k in range(3)], 1)
    lut = np.stack([np.convolve(np.pad(lut[:, k], 4, mode="edge"), np.ones(9) / 9, "valid") for k in range(3)], 1)
    lut = np.clip(lut, 0, 255).astype(np.uint8)

    arr, spacing = reorient(dens, srow, [pixdim[1] * bi, pixdim[2] * bi, pixdim[3] * bk])
    return arr, spacing, lut


def main():
    out_dir, args = sys.argv[1], sys.argv[2:]
    opts = {"--mode": "stain", "--max-dim": "200", "--lut": "ice", "--display-mm": None, "--equalize": "no", "--smooth": "0",
            "--credit": "DHARANI 3D Nissl reconstructions, Sudha Gopalakrishnan Brain Centre, IIT Madras "
                        "(Verma et al., J Comp Neurol 2025), CC BY 4.0. Downsampled for the web."}
    specs = []
    while args:
        a = args.pop(0)
        if a in opts:
            opts[a] = args.pop(0)
        else:
            specs.append(a)
    os.makedirs(out_dir, exist_ok=True)
    volumes = []
    for spec in specs:
        path, vid, label = spec.rsplit(":", 2)
        if opts["--mode"] == "bright":
            arr, spacing, lut = prepare_bright(path, int(opts["--max-dim"]), opts["--lut"], opts["--equalize"] == "yes", int(opts["--smooth"]))
        else:
            arr, spacing, lut = prepare(path)
        W, V, U = arr.shape
        with gzip.open(os.path.join(out_dir, vid + ".bin.gz"), "wb", compresslevel=9) as f:
            f.write(arr.tobytes())
        tag = {"gw": int(label)} if label.isdigit() else {"label": label}
        volumes.append(dict(id=vid, **tag, dims=[U, V, W], spacing_mm=[round(s, 4) for s in spacing],
                            size_mm=[round(n * s, 2) for n, s in zip((U, V, W), spacing)],
                            lut="".join(f"{r:02x}{g:02x}{b:02x}" for r, g, b in lut),
                            source=os.path.basename(path), file=vid + ".bin.gz"))
        print(f"{vid}: {U}x{V}x{W} voxels, {volumes[-1]['size_mm']} mm")
    index = dict(axes="u: left->right, v: inferior->superior, w: posterior->anterior; uint8 C order [w][v][u], gzip",
                 credit=opts["--credit"], volumes=volumes)
    if opts["--display-mm"]:
        index["display_mm"] = float(opts["--display-mm"])
    json.dump(index, open(os.path.join(out_dir, "volumes.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
