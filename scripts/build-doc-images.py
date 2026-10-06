#!/usr/bin/env python3
"""Turn the raw captures of `yarn screenshots` into the documentation images.

The screenshot harness (scripts/take-doc-screenshots.js) produces full VS Code
window captures in `doc-screenshots/`. The documentation of sfdx-hardis needs
them under specific names, and some of them as crops (a single menu entry, the
dependencies tree, the activity bar icon) or with arrow annotations.

Usage:
    python scripts/build-doc-images.py [--docs-images <path>] [--dry-run]
    python scripts/build-doc-images.py --gif sfdx-hardis-pipeline-view.gif

Default target: ../sfdx-hardis/docs/assets/images (the sibling repository that
hosts every image of both documentations).

Requires Pillow (`pip install pillow`).
"""

import argparse
import json
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat
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
    "metadata-dependencies.png": "metadata-dependencies",
    "documentation-workbench.png": "documentation-workbench",
    "devops-pipeline.png": "devops-pipeline",
    "org-monitoring.png": "org-monitoring",
    "dependencies-ok-ui.png": "setup",
    "install-dependencies-screenshot.png": "missing/setup",
    "ProductivityCommands.png": "user-activateinvalid-multiselect",
    "command-runner.png": "command-runner-question",
    "installed-packages.png": "installed-packages",
    "pipeline-config.png": "pipeline-config",
    "backpromote.png": "backpromote",
    "backpromote-what.png": "backpromote-what",
    "backpromote-merge-all.png": "backpromote-merge-all",
    "backpromote-result.png": "backpromote-result",
    "backpromote-loading.png": "backpromote-loading",
    "backpromote-running.png": "backpromote-running",
    "backpromote-deploy-failed.png": "backpromote-deploy-failed",
    "backpromote-resumed.png": "backpromote-resumed",
    # Promotion branches (Beta), taken by the promotion variant of the
    # run into doc-screenshots/promotion (see CONTRIBUTING.md)
    "promotion-pipeline.png": "promotion/promotion-pipeline",
    "promotion-settings.png": "promotion/promotion-settings",
}

# Width of the activity bar + side bar in a capture: the editor area (the
# webview) starts right after the separator line at x=434.
SIDE_BAR_WIDTH = 435

# Images the documentation shows without the side bar, i.e. cropped to the
# webview only. The others keep the whole window, because the side bar is part
# of what they illustrate (the tree views, the menu entry to click).
WEBVIEW_ONLY = {
    "welcome.png",
    "ProductivityCommands.png",
    "install-dependencies-screenshot.png",
    "data-workbench.png",
    "files-workbench.png",
    "metadata-dependencies.png",
    "documentation-workbench.png",
    "devops-pipeline.png",
    "org-monitoring.png",
    "dependencies-ok-ui.png",
    "command-runner.png",
    "installed-packages.png",
    "pipeline-config.png",
    "promotion-pipeline.png",
    "promotion-settings.png",
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
    "card-my-pull-request.png": ("pipeline-workflow-cards", (1378, 698, 1630, 806)),
    # The whole "Project Contribution Workflow" card row (same zoomed-out
    # capture), for the Contributor Guide overview
    "pipeline-contribution-cards.png": ("pipeline-workflow-cards", (312, 636, 1910, 818)),
    # Branch modal of the pipeline, on its Pull Requests tab (merged Pull
    # Requests of the branch, with the Release Notes buttons)
    "screenshot-branch-pull-requests.jpg": (
        "pipeline-branch-modal",
        (470, 60, 1866, 915),
    ),
    # Deployment Actions tab of the "My Pull Request" modal of the feature
    # pull request #128 (one zoom level out, opened through the
    # hardis:work:save deep link), listing the actions of its fixture file
    "screenshot-pr-deployment-actions-list.jpg": (
        "pipeline-pr-actions-list",
        (401, 40, 1863, 922),
    ),
    # Branch modal of the pipeline, on its Deployment Actions tab
    "screenshot-deployment-actions.jpg": (
        "pipeline-branch-modal-actions",
        (470, 60, 1866, 915),
    ),
    # "Edit Deployment Action" editor, opened from the PR modal (captured two
    # zoom levels out, like pipeline-workflow-cards)
    "screenshot-edit-deployment-action.jpg": (
        "pipeline-edit-action",
        (760, 264, 1462, 706),
    ),
    # One pre-filled "Edit Deployment Action" editor per action type, for
    # salesforce-devops-work-on-user-story-deployment-actions.md (same zoomed-out
    # captures; the modal height depends on the action type)
    "screenshot-deployment-action-command.jpg": (
        "pipeline-edit-action-command",
        (760, 263, 1462, 704),
    ),
    "screenshot-deployment-action-data.jpg": (
        "pipeline-edit-action-data",
        (760, 264, 1462, 703),
    ),
    "screenshot-deployment-action-apex.jpg": (
        "pipeline-edit-action-apex",
        (760, 264, 1462, 703),
    ),
    "screenshot-deployment-action-manual.jpg": (
        "pipeline-edit-action-manual",
        (760, 222, 1462, 746),
    ),
    "screenshot-deployment-action-schedule-batch.jpg": (
        "pipeline-edit-action-schedule-batch",
        (760, 195, 1462, 772),
    ),
    "screenshot-deployment-action-run-batch.jpg": (
        "pipeline-edit-action-run-batch",
        (760, 216, 1462, 742),
    ),
    "screenshot-deployment-action-publish-community.jpg": (
        "pipeline-edit-action-publish-community",
        (760, 264, 1462, 703),
    ),
    "screenshot-deployment-action-remove-packagexml-items.jpg": (
        "pipeline-edit-action-remove-packagexml-items",
        (760, 239, 1462, 728),
    ),
    # Security & Privacy tab of the Pipeline Settings panel, in edit mode: the
    # anonymization editor of SECURITY.md (captured two zoom levels out, so the
    # three levels, the local runs toggle and the four channels all fit)
    "screenshot-anonymization-config.jpg": (
        "anonymization-config-edit",
        (312, 28, 1905, 900),
    ),
    # Same editor with the "Target orgs" field restricting the action, for the
    # "Choose the target orgs" section (the branch selector makes it taller)
    "screenshot-deployment-action-target-orgs-include.jpg": (
        "pipeline-edit-action-target-orgs-include",
        (760, 144, 1462, 823),
    ),
    "screenshot-deployment-action-target-orgs-exclude.jpg": (
        "pipeline-edit-action-target-orgs-exclude",
        (760, 144, 1462, 823),
    ),
    # Promotion branches (experimental): the uat window with the User Stories
    # ticked and the Create promotion button, and the modal of the promotion
    # Pull Request on its Deployment Actions tab
    "promotion-branch-modal.png": (
        "promotion/promotion-branch-modal",
        (470, 60, 1866, 915),
    ),
    "promotion-pr-modal.png": (
        "promotion/promotion-pr-modal",
        (470, 60, 1866, 915),
    ),
}

# --- VS Code user guides -----------------------------------------------------
# The step-by-step pages of sfdx-hardis (docs/vscode-extension-*.md) show each
# panel in the states a user meets. They land in docs/assets/images/vscode-guide/,
# where scripts/annotate-doc-images.mjs of sfdx-hardis draws the numbered pills
# on copies. Pill positions are percentages of these images: changing a crop
# moves every pill, so check docs/assets/annotations.json after such a change.
# doc image name -> (capture name, crop): True crops to the webview, a tuple is
# a (left, top, right, bottom) box. The captures taken zoomed out (the pipeline
# cards and modals) have a narrower side bar than SIDE_BAR_WIDTH, so they are
# cropped to the part the step is about.
GUIDE_SHOTS = {
    "welcome.png": ("welcome", True),
    "welcome-language-menu.png": ("welcome-language-menu", True),
    "devops-pipeline.png": ("devops-pipeline", True),
    "pipeline-settings-menu.png": ("pipeline-settings-menu", True),
    "pipeline-packages-menu.png": ("pipeline-packages-menu", True),
    # The No Overwrite entry of that menu: package-no-overwrite.xml in the package viewer, for the
    # overwrite management page of sfdx-hardis
    "package-no-overwrite.png": ("package-no-overwrite", True),
    "pipeline-workflow-cards.png": ("pipeline-workflow-cards", (315, 625, 1905, 835)),
    "pipeline-pr-actions-list.png": ("pipeline-pr-actions-list", (400, 40, 1865, 922)),
    # Pull Requests explorer and the window of one Pull Request (sfdx-hardis#2273), opened by
    # deep links: the lookup, the description, a comment tab and a merged Pull Request
    "pipeline-pr-explorer.png": ("pipeline-pr-explorer", True),
    "pipeline-pr-view-general.png": ("pipeline-pr-view-general", True),
    "pipeline-pr-view-validation.png": ("pipeline-pr-view-validation", True),
    "pipeline-pr-view-merged.png": ("pipeline-pr-view-merged", True),
    "pipeline-branch-modal-actions.png": ("pipeline-branch-modal-actions", True),
    "org-monitoring.png": ("org-monitoring", True),
    "org-monitoring-packages-menu.png": ("org-monitoring-packages-menu", True),
    "command-runner-question.png": ("command-runner-question", True),
    "command-runner-multiselect.png": ("command-runner-multiselect", True),
    "command-runner-completed.png": ("command-runner-completed", True),
    "orgs-manager.png": ("orgs-manager", True),
    "orgs-manager-row-menu.png": ("orgs-manager-row-menu", True),
    "metadata-retriever.png": ("metadata-retriever", True),
    "metadata-retriever-row-menu.png": ("metadata-retriever-row-menu", True),
    "metadata-retriever-presets.png": ("metadata-retriever-presets", True),
    "metadata-dependencies.png": ("metadata-dependencies", True),
    "metadata-dependencies-uses.png": ("metadata-dependencies-uses", True),
    "metadata-dependencies-row-menu.png": ("metadata-dependencies-row-menu", True),
    "data-workbench.png": ("data-workbench", True),
    "data-workbench-create.png": ("data-workbench-create", True),
    "data-workbench-object-editor.png": ("data-workbench-object-editor", True),
    "data-workbench-global-settings.png": ("data-workbench-global-settings", True),
    "files-workbench.png": ("files-workbench", True),
    "files-workbench-create.png": ("files-workbench-create", True),
    "files-workbench-edit.png": ("files-workbench-edit", True),
    "extension-config.png": ("extension-config", True),
}
GUIDE_FOLDER = "vscode-guide"

# --- Animated GIFs ------------------------------------------------------------
# doc GIF name -> recording folder in doc-screenshots/recordings/
# Frames are recorded at 5 fps by the harness (record() in
# src/test/ui/docScreenshots.test.ts); identical consecutive frames are merged
# into a single longer frame and every frame shares one global palette, which
# is what keeps these files small enough for a documentation page.
GIF_RECORDINGS = {
    "sfdx-hardis-pipeline-view.gif": "devops-pipeline",
    "orgs-manager.gif": "orgs-manager",
    "metadata-retriever.gif": "metadata-retriever",
    "monitoring-config-2026.gif": "monitoring-config",
    "project-documentation.gif": "documentation-workbench",
    "new-user-story-2026.gif": "work-new",
    "save-publish-pr-2026.gif": "work-save",
    "animation-install-packages.gif": "install-packages",
    # VS Code user guides: one GIF at the top of each panel's page
    "welcome.gif": "welcome",
    "org-monitoring.gif": "org-monitoring",
    "command-runner.gif": "command-runner",
    "metadata-dependencies.gif": "metadata-dependencies",
    "data-workbench.gif": "data-workbench",
    "files-workbench.gif": "files-workbench",
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


def font(size, bold=True):
    names = (
        ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf")
        if bold
        else ("segoeui.ttf", "arial.ttf", "DejaVuSans.ttf")
    )
    for name in names:
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


# --- Scripted recordings ------------------------------------------------------
# A recording whose recording.json carries a timeline (record() of the harness,
# with caption(), cut() and its clicks) is assembled from it: a bubble next to
# what each caption is about, with a frame around it, a drawn pointer that goes
# to each click, the hidden ranges cut out, stills shown in their place, an
# opening laid over the first seconds and a card at the end.
# Colors of the Cloudity banner
CLOUDITY_BLUE = (0, 85, 255)
CLOUDITY_NAVY = (0, 0, 60)
CAPTION_GAP = 14
# Shapes are drawn three times larger then reduced: Pillow does not smooth the
# edge of a rounded rectangle or of a polygon by itself
SMOOTH = 3
CARD_HEADING = (3, 45, 96)
CARD_TEXT = (51, 51, 51)
CARD_ACCENT = (1, 118, 211)
POINTER_TRAVEL_MS = 700
POINTER_RIPPLE_MS = 450
POINTER_SCALE = 2.1
# The arrow of a mouse pointer, tip at (0, 0)
POINTER_SHAPE = [
    (0, 0),
    (0, 16),
    (4, 12.4),
    (6.9, 19),
    (9.4, 17.9),
    (6.6, 11.5),
    (11.6, 11.5),
]
SCRIPTED_STEP_MS = 100
SCRIPTED_END_HOLD_MS = 2600
OVERLAYS = {}


def caption_font(size):
    for name in ("seguisb.ttf", "segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def soft_shadow(size, box, radius, blur, alpha):
    """A blurred dark shape, to lay under a label or a panel."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(box, radius, fill=CLOUDITY_NAVY + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def pointer_sprite():
    """The pointer, smoothed, with the offset of its tip in the image."""
    if "pointer" not in OVERLAYS:
        margin = 8
        scale = POINTER_SCALE * SMOOTH
        size = (int(12 * scale) + 2 * margin * SMOOTH, int(20 * scale) + 2 * margin * SMOOTH)
        shape = [(margin * SMOOTH + x * scale, margin * SMOOTH + y * scale) for x, y in POINTER_SHAPE]
        shadow = Image.new("RGBA", size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).polygon(
            [(x + 2 * SMOOTH, y + 3 * SMOOTH) for x, y in shape], fill=(0, 0, 0, 110)
        )
        sprite = shadow.filter(ImageFilter.GaussianBlur(2 * SMOOTH))
        draw = ImageDraw.Draw(sprite)
        draw.polygon(shape, fill=WHITE + (255,))
        draw.line(shape + [shape[0]], fill=CLOUDITY_NAVY + (255,), width=int(1.6 * SMOOTH), joint="curve")
        OVERLAYS["pointer"] = (
            sprite.resize((size[0] // SMOOTH, size[1] // SMOOTH), Image.LANCZOS),
            margin,
        )
    return OVERLAYS["pointer"]


def ripple_sprite(step):
    """The ring of a click, at one of its eight sizes."""
    key = ("ripple", step)
    if key not in OVERLAYS:
        progress = step / 8.0
        radius = 12 + 26 * progress
        half = 44
        size = (2 * half * SMOOTH, 2 * half * SMOOTH)
        sprite = Image.new("RGBA", size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(sprite)
        center = half * SMOOTH
        alpha = int(255 * (1 - 0.6 * progress))
        for color, width, grow in ((WHITE, 7, 0), (CLOUDITY_BLUE, 4, 0)):
            r = (radius + grow) * SMOOTH
            draw.ellipse(
                (center - r, center - r, center + r, center + r),
                outline=color + (alpha,),
                width=width * SMOOTH,
            )
        OVERLAYS[key] = (sprite.resize((2 * half, 2 * half), Image.LANCZOS), half)
    return OVERLAYS[key]


def draw_pointer(image, position, ripple):
    """Draws the pointer at `position`, and the ring of a click when `ripple` (0..1) is set."""
    x, y = int(round(position[0])), int(round(position[1]))
    if ripple is not None:
        ring, half = ripple_sprite(min(8, int(ripple * 8)))
        image.paste(ring, (x - half, y - half), ring)
    sprite, margin = pointer_sprite()
    image.paste(sprite, (x - margin, y - margin), sprite)


def caption_overlay(size, caption):
    """The label of a caption, the frame around what it is about, and the rest dimmed.

    `caption` holds its text, the box of the part of the frame it is about
    (x, y, width, height), the side of the box the label goes on and where it
    sits along that side. Without a
    box, the label sits at the bottom of the frame and nothing is dimmed.
    """
    big_size = (size[0] * SMOOTH, size[1] * SMOOTH)
    big = Image.new("RGBA", big_size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    text = caption["text"]
    label_font = caption_font(28 * SMOOTH)
    text_box = draw.textbbox((0, 0), text, font=label_font)
    width = text_box[2] - text_box[0] + 56 * SMOOTH
    height = 58 * SMOOTH
    box = caption.get("box")
    side = caption.get("side", "below")
    align = caption.get("align", "center")
    gap = CAPTION_GAP * SMOOTH
    if box:
        left, top, box_width, box_height = [value * SMOOTH for value in box]
        right, bottom = left + box_width, top + box_height
        # Everything but the box is dimmed, so the eye goes to it
        draw.rectangle((0, 0) + big_size, fill=CLOUDITY_NAVY + (58,))
        draw.rounded_rectangle((left, top, right, bottom), 12 * SMOOTH, fill=(0, 0, 0, 0))
        draw.rounded_rectangle(
            (left - 2 * SMOOTH, top - 2 * SMOOTH, right + 2 * SMOOTH, bottom + 2 * SMOOTH),
            14 * SMOOTH,
            outline=WHITE + (255,),
            width=6 * SMOOTH,
        )
        draw.rounded_rectangle(
            (left, top, right, bottom), 12 * SMOOTH, outline=CLOUDITY_BLUE + (255,), width=4 * SMOOTH
        )
        center_x, center_y = (left + right) / 2, (top + bottom) / 2
        # Along the side: at its start, its middle or its end
        along_x = {"start": left, "end": right - width}.get(align, center_x - width / 2)
        if side == "above":
            x, y = along_x, top - gap - height
        elif side == "right":
            x, y = right + gap, center_y - height / 2
        elif side == "left":
            x, y = left - gap - width, center_y - height / 2
        else:
            x, y = along_x, bottom + gap
    else:
        x, y = (big_size[0] - width) / 2, big_size[1] - height - 64 * SMOOTH
    edge = 16 * SMOOTH
    x = min(max(x, edge), big_size[0] - width - edge)
    y = min(max(y, edge), big_size[1] - height - edge)
    pill = (x, y, x + width, y + height)
    big.alpha_composite(
        soft_shadow(
            big_size,
            (x, y + 7 * SMOOTH, x + width, y + height + 7 * SMOOTH),
            height / 2,
            9 * SMOOTH,
            150,
        )
    )
    draw = ImageDraw.Draw(big)
    draw.rounded_rectangle(pill, height / 2, fill=CLOUDITY_BLUE + (255,), outline=WHITE + (255,), width=3 * SMOOTH)
    draw.text(
        (x + 28 * SMOOTH - text_box[0], y + (height - (text_box[3] + text_box[1])) / 2),
        text,
        font=label_font,
        fill=WHITE + (255,),
    )
    return big.resize(size, Image.LANCZOS)


def draw_bubble(image, caption):
    """Draws a caption over a frame. See caption_overlay()."""
    if not caption.get("text"):
        return
    key = ("caption", json.dumps(caption, sort_keys=True))
    if key not in OVERLAYS:
        # One at a time: an overlay has the size of a frame
        for other in [name for name in OVERLAYS if name[0] == "caption"]:
            del OVERLAYS[other]
        OVERLAYS[key] = caption_overlay(image.size, caption)
    image.paste(OVERLAYS[key], (0, 0), OVERLAYS[key])


def draw_opening(image, card, docs_images):
    """Lays the opening over the lower part of a frame: the banner, a heading and a line."""
    if "opening" not in OVERLAYS:
        size = image.size
        panel_height = 322
        top = size[1] - panel_height - 22
        big_size = (size[0] * SMOOTH, size[1] * SMOOTH)
        panel_box = tuple(
            value * SMOOTH for value in (34, top, size[0] - 34, size[1] - 22)
        )
        big = soft_shadow(
            big_size,
            (panel_box[0], panel_box[1] + 8 * SMOOTH, panel_box[2], panel_box[3] + 8 * SMOOTH),
            24 * SMOOTH,
            12 * SMOOTH,
            160,
        )
        ImageDraw.Draw(big).rounded_rectangle(
            panel_box, 24 * SMOOTH, fill=WHITE + (255,), outline=CLOUDITY_BLUE + (255,), width=4 * SMOOTH
        )
        panel = big.resize(size, Image.LANCZOS)
        draw = ImageDraw.Draw(panel)
        y = top + 24
        banner_file = os.path.join(docs_images, "sfdx-hardis-banner.png")
        if os.path.exists(banner_file):
            banner = Image.open(banner_file).convert("RGB")
            banner_width = 700
            banner = banner.resize(
                (banner_width, int(banner.height * banner_width / banner.width)), Image.LANCZOS
            )
            panel.paste(banner, ((size[0] - banner_width) // 2, y))
            y += banner.height + 14
        for text, text_font, fill in (
            (card.get("heading", ""), font(46), CLOUDITY_NAVY),
            (" ".join(card.get("lines", [])), font(30, bold=False), CARD_TEXT),
        ):
            text_box = draw.textbbox((0, 0), text, font=text_font)
            draw.text(((size[0] - (text_box[2] - text_box[0])) / 2, y), text, font=text_font, fill=fill)
            y += text_box[3] + 14
        OVERLAYS["opening"] = panel
    image.paste(OVERLAYS["opening"], (0, 0), OVERLAYS["opening"])


def build_card(size, card, docs_images):
    """The card that ends a scripted recording: the banner, a heading, a few lines."""
    image = Image.new("RGB", size, WHITE)
    draw = ImageDraw.Draw(image)
    y = 60
    banner_file = os.path.join(docs_images, "sfdx-hardis-banner.png")
    if os.path.exists(banner_file):
        banner = Image.open(banner_file).convert("RGB")
        width = 1150
        banner = banner.resize(
            (width, int(banner.height * width / banner.width)), Image.LANCZOS
        )
        image.paste(banner, ((size[0] - width) // 2, y))
        y += banner.height + 50

    def centered(text, text_font, fill, top):
        box = draw.textbbox((0, 0), text, font=text_font)
        draw.text(((size[0] - (box[2] - box[0])) / 2, top), text, font=text_font, fill=fill)

    centered(card.get("heading", ""), font(52), CLOUDITY_NAVY, y)
    y += 98
    lines = card.get("lines", [])
    line_font = font(34, bold=False)
    if len(lines) == 1:
        centered(lines[0], line_font, CARD_TEXT, y)
        y += 70
    else:
        widest = max(draw.textbbox((0, 0), line, font=line_font)[2] for line in lines)
        left = (size[0] - widest) // 2 + 24
        for line in lines:
            draw.ellipse((left - 44, y + 14, left - 24, y + 34), fill=CLOUDITY_BLUE)
            draw.text((left, y), line, font=line_font, fill=CARD_TEXT)
            y += 60
    if card.get("footer"):
        centered(card["footer"], font(38), CLOUDITY_BLUE, y + 14)
    logo_file = os.path.join(docs_images, "cloudity-logo-text.png")
    if os.path.exists(logo_file):
        logo = Image.open(logo_file).convert("RGBA")
        height = 84
        logo = logo.resize((int(logo.width * height / logo.height), height), Image.LANCZOS)
        image.paste(logo, ((size[0] - logo.width) // 2, size[1] - height - 30), logo)
    return image


def ease(value):
    value = min(1.0, max(0.0, value))
    return value * value * (3 - 2 * value)


def build_scripted_gif(frames_dir, meta, target, dry_run, docs_images):
    crop = meta.get("crop")
    events = sorted(meta["events"], key=lambda event: event["t"])
    cuts = [event for event in events if event["type"] == "cut"]

    def load_frame(path):
        image = Image.open(path).convert("RGB")
        if crop:
            image = image.crop((crop["left"], crop["top"], image.width, image.height))
        return image

    recorded = [
        frame
        for frame in meta["frames"]
        if not any(cut["t"] <= frame["t"] < cut.get("until", cut["t"]) for cut in cuts)
    ]
    first = load_frame(os.path.join(frames_dir, recorded[0]["file"]))
    if is_blank(first):
        sys.exit(
            f"{recorded[0]['file']} is blank: the session was probably locked while "
            "recording. Unlock it and run `yarn screenshots` again."
        )
    width, frame_height = first.size
    size = (width, frame_height)

    # Output time of a recorded time: what a cut hides is removed, the stills it
    # shows instead are added
    shifts = []  # (recorded time the shift applies from, shift)
    stills = []  # (output start, duration, path, click or None)
    captions = []  # (output time, caption)
    shift = 0
    for cut in cuts:
        start = cut["t"] - shift
        shown = 0
        if cut.get("stills"):
            folder = os.path.join(frames_dir, cut["stills"])
            with open(os.path.join(folder, "timeline.json"), encoding="utf8") as stream:
                for still in json.load(stream)["stills"]:
                    stills.append(
                        (start + shown, still["ms"], os.path.join(folder, still["file"]), still.get("click"))
                    )
                    captions.append((start + shown, still.get("caption") or {}))
                    shown += still["ms"]
        shift += cut.get("until", cut["t"]) - cut["t"] - shown
        shifts.append((cut.get("until", cut["t"]), shift))

    def out_time(recorded_time):
        applied = 0
        for from_time, value in shifts:
            if recorded_time >= from_time:
                applied = value
        return recorded_time - applied

    hidden = lambda event: any(
        cut["t"] < event["t"] < cut.get("until", cut["t"]) for cut in cuts
    )
    captions += [
        (out_time(event["t"]), event)
        for event in events
        if event["type"] == "caption" and not hidden(event)
    ]
    captions.sort(key=lambda item: item[0])
    cards = meta.get("cards") or {}
    # The opening is laid over the first frames: nothing else is drawn on them
    opening = cards.get("intro") or {}
    opening_ms = opening.get("ms", 0)
    # Where the pointer goes, and when it gets there
    targets = [
        (out_time(event["t"]), (event["x"], event["y"]), event["type"] == "click")
        for event in events
        if event["type"] in ("click", "scroll") and not hidden(event)
    ]
    for start, duration, _path, click in stills:
        if click:
            targets.append((start + duration - POINTER_RIPPLE_MS, (click["x"], click["y"]), True))
    targets.sort(key=lambda item: item[0])

    def caption_at(time):
        current = {}
        for at, value in captions:
            if at <= time:
                current = value
        return current

    def pointer_at(time):
        position = (width * 0.62, frame_height * 0.62)
        for at, target_position, is_click in targets:
            if time >= at:
                position = target_position
                if is_click and time - at < POINTER_RIPPLE_MS:
                    return position, (time - at) / POINTER_RIPPLE_MS
                continue
            if time >= at - POINTER_TRAVEL_MS:
                progress = ease((time - (at - POINTER_TRAVEL_MS)) / POINTER_TRAVEL_MS)
                position = (
                    position[0] + (target_position[0] - position[0]) * progress,
                    position[1] + (target_position[1] - position[1]) * progress,
                )
            break
        return position, None

    # The shots, in output order
    # (output time, image path, whether it is a still: stills are not cropped)
    shots = [
        (out_time(frame["t"]), os.path.join(frames_dir, frame["file"]), False)
        for frame in recorded
    ]
    for start, duration, path, _click in stills:
        # A still is repeated at the frame rate: the pointer moves over it
        for step in range(0, duration, SCRIPTED_STEP_MS):
            shots.append((start + step, path, True))
    shots.sort(key=lambda item: item[0])

    loaded = {}

    def compose(time, path, is_still):
        if path not in loaded:
            # One image at a time: consecutive shots of a still share theirs
            loaded.clear()
            image = Image.open(path).convert("RGB") if is_still else load_frame(path)
            loaded[path] = image.crop((0, 0, width, frame_height))
        canvas = Image.new("RGB", size, WHITE)
        canvas.paste(loaded[path], (0, 0))
        if time < opening_ms:
            draw_opening(canvas, opening, docs_images)
            return canvas
        draw_bubble(canvas, caption_at(time))
        position, ripple = pointer_at(time)
        draw_pointer(canvas, position, ripple)
        return canvas

    # One palette for the whole GIF, from frames spread over the recording, the
    # stills and the cards: the colors of GitHub and of the cards are not in the
    # first frame
    samples = [compose(*shots[index]) for index in range(0, len(shots), max(1, len(shots) // 16))]
    samples += [compose(start, path, True) for start, _duration, path, _click in stills]
    if cards.get("outro"):
        samples.append(build_card(size, cards["outro"], docs_images))
    # Reduced without blending pixels: a blend makes colors no frame has, and the
    # palette would spend its entries on them
    tile = (width // 3, size[1] // 3)
    mosaic = Image.new("RGB", (tile[0], tile[1] * len(samples)))
    for index, sample in enumerate(samples):
        mosaic.paste(sample.resize(tile, Image.NEAREST), (0, tile[1] * index))
    palette = mosaic.quantize(colors=255, method=Image.MEDIANCUT)

    images = []
    durations = []

    def add(image, duration, dither=Image.NONE):
        quantized = image.quantize(palette=palette, dither=dither)
        if images and quantized.tobytes() == images[-1].tobytes():
            durations[-1] += duration
        else:
            images.append(quantized)
            durations.append(duration)

    for index, (time, path, is_still) in enumerate(shots):
        last = index + 1 == len(shots)
        duration = SCRIPTED_END_HOLD_MS if last else shots[index + 1][0] - time
        if duration <= 0:
            continue
        add(compose(time, path, is_still), int(duration))
    if cards.get("outro"):
        # Dithered: the banner of a card is a photograph
        add(
            build_card(size, cards["outro"], docs_images),
            cards["outro"].get("ms", 5000),
            Image.FLOYDSTEINBERG,
        )

    # A GIF counts in hundredths of a second: what a frame loses to the rounding
    # is given to the next one, or the whole animation would run short
    owed = 0
    for index, duration in enumerate(durations):
        rounded = max(20, int(round((duration + owed) / 10.0)) * 10)
        owed += duration - rounded
        durations[index] = rounded

    print(
        f"  {'(dry-run) ' if dry_run else ''}{os.path.basename(target)} "
        f"{size[0]}x{size[1]} {len(images)} frames, {sum(durations) / 1000:.1f}s "
        f"({len(shots)} shots)"
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


def build_gif(recording, target, dry_run, docs_images=DEFAULT_DOCS_IMAGES):
    """Assembles the frames of one recording into an optimized animated GIF.

    Consecutive identical frames are merged (their durations add up) and every
    frame is quantized against one shared palette: without both, a 20 second
    recording weighs tens of MB.
    """
    frames_dir = os.path.join(SHOTS_DIR, "recordings", recording)
    if not os.path.isdir(frames_dir):
        return False
    scripted_file = os.path.join(frames_dir, "recording.json")
    if os.path.exists(scripted_file):
        with open(scripted_file, encoding="utf8") as stream:
            scripted = json.load(stream)
        if scripted.get("events") and scripted.get("frames"):
            return build_scripted_gif(frames_dir, scripted, target, dry_run, docs_images)
    frame_files = sorted(
        os.path.join(frames_dir, name)
        for name in os.listdir(frames_dir)
        if name.lower().endswith(".png")
    )
    if len(frame_files) < 2:
        return False

    # Frame rate of this recording (written by record() in the harness); the
    # pipeline scenario uses a higher rate so the animated edges read forward
    frame_ms = GIF_FRAME_MS
    meta_file = os.path.join(frames_dir, "recording.json")
    if os.path.exists(meta_file):
        with open(meta_file, encoding="utf8") as stream:
            frame_ms = int(round(1000 / float(json.load(stream).get("fps", 5))))

    # Merge identical consecutive frames into (file, duration) pairs
    kept = []
    previous_bytes = None
    for frame_file in frame_files:
        with open(frame_file, "rb") as stream:
            content = stream.read()
        if content == previous_bytes:
            kept[-1][1] += frame_ms
        else:
            kept.append([frame_file, frame_ms])
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
    parser.add_argument(
        "--gif",
        help="Only assemble this animated GIF (its documentation image name), and nothing else",
    )
    parser.add_argument(
        "--shots-dir",
        help="Folder of the captures, when they were not taken into doc-screenshots",
    )
    args = parser.parse_args()

    if not os.path.isdir(args.docs_images):
        sys.exit(f"Documentation images folder not found: {args.docs_images}")
    if args.shots_dir:
        global SHOTS_DIR
        SHOTS_DIR = os.path.abspath(args.shots_dir)
    if args.gif:
        recording = GIF_RECORDINGS.get(args.gif)
        if not recording:
            sys.exit(f"Unknown animated GIF: {args.gif}")
        target = os.path.join(args.docs_images, args.gif)
        if not build_gif(recording, target, args.dry_run, args.docs_images):
            sys.exit(f"Recording not found: recordings/{recording}")
        return

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

    print("VS Code user guide screenshots:")
    guide_dir = os.path.join(args.docs_images, GUIDE_FOLDER)
    if not args.dry_run:
        os.makedirs(guide_dir, exist_ok=True)
    for name, (capture, crop) in GUIDE_SHOTS.items():
        image = load(capture)
        if image is None:
            missing.append(capture)
            continue
        if crop is True:
            image = crop_to_webview(image)
        elif crop:
            image = image.crop(crop)
        save(image, os.path.join(guide_dir, name), args.dry_run)

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
        target = os.path.join(args.docs_images, name)
        if not build_gif(recording, target, args.dry_run, args.docs_images):
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
