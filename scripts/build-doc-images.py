#!/usr/bin/env python3
"""Turn the raw captures of `yarn screenshots` into the documentation images.

The screenshot harness (scripts/take-doc-screenshots.js) produces full VS Code
window captures in `doc-screenshots/`. The documentation of sfdx-hardis needs
them under specific names, and some of them as crops (a single menu entry, the
dependencies tree, the activity bar icon) or with arrow annotations.

Usage:
    python scripts/build-doc-images.py [--docs-images <path>] [--dry-run]

Default target: ../sfdx-hardis/docs/assets/images (the sibling repository that
hosts every image of both documentations).

Requires Pillow (`pip install pillow`).
"""

import argparse
import os
import shutil
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS_DIR = os.path.join(REPO_ROOT, "doc-screenshots")
DEFAULT_DOCS_IMAGES = os.path.abspath(
    os.path.join(REPO_ROOT, "..", "sfdx-hardis", "docs", "assets", "images")
)

# Side bar geometry of a capture: the first tree row is centered on y=85 and
# every next row is 27.5px lower (1920x982 capture, light theme, 125% display).
ROW_HEIGHT = 27.5
FIRST_ROW_Y = 85


def row_y(index):
    """Vertical center of the tree row at `index` (0 = first row of the view)."""
    return int(round(FIRST_ROW_Y + ROW_HEIGHT * index))


# --- Full window screenshots ------------------------------------------------
# doc image name -> capture name
FULL_SHOTS = {
    "welcome.png": "welcome",
    "data-workbench.png": "data-workbench",
    "files-workbench.png": "files-workbench",
    "documentation-workbench.png": "documentation-workbench",
    "devops-pipeline.png": "devops-pipeline",
    "org-monitoring.png": "org-monitoring",
    "dependencies-ok-ui.png": "setup",
    "install-dependencies-screenshot.png": "missing/setup",
    "ProductivityCommands.png": "command-runner-multiselect",
    "screenshot-work-save.png": "command-runner-completed",
    "command-runner.png": "command-runner-question",
}

# --- Crops of a single side bar row ----------------------------------------
# doc image name -> (capture, row index)
ROW_CROPS = {
    # CI/CD (advanced) expanded
    "btn-start-new-task.jpg": ("sidebar-commands-advanced", 3),
    "btn-save-publish-task.jpg": ("sidebar-commands-advanced", 5),
    "btn-reset-items.jpg": ("sidebar-commands-advanced", 6),
    "btn-clean-sources.jpg": ("sidebar-commands-advanced", 9),
    "btn-push-to-org.jpg": ("sidebar-commands-advanced", 10),
    "btn-pull-from-org.jpg": ("sidebar-commands-advanced", 11),
    # CI/CD (misc) expanded
    "btn-select-retrieve.jpg": ("sidebar-commands-misc", 16),
    "btn-reset-tracking.jpg": ("sidebar-commands-misc", 18),
    # Setup Configuration expanded
    "btn-configure-ci-auth.jpg": ("sidebar-commands-setup", 16),
    "btn-create-project.jpg": ("sidebar-commands-setup", 22),
    # Packaging expanded
    "btn-package-version.jpg": ("sidebar-commands-packaging", 19),
    # Status view of the default side bar
    "btn-open-org.jpg": ("sidebar", 12),
    "btn-select-org.jpg": ("sidebar", 15),
}

# --- Fixed-box crops --------------------------------------------------------
# doc image name -> (capture, (left, top, right, bottom))
BOX_CROPS = {
    "hardis-button.jpg": ("sidebar", (4, 304, 58, 358)),
    "dependencies-ok.jpg": ("sidebar-dependencies", (60, 99, 436, 462)),
}

# --- Animated recordings ----------------------------------------------------
# doc image name -> recording folder under doc-screenshots/recordings
RECORDINGS = {
    "orgs-manager.gif": "orgs-manager",
    "sfdx-hardis-pipeline-view.gif": "devops-pipeline",
    "metadata-retriever.gif": "metadata-retriever",
    "monitoring-config-2026.gif": "monitoring-config",
    "project-documentation.gif": "documentation-workbench",
    "extension-demo.gif": "welcome",
    "new-user-story-2026.gif": "work-new",
    "retrieve-and-commit-2026.gif": "work-save",
    "save-publish-pr-2026.gif": "work-publish",
}
GIF_WIDTH = 1280
GIF_FRAME_MS = 200
# A scenario ends with a long motionless pause; capping how long a single frame
# is displayed keeps the loop from freezing on it
GIF_MAX_FRAME_MS = 2500

RED = (215, 25, 30)
WHITE = (255, 255, 255)


def load(capture):
    path = os.path.join(SHOTS_DIR, capture + ".png")
    if not os.path.exists(path):
        return None
    return Image.open(path).convert("RGB")


def save(image, target, dry_run):
    print(
        f"  {'(dry-run) ' if dry_run else ''}{os.path.basename(target)} "
        f"{image.size[0]}x{image.size[1]}"
    )
    if dry_run:
        return
    if target.lower().endswith((".jpg", ".jpeg")):
        image.save(target, "JPEG", quality=92)
    else:
        image.save(target, "PNG")


def crop_row(image, index, left=72, padding=14):
    """Crops one side bar row, trimming the empty space after the label."""
    center = row_y(index)
    top, bottom = center - 13, center + 14
    band = image.crop((left, top, min(image.width, 428), bottom))
    # The most frequent color of the band is its background (the row is mostly
    # empty space); sampling a corner would pick up the scroll bar instead.
    background = max(band.getcolors(band.width * band.height))[1]
    right = band.width
    for x in range(band.width - 1, 0, -1):
        column = [band.getpixel((x, y)) for y in range(0, band.height, 3)]
        if any(
            abs(pixel[0] - background[0])
            + abs(pixel[1] - background[1])
            + abs(pixel[2] - background[2])
            > 40
            for pixel in column
        ):
            right = min(band.width, x + padding)
            break
    return band.crop((0, 0, right, band.height))


def build_gif(recording, target, dry_run):
    """Assembles a recording (frame-NNNN.png) into an animated GIF.

    Identical consecutive frames are merged into a single longer frame, which
    is what keeps the file small: most of a scenario is the UI standing still.
    """
    folder = os.path.join(SHOTS_DIR, "recordings", recording)
    if not os.path.isdir(folder):
        return False
    files = sorted(f for f in os.listdir(folder) if f.endswith(".png"))
    if not files:
        return False

    rgb_frames, durations = [], []
    previous_bytes = None
    for name in files:
        image = Image.open(os.path.join(folder, name)).convert("RGB")
        image = image.resize(
            (GIF_WIDTH, round(image.height * GIF_WIDTH / image.width)),
            Image.LANCZOS,
        )
        raw = image.tobytes()
        if raw == previous_bytes and durations:
            durations[-1] += GIF_FRAME_MS
            continue
        previous_bytes = raw
        rgb_frames.append(image)
        durations.append(GIF_FRAME_MS)

    durations = [min(duration, GIF_MAX_FRAME_MS) for duration in durations]

    # One palette shared by every frame: GIF then stores only the rectangle
    # that changed from one frame to the next, instead of a full key frame.
    palette = rgb_frames[0].quantize(colors=128, method=Image.MEDIANCUT)
    frames = [frame.quantize(palette=palette, dither=Image.NONE) for frame in rgb_frames]

    print(
        f"  {'(dry-run) ' if dry_run else ''}{os.path.basename(target)} "
        f"{frames[0].size[0]}x{frames[0].size[1]} "
        f"{len(frames)} frames (from {len(files)})"
    )
    if dry_run:
        return True
    frames[0].save(
        target,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=1,
    )
    return True


def font(size):
    for name in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def arrow(draw, start, end, width=26, head=52):
    """Draws a thick red arrow from `start` to `end` (horizontal or vertical)."""
    x0, y0 = start
    x1, y1 = end
    if y0 == y1:  # horizontal
        direction = 1 if x1 > x0 else -1
        shaft_end = x1 - direction * head
        draw.rectangle(
            [min(x0, shaft_end), y0 - width // 2, max(x0, shaft_end), y0 + width // 2],
            fill=RED,
        )
        draw.polygon(
            [
                (x1, y1),
                (shaft_end, y1 - head // 2),
                (shaft_end, y1 + head // 2),
            ],
            fill=RED,
        )
    else:  # vertical
        direction = 1 if y1 > y0 else -1
        shaft_end = y1 - direction * head
        draw.rectangle(
            [x0 - width // 2, min(y0, shaft_end), x0 + width // 2, max(y0, shaft_end)],
            fill=RED,
        )
        draw.polygon(
            [
                (x1, y1),
                (x1 - head // 2, shaft_end),
                (x1 + head // 2, shaft_end),
            ],
            fill=RED,
        )


def badge(draw, center, text):
    """Draws a numbered red disc, used to order the steps of a screenshot."""
    radius = 30
    x, y = center
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=RED)
    draw.text((x, y), text, fill=WHITE, font=font(38), anchor="mm")


def build_install_dependencies_highlight(welcome, target, dry_run):
    """Welcome page with the two steps of the dependencies installation."""
    image = welcome.copy()
    draw = ImageDraw.Draw(image)
    # 1. the SFDX Hardis icon in the activity bar
    arrow(draw, (300, 330), (70, 330))
    badge(draw, (350, 330), "1")
    # 2. the "Install Dependencies" button of the welcome page
    arrow(draw, (607, 330), (607, 110))
    badge(draw, (607, 380), "2")
    save(image, target, dry_run)


def build_dependencies_home_link(welcome, target, dry_run):
    """Welcome page (panel only) pointing at the Install Dependencies button."""
    image = welcome.crop((437, 0, welcome.width, welcome.height))
    draw = ImageDraw.Draw(image)
    arrow(draw, (170, 330), (170, 105))
    save(image, target, dry_run)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--docs-images", default=DEFAULT_DOCS_IMAGES)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.path.isdir(args.docs_images):
        sys.exit(f"Documentation images folder not found: {args.docs_images}")

    missing = []

    print("Full window screenshots:")
    for name, capture in FULL_SHOTS.items():
        image = load(capture)
        if image is None:
            missing.append(capture)
            continue
        save(image, os.path.join(args.docs_images, name), args.dry_run)

    print("Side bar row crops:")
    for name, (capture, index) in ROW_CROPS.items():
        image = load(capture)
        if image is None:
            missing.append(capture)
            continue
        save(crop_row(image, index), os.path.join(args.docs_images, name), args.dry_run)

    print("Box crops:")
    for name, (capture, box) in BOX_CROPS.items():
        image = load(capture)
        if image is None:
            missing.append(capture)
            continue
        save(image.crop(box), os.path.join(args.docs_images, name), args.dry_run)

    print("Annotated screenshots:")
    welcome = load("welcome")
    if welcome is None:
        missing.append("welcome")
    else:
        build_install_dependencies_highlight(
            welcome,
            os.path.join(args.docs_images, "install-dependencies-highlight.png"),
            args.dry_run,
        )
        build_dependencies_home_link(
            welcome,
            os.path.join(args.docs_images, "dependencies-home-link.png"),
            args.dry_run,
        )

    print("Animated recordings:")
    for name, recording in RECORDINGS.items():
        if not build_gif(
            recording, os.path.join(args.docs_images, name), args.dry_run
        ):
            missing.append(f"recordings/{recording}")

    if missing:
        print("\nMissing captures (run `yarn screenshots` first):")
        for capture in sorted(set(missing)):
            print(f"  {capture}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
