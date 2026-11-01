# export-controls Specification

## Purpose

The export buttons on Instagram's pages: where each one goes, how it reports
progress and failure, how upstream's own download buttons are hidden, and how
an attachment failure is reported. Keyboard access is in `keyboard-shortcuts`.
## Requirements
### Requirement: Post and story buttons follow upstream's inline buttons

The post export button SHALL be placed right after each of upstream's inline
post download buttons (`.igd-post-inline-download`), carrying the same
shortcode, on every surface upstream covers: feed, post page, post overlay,
reels, single media and carousels. The story export button SHALL be placed
right after upstream's story download button (`.igd-story-inline-download`), on
story pages only, never on highlights. The export SHALL NOT find action bars
itself: upstream already solves that, and following its buttons keeps
upstream's files unchanged.

A button whose upstream anchor is gone, or whose shortcode no longer matches,
SHALL be removed or replaced. Buttons are kept in sync by a mutation observer,
navigation events and window resizes; the export's own insertions SHALL NOT
schedule another pass.

#### Scenario: A post is opened in the overlay from a collection

- **WHEN** upstream adds its inline button to the overlay's action bar
- **THEN** an export button for that post appears right after it

#### Scenario: Upstream's style is set to Legacy

- **WHEN** the download button style is changed to "Legacy"
- **THEN** upstream removes its inline buttons, and the post and story export
  buttons disappear with them

### Requirement: The profile button sits over the profile picture

The profile export button SHALL be placed, on a profile page (`/<username>/`,
`/<username>/reels|tagged|saved/`, excluding Instagram's reserved first segments),
over the bottom-right corner of the header's profile picture: the largest image
in the header, at least 56x56. It SHALL be inserted next to the picture's
clickable element, never inside it, because clicking the picture opens the
account's stories. It SHALL be repositioned on page changes and window resizes,
and SHALL NOT depend on upstream's buttons or button style.

#### Scenario: The picture is clicked next to the button

- **WHEN** the export button over the picture is clicked
- **THEN** the profile is exported and the account's stories do not open

### Requirement: Upstream's inline download buttons are hidden, not removed

Upstream's inline post and story download buttons SHALL be hidden (single and
"download all") by CSS (`display: none !important` in `igexport.css`), leaving
them in the DOM as the export buttons' anchors. Upstream's code SHALL NOT be
changed to hide them.

#### Scenario: A feed post is shown

- **WHEN** a feed post's action bar renders
- **THEN** only the export button is visible where upstream's download buttons
  were

### Requirement: A button shows progress and failure itself

While exporting, a button SHALL show upstream's progress ring
(`setInlineDownloadProgress`) and SHALL ignore clicks. On success the ZIP SHALL
be pushed to the archive app when an endpoint is configured (`archive-push`), and
otherwise saved through upstream's `saveFile`. On failure the button SHALL show a
red ring for 3 seconds with `Export failed: <reason>` as its tooltip, then return
to its label; the error is also logged to the console. A failed push is not an
export failure: the ZIP is downloaded and the reason shown as a notice.

#### Scenario: An export fails

- **WHEN** an export throws
- **THEN** the button turns red for 3 seconds and its tooltip names the reason

#### Scenario: A push fails

- **WHEN** the ZIP was built but the app refused it
- **THEN** the button does not turn red, the ZIP is downloaded and a notice
  gives the app's reason

### Requirement: An attachment failure is reported once per page load

The extension SHALL show, on a post page (`/p/`, `/reel/`, `/reels/`, `/tv/` with
a code) or a story page where upstream's corresponding button has not appeared
after 8 seconds, a dismissible notice at the top of the page reading
exactly: "Instagram export was unable to attach its functionality to the page.
Reload to try again. If this keeps happening, your extension is probably
outdated." It SHALL show at most once per page load. It SHALL NOT be checked
while the download button style is "Legacy", which removes upstream's buttons on
purpose and is not reported.

#### Scenario: Upstream's markup changed

- **WHEN** a post page has had no upstream inline button for 8 seconds
- **THEN** the notice appears once, and its close button removes it

#### Scenario: The user chose Legacy

- **WHEN** the download button style is "Legacy"
- **THEN** no notice appears

