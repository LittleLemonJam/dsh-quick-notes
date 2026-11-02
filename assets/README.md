# Screenshots

The two PNG files in this directory are used by the Screenshots section of
[`README.md`](../README.md) and [`README.zh.md`](../README.zh.md);
`icon-180.png` is the 180 px raster icon used by plugin-market cards:

| File               | What to show                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `screenshot-1.png` | Normal mode: the floating window with the note directory, one note open, and the settings / recycle-bin / sync bar. |
| `screenshot-2.png` | The window in notes-only mode.                                                                                      |
| `icon-180.png`     | 180 × 180 px raster version of `icon.svg` for the plugin-market listing.                                            |

## Guidelines

- Take screenshots from the released build (or a build of the same commit), so the
  README matches what users actually install.
- Use a clean DSH session with example notes only. Do not capture real messages,
  names, tokens, file paths or anything private.
- Recommended size: 1600 × 1000 px (or any 16:10 image at 2× scale). Keep the
  file under about 500 KiB by exporting as PNG and compressing if needed.
- Light and dark theme screenshots are both welcome; the two README slots are
  enough for the 1.0.0 release, so updating them later does not require README
  changes as long as the file names stay the same.
- Screenshots are covered by the repository [MIT license](../LICENSE).

## Updating

1. Replace `screenshot-1.png` / `screenshot-2.png` with the new images (keep the
   exact file names).
2. Check the alt text still describes the image in both READMEs; update the
   descriptions if the window layout changed.
3. Run `npx prettier --check README.md README.zh.md` after any README edit.
