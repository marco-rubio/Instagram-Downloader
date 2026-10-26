# Custom export specs

Custom features of this fork (`my-branch`) built on top of upstream [HOAIAN2/Instagram-Downloader](https://github.com/HOAIAN2/Instagram-Downloader) v6.

The previous implementation (on top of upstream v5.1.12) is kept for reference on branch `my-branch-v5`.

The consumer of the export is the importer in `marco-rubio/instagram-archive`. Contract changes are agreed with it first.

## Goals

- Export a post as a single ZIP that the importer can ingest.
- Loose media files are not enough: the importer needs the metadata next to the media.
- Keep the custom code self-contained, so syncing with upstream causes as few conflicts as possible and the export keeps working if upstream changes or drops similar features.
- The export never depends on upstream's filename settings. Changing them must not change the export.

## Post export ZIP, format version 2

### Layout

```
username_<postId>.zip
|-- igexport                          format marker, contains "2"
|-- username_<itemId>.<ext>           media, one per slide
|-- username_<postId>.txt             caption
|-- username_<postId>.json            post object
`-- username_<postId>.profile.<ext>   author's profile picture
```

Archive comment: `igexport v2`.

### Format marker

- Entry name `igexport`, no extension, at the ZIP root.
- Contents: the format version as one ASCII decimal number, nothing else (no newline).
- This format is version `2`. Absent or empty means version 1, the v5 format below.
- The importer refuses versions it does not know. Any incompatible change to this contract bumps the version, never reuse a number.
- The archive comment `igexport v2` is for humans (`unzip -z`). The marker entry is the contract.

### Entry rules

The importer classifies entries by extension only. The export must respect:

| Entry           | Rule                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| Marker          | The only entry without an extension.                                                       |
| Post object     | The only `.json` entry. Never add a second `.json`.                                        |
| Caption         | The only `.txt` entry.                                                                     |
| Profile picture | The only entry whose name **ends** with `.profile.<ext>`.                                  |
| Media           | Everything else. Never ends with `.profile.<ext>`.                                         |

- The profile picture is identified by the end of the name, not by `.profile.` anywhere: usernames may contain periods (`my.profile.page`), so `.profile.` can appear inside a media name.
- New kinds of content go in a new entry kind agreed with the importer, never in an existing slot.

### Naming

All names are built by the export itself, as `username_<id>`:

| Entry           | Name                              |
| --------------- | --------------------------------- |
| Archive         | `username_<postId>.zip`           |
| Media           | `username_<itemId>.<ext>`         |
| Caption         | `username_<postId>.txt`           |
| Post object     | `username_<postId>.json`          |
| Profile picture | `username_<postId>.profile.<ext>` |

- `<postId>` is the post's numeric id: `pk` of the post object.
- `<itemId>` is the slide's numeric id: `carousel_media[i].pk` for a carousel, the post's `pk` for single media. Bytes pair to slides by this id.
- Slide order is not in the names. It is the order of `carousel_media` in the post object.
- Usernames may contain `_`, so the id is everything after the **last** `_`.
- The importer never reads the ZIP's own name. It is for humans and may get a browser suffix like ` (1)`.

### Content

| Entry           | Content                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Media           | Highest quality available, one file per slide. A slide is never silently skipped.                     |
| Caption         | Raw caption text, trimmed. Always present, empty when the post has no caption.                        |
| Post object     | Raw post object as returned by Instagram, unmodified, pretty-printed with 2-space indentation.        |
| Profile picture | From `user.hd_profile_pic_url_info.url`, falling back to `user.profile_pic_url`.                      |

- Media extension follows the content type (`.jpg`, `.webp`, `.mp4`, ...).
- If any slide cannot be downloaded, the export fails instead of saving an incomplete ZIP: the importer checks the media count against the slides.
- The profile picture comes from the CDN URL already in the post object, so it costs no extra API call. If its download fails, the ZIP is still saved without it.

### Post object fields the importer reads

The importer reads these keys literally, with REST spellings:

- Required: `pk`, `user.pk` (or `user.pk_id`), `user.username`, `carousel_media[].pk` for carousels.
- Wanted, silently lost if renamed: `taken_at` (unix seconds), `media_type`, `product_type`, `code`, `caption.text`, `location.name` / `lat` / `lng`, `usertags.in[].user.pk`, `coauthor_producers[].pk` / `username`, and per slide `original_width`, `original_height`, `video_duration`.

GraphQL-style renames (`edge_sidecar_to_children`, `dimensions`, `owner.id`, `shortcode`, `taken_at_timestamp`) would import as empty values without an error.

## Format version 1 (v5, branch `my-branch-v5`)

Still accepted by the importer, identified by the missing marker.

```
username [shortcode].zip
|-- username [shortcode].jpeg | .mp4          single media
|-- username [shortcode] - 1.jpeg, - 2.mp4    carousel media, 1-based position
|-- username [shortcode].txt
`-- username [shortcode].json
```

- Images always `.jpeg`, videos `.mp4`.
- Post object from REST `/api/v1/media/{id}/info/`, in version 2 from GraphQL `PolarisPostRootQuery`.
- No profile picture.

## Open questions

- [ ] Post object shape from GraphQL `PolarisPostRootQuery` vs the REST keys above. Upstream reads REST-style keys from it (`carousel_media`, `taken_at`, `pk`, `user.username`, `caption.text`) and the response key is `xdt_api__v1__media__shortcode__web_info`, which suggests the same v1 object. To be confirmed with a real export sent to the importer.
- [ ] Where the export button goes: separate inline button, upstream's ZIP button, or a floating button.
- [ ] Stories and highlights export: needed, and with which entries.
- [ ] Standalone profile picture button (v5: profile pages only, read from page data, named `username [userId_YYYYMMDDHHmmssZ].jpeg`): keep or drop.
