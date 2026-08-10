# OMP WebUI accessibility acceptance checklist

**Target:** WCAG 2.2 AA where applicable, with keyboard and screen-reader
acceptance tested against the actual React application—not only static markup.

**How to use:** Mark every item Pass / Fail / Not applicable and record the
tested route, browser, assistive technology, and any issue reference. “Looks
fine” is not a pass criterion.

## Review record

| Field | Record |
| --- | --- |
| Build / commit | |
| Reviewer | |
| Date | |
| Browser(s) | |
| Screen reader(s) | |
| Theme(s) | Dark / Light |
| Viewports tested | Desktop / compact desktop / narrow |

## 1. Keyboard-only full workflow

Perform this entire scenario with the keyboard only. Disconnect or ignore the
pointer after the first focused element.

### Entry, navigation, and session handling

- [ ] On first Tab, a visible **Skip to conversation** link appears and moves
      focus directly to the main conversation region.
- [ ] Focus order is logical and matches the visual order; no hidden drawer,
      offscreen panel, or decorative element receives focus.
- [ ] The Sessions navigation has an accessible name and each row exposes its
      title and relevant state.
- [ ] Create a new session using its visible control and its shortcut, if the
      shortcut is enabled. The created session becomes current without losing
      keyboard context.
- [ ] Search/filter sessions, move to a result, open it, and clear the search
      without needing a pointer.
- [ ] Rename, pin, and remove a session using keyboard-accessible controls.
      Permanent removal requires a clear confirmation with an explicit
      destructive label.
- [ ] Open and close the right drawer. When it is an overlay, focus enters the
      drawer and returns to its trigger on close. When docked, it participates
      in the ordinary tab order.

### Conversation and transcript

- [ ] Navigate all visible controls in user turns, assistant turns, code
      blocks, tool cards, subagent panels, and system entries.
- [ ] Expand and collapse each tool card and subagent panel with Enter and
      Space (or its native semantic equivalent). `aria-expanded` is accurate.
- [ ] Copy a code block using keyboard; focus remains predictable and a
      non-disruptive confirmation is available.
- [ ] Move away from the bottom of a streaming transcript. New content does
      not pull focus or scroll the reviewer away from the inspected content.
- [ ] Activate **Jump to latest** with keyboard. It scrolls to the latest turn
      and does not move focus unexpectedly.
- [ ] Use transcript content with long paths, commands, unbroken strings,
      horizontal code overflow, errors, and many sequential tool cards. There
      are no keyboard traps or unreachable controls.

### Composer, queue, and run control

- [ ] Tab to the composer. Its text field has a programmatic label; the
      placeholder is not its only label.
- [ ] Enter multi-line text with Shift+Enter; it does not submit.
- [ ] Submit with Enter and Ctrl/Cmd+Enter (if both are provided). IME
      composition is not submitted accidentally.
- [ ] Open model selection, inspect choices, choose one, and dismiss it with
      Escape. Current selection and unavailable/offline state are exposed.
- [ ] Add or observe a queued request, then reorder/remove it using keyboard
      controls or a non-drag alternative.
- [ ] Start a run and activate Stop/Abort with the visible control and its
      documented shortcut, if enabled. The state changes to “Stopping…” and
      eventually reaches a named terminal state.
- [ ] Composer validation errors are announced, visually clear, associated
      with the input, and focus returns to a useful correction point.

### Approval, question, menu, and dialog flows

- [ ] Trigger a blocking approval request. Focus moves into the dialog; the
      dialog title, impact, command/path, choices, and scope are readable.
- [ ] Tab and Shift+Tab cycle only through the open dialog. No browser chrome,
      background controls, or hidden elements receive focus.
- [ ] Escape dismisses a dismissible dialog. A non-dismissible dialog clearly
      explains why it must be decided.
- [ ] Approve, deny, and decide later (where offered) using keyboard. On
      close, focus returns to the original trigger or a sensible surviving
      successor.
- [ ] Answer an inline agent question with every offered choice, including
      “Other” text entry if supported.
- [ ] Open contextual menus and popovers, operate each item, and close them
      with Escape. The trigger restores focus.
- [ ] Use drawer tabs with Left/Right Arrow keys; Tab exits the tab list into
      the selected panel. Selected state is clear.

## 2. Focus and visual visibility

- [ ] Every keyboard-focusable control has a visible focus indicator with at
      least 3:1 contrast against adjacent colors; it is never removed by a
      component reset.
- [ ] Focus is not obscured by sticky transcript headers, the composer,
      drawers, or overlays (WCAG 2.4.11).
- [ ] Focus does not move on stream chunks, tool completion, a toast, session
      list refresh, or asynchronous data arrival.
- [ ] Newly inserted content does not unexpectedly reorder focusable items
      ahead of the current focus.
- [ ] Disabled controls are not focusable unless needed to communicate why
      they are unavailable; if focusable, the unavailable reason is exposed.
- [ ] Popovers, menus, tooltips, and hover-revealed controls do not create a
      pointer-only route. Content stays usable while moving pointer/focus to
      it and can be dismissed.

## 3. Screen-reader semantics and announcement strategy

Test at least one desktop screen reader/browser pairing. Recommended coverage:
VoiceOver + Safari and NVDA + Firefox or Chrome.

### Landmarks, names, and structure

- [ ] The application exposes one labelled Sessions navigation landmark, one
      labelled main conversation landmark, one labelled workspace/drawer
      complementary landmark when docked, and a labelled composer form.
- [ ] The transcript is chronological, using semantic articles/list items.
      Each turn exposes speaker identity, message content, and time/state
      without requiring visual position or avatar interpretation.
- [ ] The entire transcript does **not** use `role="log"` or a broad live
      region. Moving through prior content does not cause repeated historical
      announcements.
- [ ] Headings form a sensible hierarchy. Tool cards and subagent panels have
      headings that identify their action/objective.
- [ ] Icon-only controls have accurate accessible names that include the
      object where ambiguity is possible (“Collapse Read file tool details,”
      not merely “Collapse”).
- [ ] Repeated controls distinguish their target (“Copy `src/app.ts` path”,
      “Retry test command”).
- [ ] Truncated visual text has an accessible full name/value. Tooltips are
      supplemental and not the only source of the full path/status.
- [ ] Status, selected, current, expanded, disabled, and error states are
      programmatically determinable.

### Streaming text: mandatory polite, throttled announcements

Implement a **separate, visually hidden live announcer** outside the transcript
DOM. It uses `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`.
It is for concise state summaries, never raw model tokens.

- [ ] Starting a response announces once: “OMP is responding.”
- [ ] During a text stream, announce at most once every 5 seconds **and only
      if there is a meaningful update**. Prefer a short summary such as
      “OMP is still responding” or “OMP is running tests”; do not announce
      every sentence, token, or DOM mutation.
- [ ] Tool start/finish is announced once when it materially changes the
      user’s ability to act: “Running tests,” “Tests completed,” or
      “Test command failed: 2 failures.” Do not announce every log line.
- [ ] Subagent work announces lifecycle summaries only: started, waiting for
      input, completed, failed, stopped. It does not announce internal stream
      chunks or each nested tool.
- [ ] A completed response announces once: “Response complete.” A stopped,
      failed, or disconnected stream announces the named outcome and whether
      partial content remains.
- [ ] Queued updates are announced when a request becomes active or needs user
      action, not on every ordering/count change.
- [ ] The live region is cleared or replaced after an announcement so stale
      text is not repeatedly read when focus changes.
- [ ] Urgent errors use `role="alert"` sparingly and only if the user must
      know immediately; ordinary errors are polite, local, and discoverable.
- [ ] Screen-reader review confirms a 30-second stream is understandable
      without becoming a continuous interruption.

### Dialogs and dynamic components

- [ ] A standard modal uses native `<dialog>` or `role="dialog"` with
      `aria-modal="true"`, `aria-labelledby`, and `aria-describedby` when
      explanatory content is present.
- [ ] An alert dialog is reserved for urgent acknowledgement; ordinary
      approvals use a standard dialog.
- [ ] Opening a dialog announces title and relevant description once, places
      focus inside, traps focus, supports Escape when dismissible, and
      restores focus to its invoker when closed.
- [ ] Menus, comboboxes, listboxes, tabs, disclosures, and trees conform to
      their WAI-ARIA keyboard and state conventions. Prefer native HTML where
      it provides the behavior.
- [ ] Toasts do not steal focus and do not contain the only way to recover,
      retry, or undo an important action.

## 4. Visual accessibility and contrast

Verify in both dark and light themes. Contrast must be measured from rendered
colors, including text over translucent layers.

- [ ] Normal text below 24 px (or 18.66 px bold) is at least **4.5:1** against
      its background.
- [ ] Large text is at least **3:1** against its background.
- [ ] Essential icons, focus indicators, input borders, selected indicators,
      charts/diff marks, and other non-text UI components are at least
      **3:1** against adjacent colors.
- [ ] Placeholder text is not the sole label and remains readable enough to
      distinguish from entered text.
- [ ] Copper, teal, success, warning, danger, and info state meanings are
      paired with text and/or an icon/shape. Git additions/deletions include
      `+`/`−` or labels in addition to color.
- [ ] At 200% browser zoom and 400% reflow (or 320 CSS px equivalent), content
      remains usable without two-dimensional page scrolling except for code,
      logs, data tables, or other intentional two-dimensional content.
- [ ] Long unbroken paths, commands, filenames, model names, localized labels,
      and 200% text settings do not overlap controls or make essential content
      inaccessible.
- [ ] OS/browser high-contrast or forced-colors mode leaves controls,
      selection, and focus visibly distinguishable.

## 5. Motion, time, and sensory considerations

- [ ] With `prefers-reduced-motion: reduce`, drawers, dialogs, cards, toasts,
      streaming indicators, and loading transitions do not slide, pulse,
      typewrite, or continuously animate.
- [ ] No essential information depends on animation completion; all states are
      available as text/structure immediately.
- [ ] No content flashes more than three times per second.
- [ ] Auto-updating transcript content does not forcibly scroll a user who is
      reading history. The user can choose **Jump to latest**.
- [ ] Any time limit on an approval/question is visible, announced before
      expiry where possible, and can be extended or recovered if technically
      feasible.

## 6. States, errors, and resilience

- [ ] Empty states name the empty context and offer the next relevant action;
      they are not illustration-only.
- [ ] Loading states have text labels. Skeletons preserve layout but do not
      hide all controls indefinitely.
- [ ] Errors identify the operation, a useful human-readable reason, and a
      recovery action. Stack traces/secrets are not announced by default.
- [ ] Connection state is visible and programmatic: connecting, reconnecting,
      offline, recovered, or event gap.
- [ ] Offline/reconnecting states preserve drafts and partial content. The UI
      never falsely reports an interrupted agent command as complete.
- [ ] If an event gap means outcome is unknown, the affected task is labelled
      unknown/partial and offers a refresh, retry, or resume route.
- [ ] Validation errors are linked to their fields with
      `aria-describedby`; error summaries link/focus to the correction point
      when a multi-field dialog/form fails.

## 7. Content and implementation checks

- [ ] Interface language is plain and specific: “Delete session”, “Stop run”,
      “Allow once”, “Retry command”—not “OK”, “Done”, or unexplained icons.
- [ ] Language is set on the document (`lang`) and any changed language in
      content is marked when appropriate.
- [ ] Semantic HTML is used before ARIA. No invalid ARIA roles/attributes or
      duplicate landmark labels are present.
- [ ] IDs used by `aria-labelledby`, `aria-describedby`, `aria-controls`, and
      `aria-owns` are unique and point to existing elements.
- [ ] Native focusable elements are used for actions. Non-semantic elements
      with click handlers are not used as buttons.
- [ ] All form controls have labels and instructions; required/invalid states
      are programmatically exposed.
- [ ] Visual order and DOM order agree. CSS does not create a misleading focus
      order.
- [ ] Automated checks (for example axe) report no serious or critical
      violations. Manual keyboard and screen-reader review has still been
      completed, because automation cannot validate stream behavior or focus
      flow.

## Exit criteria

The feature passes only when:

1. every applicable checkbox is Pass (or has a documented exception approved
   by the accessibility owner);
2. a keyboard-only user completes the full coding-agent workflow, including an
   approval and an interrupted/reconnected stream;
3. a screen-reader user receives bounded, polite stream summaries rather than
   raw token-by-token announcements; and
4. contrast, reflow, focus visibility, dialogs, and reduced-motion behavior
   pass in both supported themes.
