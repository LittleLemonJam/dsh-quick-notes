# Pull request

## Summary

<!-- What does this PR change, and why? Keep it to a few sentences. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / internals
- [ ] Tests and CI
- [ ] Release / metadata (`package.json`, `market.json`, `CHANGELOG.md`)

## Scope

<!-- Which files/areas are touched? Comment out irrelevant lines. -->

- Host half (`index.js`, `src/host/**`, `src/shared/**`)
- Client half (`src/client/**`, generated `client.js`)
- Docs (`README*.md`, `docs/*.md`, `CHANGELOG.md`, `CONTRIBUTING.md`)
- Repository / CI (`.github/**`, `market.json`)

## Testing

<!-- How was this verified? Paste the commands you ran and their result. -->

```bash
npm run verify
```

Manual checks (if UI changed):

- [ ] New / rename / pin / delete / restore notes
- [ ] Bold / italic / underline, copy / cut / paste, clear formatting
- [ ] Paste or drag a picture into a note
- [ ] Drag, resize, compact mode, minimized ball
- [ ] Refresh keeps content, settings and window state

## Checklist

- [ ] `npm run verify` passes locally.
- [ ] If `src/client/**` changed, `client.js` was rebuilt with `npm run build` and
      is included in this PR.
- [ ] New behaviour has a test, or the PR explains why it cannot be tested.
- [ ] The change follows `docs/architecture.md`; if the contract changed, the
      document is updated in the same PR.
- [ ] UI strings were added to both `en` and `zh` dictionaries.
- [ ] `CHANGELOG.md` was updated (new changes go to `Unreleased`) and any affected
      docs were updated.
- [ ] No debug output, no unrelated formatting, no generated junk files.
- [ ] No note content, tokens or other private data is included.

## Related issues

<!-- Closes #123, refs #456 -->

## Screenshots / recordings

<!-- Required for visible UI changes. Real screenshots only; do not edit or fake them. -->
