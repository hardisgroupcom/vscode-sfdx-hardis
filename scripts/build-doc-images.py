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
import sys

try:
    from PIL import Image, ImageDraw, ImageFont, ImageStat
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


# --- Panel screenshots ------------------------------------------------------
# doc image name -> capture name
PANEL_SHOTS = {
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

# Width of the activity bar + side bar in a capture: the editor area (the
# webview) starts right after the separator line at x=434.
SIDE_BAR_WIDTH = 435

# Images the documentation shows without the side bar, i.e. cropped to the
# webview only. The others keep the whole window, because the side bar is part
# of what they illustrate (the tree views, the menu entry to click).
WEBVIEW_ONLY = {
    "data-workbench.png",
    "files-workbench.png",
    "documentation-workbench.png",
    "devops-pipeline.png",
    "org-monitoring.png",
    "dependencies-ok-ui.png",
    "screenshot-work-save.png",
    "command-runner.png",
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
    # "My Pull Request" contribution card (pipeline-workflow-cards is captured
    # two zoom levels out so the second card row fits in the window)
    "card-my-pull-request.png": ("pipeline-workflow-cards", (1378, 750, 1630, 858)),
    # Branch modal of the pipeline, on its Deployment Actions tab
    "screenshot-deployment-actions.jpg": (
        "pipeline-branch-modal-actions",
        (470, 60, 1866, 810),
    ),
}

# --- Animated GIFs ------------------------------------------------------------
# doc GIF name -> recording folder in doc-screenshots/recordings/
# Frames are recorded at 5 fps by the harness (record() in
# src/test/ui/docScreenshots.test.ts); identical consecutive frames are merged
# into a single longer frame and every frame shares one global palette, which
# is what keeps these files small enough for a documentation page.
GIF_RECORDINGS = {
    "extension-demo.gif": "welcome",
    "sfdx-hardis-pipeline-view.gif": "devops-pipeline",
    "orgs-manager.gif": "orgs-manager",
    "metadata-retriever.gif": "metadata-retriever",
    "monitoring-config-2026.gif": "monitoring-config",
    "project-documentation.gif": "documentation-workbench",
    "new-user-story-2026.gif": "work-new",
    "retrieve-and-commit-2026.gif": "work-save",
    "save-publish-pr-2026.gif": "work-publish",
}

GIF_FRAME_MS = 200  # 5 fps

RED = (215, 25, 30)
WHITE = (255, 255, 255)


def load(capture):
    path = os.path.join(SHOTS_DIR, capture + ".png")
    if not os.path.exists(path):
        return None
    image = Image.open(path).convert("RGB")
    if is_blank(image):
        sys.exit(
            f"{path} is blank: the session was probably locked while capturing. "
            "Unlock it and run `yarn screenshots` again."
        )
    return image


def is_blank(image):
    """True when a capture holds no visible content (locked session, black screen).

    A locked session yields an almost entirely black frame, which still has a
    few bright pixels: the average brightness is what separates it from a real
    screenshot of the light theme.
    """
    return ImageStat.Stat(image.convert("L")).mean[0] < 24


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


def crop_to_webview(image):
    """Keeps only the editor area of a capture (no activity bar, no side bar)."""
    return image.crop((SIDE_BAR_WIDTH, 0, image.width, image.height))


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
    image = crop_to_webview(welcome)
    draw = ImageDraw.Draw(image)
    arrow(draw, (172, 330), (172, 105))
    save(image, target, dry_run)


def build_gif(recording, target, dry_run):
    """Assembles the frames of one recording into an optimized animated GIF.

    Consecutive identical frames are merged (their durations add up) and every
    frame is quantized against one shared palette: without both, a 20 second
    recording weighs tens of MB.
    """
    frames_dir = os.path.join(SHOTS_DIR, "recordings", recording)
    if not os.path.isdir(frames_dir):
        return False
    frame_files = sorted(
        os.path.join(frames_dir, name)
        for name in os.listdir(frames_dir)
        if name.lower().endswith(".png")
    )
    if len(frame_files) < 2:
        return False

    # Merge identical consecutive frames into (file, duration) pairs
    kept = []
    previous_bytes = None
    for frame_file in frame_files:
        with open(frame_file, "rb") as stream:
            content = stream.read()
        if content == previous_bytes:
            kept[-1][1] += GIF_FRAME_MS
        else:
            kept.append([frame_file, GIF_FRAME_MS])
        previous_bytes = content

    first = Image.open(kept[0][0]).convert("RGB")
    if is_blank(first):
        sys.exit(
            f"{kept[0][0]} is blank: the session was probably locked while "
            "recording. Unlock it and run `yarn screenshots` again."
        )
    # One global palette, computed on the first frame (the theme never changes
    # during a recording, so its colors represent the whole sequence well).
    palette = first.quantize(colors=255, method=Image.MEDIANCUT)

    images = []
    durations = []
    for frame_file, duration in kept:
        frame = Image.open(frame_file).convert("RGB")
        images.append(frame.quantize(palette=palette, dither=Image.NONE))
        durations.append(duration)

    print(
        f"  {'(dry-run) ' if dry_run else ''}{os.path.basename(target)} "
        f"{first.size[0]}x{first.size[1]} {len(images)} frames "
        f"({len(frame_files)} captured)"
    )
    if dry_run:
        return True
    images[0].save(
        target,
        "GIF",
        save_all=True,
        append_images=images[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )
    print(f"    -> {os.path.getsize(target) // 1024} KB")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--docs-images", default=DEFAULT_DOCS_IMAGES)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not os.path.isdir(args.docs_images):
        sys.exit(f"Documentation images folder not found: {args.docs_images}")

    missing = []

    print("Panel screenshots:")
    for name, capture in PANEL_SHOTS.items():
        image = load(capture)
        if image is None:
            missing.append(capture)
            continue
        if name in WEBVIEW_ONLY:
            image = crop_to_webview(image)
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

    print("Animated GIFs:")
    for name, recording in GIF_RECORDINGS.items():
        if not build_gif(recording, os.path.join(args.docs_images, name), args.dry_run):
            missing.append(f"recordings/{recording}")

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

    if missing:
        print("\nMissing captures (run `yarn screenshots` first):")
        for capture in sorted(set(missing)):
            print(f"  {capture}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
