# UX / visual design handoff

## Files written

- `docs/omp-webui/DESIGN_SYSTEM.md`
- `docs/omp-webui/A11Y_CHECKLIST.md`
- `packages/web/src/styles/tokens.css`
- `packages/web/src/styles/base.css`

## Key decisions

- **Original warm-dark workbench:** deep ink surfaces, copper for primary user
  intent, teal for agent/system activity, with matching light-theme semantics.
- **Transcript-first shell:** persistent sessions sidebar, readable centered main
  transcript, sticky composer, and contextual files/git/plans drawer.
- **Stable streaming:** append content without moving focus or stealing scroll;
  users who inspect history get a Jump to latest action.
- **Tool clarity:** cards show a textual lifecycle state, short outcome, target,
  duration, and expandable raw details. Subagents are bounded task panels, not
  nested chat applications.
- **Accessible interruption flows:** approvals use explicit verb buttons and
  narrow scope by default; questions are inline unless focused multi-field input
  or global blocking requires a dialog.
- **Accessibility baseline:** visible focus, keyboard parity, semantic landmarks,
  throttled polite live summaries (never token-by-token announcements), dialog
  focus traps, WCAG AA contrast, and reduced-motion behavior are required.
- **Standalone styles:** plain CSS custom properties; no Tailwind or framework
  runtime dependency. `base.css` imports `tokens.css`.

## Review focus

1. Apply only semantic variables from `tokens.css` in new component styles.
2. Verify live streaming preserves reading position and produces no excessive
   screen-reader announcements.
3. Exercise the full keyboard workflow including composer, queue, tool details,
   drawer tabs, approval, question, abort, and offline recovery.
4. Measure rendered contrast in both themes and test 200% zoom / 400% reflow.
5. Test focus restoration and Escape behavior for every dialog, sheet, menu,
   and popover.
