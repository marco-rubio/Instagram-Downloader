# keyboard-shortcuts Specification

## Purpose

Keyboard access to the export and to Instagram's save (bookmark), for the
workflow of marking posts while browsing, then exporting them one by one from
the saved collection and unmarking each after export.

## Requirements

### Requirement: Shortcuts never fire while typing

Shift+E and Shift+B SHALL be read on `keydown` as the keys `E` and `B`, and
SHALL be ignored when Ctrl, Meta or Alt is held, on key repeat, on
`/direct` pages, and when the event target is an input, textarea, select,
`role="textbox"` or contenteditable element. The keys were chosen because
Instagram does nothing on E or Shift+E, B or Shift+B, and upstream uses Shift+D,
Shift+S and Shift+C.

#### Scenario: Typing a comment

- **WHEN** Shift+E is pressed in a comment box
- **THEN** nothing is exported and the character is typed

### Requirement: Shift+E exports what is on screen

Shift+E SHALL click the export button of, in this order:

1. on a story page, the story;
2. a post open in an overlay (`role="dialog"`);
3. otherwise the post covering the middle of the viewport, or nearest to it
   (measured on its `article` when it has one);
4. otherwise the profile, on a profile page.

When there is no target, it SHALL do nothing and leave the key to the page.

#### Scenario: A post is open over the feed

- **WHEN** Shift+E is pressed while a post overlay is open
- **THEN** the overlay's post is exported, not a feed post behind it

### Requirement: Shift+B toggles Instagram's save on the same post

Shift+B SHALL click Instagram's own save button for the post Shift+E would
target (steps 2 and 3 above), making no request of its own. The save button's
label is translated, so it SHALL be found as the first labelled icon after the
share icon (path starting `M13.973 20.046`) in the nearest ancestor of the
export button that holds one, and SHALL only be clicked when it has one of its
two known shapes:

| State | Shape |
|---|---|
| Saved | a path starting `M20 22a.999.999 0 0 1-.687-.273L12 14.81` |
| Unsaved | the polygon `20 21 12 13.44 4 21 4 3 20 3 20 21` |

Otherwise nothing SHALL be clicked, and the export button SHALL show the failure
"Instagram's save button was not found". Shift+B SHALL do nothing on story
pages. It is verified on posts opened from the saved collection; on the feed it
currently has no effect, which the workflow does not need.

#### Scenario: Unmarking after export

- **WHEN** a post opened from the saved collection was exported and Shift+B is
  pressed
- **THEN** Instagram's save button is clicked and the post is unsaved

#### Scenario: Instagram changed the icon

- **WHEN** the icon after share has neither known shape
- **THEN** nothing is clicked and the export button shows the failure
