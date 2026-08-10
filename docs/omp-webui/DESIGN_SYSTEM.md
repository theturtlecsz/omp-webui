# OMP WebUI design system

**Status:** implementation baseline  
**Product:** local-first browser interface for the Oh My Pi coding agent  
**Scope:** desktop-first React + TypeScript application; responsive down to a
narrow laptop viewport. This is an original system, not a visual imitation of
another chat product.

## 1. Visual direction

OMP should feel like a well-kept workbench: dark warm ink recedes, the
transcript is calm and readable, copper signals user intent, and teal signals
agent/system activity. The interface is dense enough for coding work without
turning every status into a badge or every panel into a card.

### Principles

1. **The work is the interface.** Give the transcript, code, tool outputs, and
   user decisions visual priority. Chrome should be quiet and spatially stable.
2. **Readable for long sessions.** Default transcript copy is 16 px with 1.5
   line height. Code is 13 px with generous leading. Constrain prose to a
   readable measure; do not force it edge-to-edge on wide displays.
3. **State is explicit.** Every action shows a named state—queued, running,
   succeeded, failed, waiting for you, or stopped. Never communicate state
   only through color, a spinner, or a moving dot.
4. **Progressive disclosure.** Show a useful tool summary first. Raw commands,
   logs, diffs, and subagent detail expand on demand and preserve their state.
5. **Deliberate color.** Copper is for the primary user action and focused
   urgency. Teal is for active system state and links. Semantic colors carry
   status. No rainbow of arbitrary “agent personalities.”
6. **Keyboard parity.** Everything possible with a pointer must be possible
   without one, with a predictable focus order and visible focus.
7. **Motion has a job.** Animate state changes only to explain where something
   appeared or changed. Streaming is content, not an animation.
8. **Local-first trust.** Clearly identify offline, reconnecting, local,
   queued, or remote states. Do not imply that a task completed if the client
   lost the event stream.

### Token use

`packages/web/src/styles/tokens.css` is authoritative. Components consume
semantic tokens (`--color-surface`, `--color-text-muted`, `--color-accent`)
rather than hard-coded palette values. `base.css` imports those tokens and
supplies the reset, base elements, and focus utilities.

The default is dark (`:root`). Put `data-theme="light"` or
`data-theme="dark"` on `<html>` to make a user choice explicit. Do not mix
theme-specific literals into component CSS.

## 2. Typography and hierarchy

Use the sans stack for interface and prose; use the mono stack only for source
code, paths, commands, structured output, and keyboard keys.

| Role | Token / style | Use |
| --- | --- | --- |
| Session / section title | `--font-size-lg`, 600, tight | Current session, panel title |
| Transcript prose | `--font-size-base`, 400, normal | User and assistant messages |
| Assistant heading | `--font-size-lg` or `--font-size-xl`, 600 | Markdown `h2` / `h1` in answers |
| UI label | `--font-size-sm`, 500 | Buttons, controls, metadata |
| Metadata | `--font-size-xs`, 500, wide uppercase only when needed | Timestamps, tool status labels |
| Code / logs | `--font-size-sm`, mono, relaxed | Commands, diffs, tool output |

Rules:

- Keep body copy at 16 px. `--font-size-xs` is for supplementary metadata, not
  paragraphs or essential action labels.
- Keep transcript prose at `max-inline-size: var(--content-max-width)`;
  individual code blocks may use the full transcript column.
- Use 400, 500, and 600 weights in normal UI. Reserve 700 for concise,
  high-level headings.
- Use sentence case for labels. Use ALL CAPS only for compact category labels.
- Use tabular figures (`.u-tabular-nums`) for durations, counts, token use, and
  line numbers.

## 3. Layout grid and responsive behavior

### Application shell

The desktop shell has three independently scrollable regions:

```text
┌──────────── sidebar ────────────┬──────────── main ────────────┬─ drawer ─┐
│ product / connection             │ sticky transcript header     │ files    │
│ new session                      │                               │ git      │
│ session list                     │ scrollable transcript         │ plans    │
│                                  │                               │          │
│                                  │ sticky composer / queue bar   │          │
└──────────────────────────────────┴───────────────────────────────┴──────────┘
```

- **Sidebar:** `--sidebar-width` (280 px). It is a navigation landmark, not a
  second content feed. It contains product state, New session, search/filter,
  and session history.
- **Main column:** fluid with a minimum practical width of 560 px at desktop.
  Center the readable transcript column (`--content-max-width`: 832 px) inside
  it. The composer may be slightly wider (`--composer-max-width`: 928 px).
- **Drawer:** `--drawer-width` (352 px). It is contextual and can be hidden.
  Opening it must not steal focus unless invoked by keyboard; it should not
  cover the composer’s active text cursor without user intent.
- **Gutters:** use 24 px outer desktop padding and 16 px inner gaps as a
  baseline. At compact desktop widths, reduce outer padding to 16 px before
  shrinking type.
- **Chrome:** use 1 px borders and surface changes to define regions. Avoid
  permanent heavy shadows; reserve elevated shadows for transient popovers,
  dialogs, and dragged elements.

### Breakpoints and reflow

| Width | Behavior |
| --- | --- |
| `>= 1280px` | Three-region shell when the drawer is open. |
| `960–1279px` | Sidebar remains visible; drawer becomes an overlay sheet or closes by default. |
| `720–959px` | Sidebar and drawer become modal sheets. Main transcript is the only persistent region. |
| `< 720px` | Stack controls, preserve a 16 px composer gutter, and expose navigation/drawer from explicit buttons. Never hide an action solely because the viewport is narrow. |

Do not use page-level scrolling for the normal shell. The document body remains
stable; the transcript is the primary scroll container. Avoid nested scrolling
inside a message except for intentional code/log blocks.

### Spacing and density

- Use the 4 px token scale. Common component padding: 8/12 px for compact
  controls, 12/16 px for cards, 16/24 px for transcript sections.
- Keep at least 44 × 44 CSS px pointer targets for standalone icon buttons.
  Compact inline controls may be 32 px only when an adjacent visible text
  action exposes the same operation.
- Transcript messages are separated by 24–32 px, not boxed by default.
  Tool cards and decision requests use a surface to create a distinct task
  boundary.

## 4. Components and interaction patterns

### 4.1 Session sidebar

- Use a semantic `nav` landmark with an accessible name such as “Sessions.”
- A session row shows title, optional relative time, and a compact status
  indicator. Status is text in the accessible name, e.g. “Build fix,
  streaming.”
- The active session uses `--color-surface-selected` and a non-color cue:
  a 2 px inset start border, current-page semantics (`aria-current="page"`),
  and stronger text.
- A context menu is opened by a labelled button. It must not be the only route
  to rename, pin, export, or delete: provide equivalent shortcuts or a details
  view where important.
- Deleting a session is reversible where possible. If it is permanent, require
  a confirmation dialog with the session name and a destructive verb.

### 4.2 Transcript

- Mark the transcript as a named `main` region containing an ordered feed
  (`<ol>` is preferred when messages have a meaningful chronological order).
- Each turn is an `article` with a visible speaker label or an accessible
  label (“You”, “OMP”). Do not rely on avatar color or position alone.
- User turns are calm, subtly distinct surfaces; assistant turns are mostly
  unboxed to keep long technical prose legible. Do not use chat-bubble tails.
- Render Markdown with semantic elements. Do not skip heading levels in
  assistant content. Copy buttons must have an explicit label, e.g. “Copy code
  block,” and then report success.
- A “Jump to latest” button appears only when the user is reading earlier
  content. It includes the count of unseen updates where useful (“Jump to
  latest — 3 updates”). Do not auto-scroll when the user has moved away from
  the bottom.
- System timeline entries (connection changed, run cancelled, context
  compacted) are visually quieter but remain readable and available to screen
  readers as normal content, not as repeated live announcements.

### 4.3 Streaming behavior

Streaming should make the latest assistant turn feel alive without making the
page unstable or verbose to assistive technology.

1. Create the assistant turn immediately with a concise visible status:
   “OMP is responding” or “Running `pnpm test`.”
2. Append text to the active turn. Preserve selection, expanded card state,
   and scroll position. Never remount the whole transcript on each chunk.
3. If the viewport is at (or within roughly 24 px of) the bottom, follow the
   stream. If not, stop following and expose “Jump to latest.”
4. Use a subtle non-essential stream indicator near the active message only;
   do not animate every character, bounce content, or continuously pulse a
   large element.
5. At completion, replace the active status with “Response complete” only
   when that is useful; avoid adding redundant timeline noise. Move focus
   nowhere automatically.
6. On interruption, keep all partial content and append a named state:
   “Stopped,” “Connection lost — partial response shown,” or “Run failed.”
   Offer a clear retry/resume action if supported.
7. The screen-reader announcement policy is defined in
   `A11Y_CHECKLIST.md`: announce bounded summaries at a throttled cadence, not
   the raw stream.

### 4.4 Tool cards

Tool cards represent agent actions that touch code, files, commands, or
external resources. They must answer “what happened?”, “what is happening?”,
and “what can I inspect?” at a glance.

**Anatomy**

```text
┌ [status icon]  Read file                                  0.2 s   [⌄] ┐
│                  src/app.ts                                           │
│  Summary: Read 184 lines                                               │
│  ───────────────────────────────────────────────────────────────────  │
│  Expanded: command / arguments / output / affected files / retry      │
└───────────────────────────────────────────────────────────────────────┘
```

- **Header:** status icon plus textual status; human-readable tool name;
  target (path, command, or resource); elapsed time when known; an accessible
  expand/collapse button. The entire header should not become a mysterious
  clickable region.
- **Summary:** one outcome sentence, even for successful actions. Never make
  users parse raw output to learn whether the action succeeded.
- **Detail:** collapsible and keyboard-operable. Preserve expanded state during
  streaming and between minor rerenders. Format paths/commands as code and
  logs in a horizontally scrollable `pre`; do not wrap every line of output.
- **Status vocabulary:** Queued, Running, Succeeded, Failed, Cancelled,
  Skipped, Waiting for approval. Pair the label with a shape/icon and
  semantic color. A running card may show elapsed time; never infer progress
  from an indefinite spinner alone.
- **Failure:** show the concise reason and a next action (Retry, View output,
  Edit request). Keep output available. Failure cards use danger tokens but do
  not make the entire surface red.
- **Destructive action:** show the intended effect and path/count before
  approval. Do not let a tool card silently execute a consequential operation.

Use `article` for each card. Its header is a real heading (`h3` or appropriate
level) and its details use a native `<details>`/`<summary>` when that structure
fits, or a labelled button with `aria-expanded` and `aria-controls`.

### 4.5 Subagent panels

Subagents are a focused cluster of work, not a separate chat UI inside the
chat.

- Use a bounded panel within the parent assistant turn with a clear heading:
  “Subagent: repository analysis.”
- Summary line: status, short objective, duration/last update. Expand only
  one level by default; avoid a permanently expanded nested transcript.
- Expose an ordered internal activity list on expansion, using the same tool
  card semantics. Associate results with their parent task.
- Never stream multiple subagents into one unlabelled live region. Announce
  changes as a summary (for example, “Repository analysis completed”) rather
  than each internal operation.
- Subagent controls (stop, view output, retry) must identify the subagent in
  their accessible names.

### 4.6 Composer, queue, and abort

- The composer is a named form landmark at the bottom of the main region. Its
  text area label is programmatic even if visible placeholder text is present.
- Text area grows to a sensible maximum (about 8 lines) and then scrolls
  internally. It must never cover the send, model, queue, or abort controls.
- `Enter` submits; `Shift+Enter` inserts a line break. If IME composition is
  active, do not submit until composition ends. Provide a visible Send button.
- Model selection opens a labelled listbox/menu with the current model,
  availability, and any local/offline qualifier. Do not put model metadata
  only in a tooltip.
- When a run is active, replace Send with an explicit **Stop** / **Abort**
  action. It is visually prominent but not styled as an irreversible delete.
  On activation, it immediately becomes “Stopping…” and remains disabled
  until a terminal event arrives or a recoverable error is shown.
- The queue state is visible in a compact queue bar, including a count and
  ordering controls. Reordering is keyboard-operable or has non-drag
  alternatives. “Queued” is not the same as “sent.”
- Composer errors are associated with the input via `aria-describedby`; focus
  returns to the editor when a validation error prevents send.

### 4.7 Approval and question flows

Agent interruptions must be clear decisions, not vague system notifications.

#### Approval

Use a modal dialog for an approval that blocks progress, especially commands
that write, delete, install, send, or connect externally.

1. Title is a question with the impact: “Allow OMP to modify 3 files?”
2. Body identifies the agent action, command/paths, scope, and meaningful risk.
   Render exact commands/paths in readable code blocks.
3. Primary action has an explicit verb: “Allow once”, “Run command”, or
   “Apply changes”; never “OK.”
4. A secondary safe action is “Deny” or “Not now.” If cancelling preserves the
   request without deciding, label it “Decide later.”
5. Make duration/scope choices explicit (“Allow for this session”) and default
   to the narrowest safe scope. A broad approval is never preselected.
6. On decision, close the dialog, return focus to the invoking element if it
   remains, and append a normal transcript state. Do not re-announce the full
   command as a toast.

#### Question

Use an inline decision card in the transcript for non-blocking clarifications;
use a dialog only if it needs focused multi-field input or blocks the entire
agent run.

- The question title, context, and all choices are plain language. Choices are
  buttons/radios with enough context to stand alone.
- Provide “Other…” when free text is valid. Focus the input only after that
  option is chosen, not on every question card.
- Submitted answer becomes immutable transcript history with an Edit/re-answer
  path if the underlying agent protocol permits it.
- Timeout or expired request states must say what happened and offer a
  recoverable next step.

### 4.8 Right drawer: files, git, plans

- Implement it as a labelled complementary region when docked. As an overlay,
  it is a dialog/sheet with the corresponding focus behavior.
- Tabs use the tabs pattern: `role="tablist"`, tabs with `aria-selected`, and
  labelled `tabpanel` elements. Arrow keys move between tabs; Tab exits the
  tablist to the active panel.
- Files expose paths as accessible names. Long paths truncate visually with a
  tooltip/title only as a supplement; the full path remains in the accessible
  name or visually revealed on focus.
- Git changes use additions/deletions labels and symbols plus color; do not
  rely on green/red alone. Provide files changed counts in text.
- Plans are structured ordered steps. A status chip is supplemental; use
  textual labels such as “Step 2 of 4 — In progress.”

## 5. States and feedback

### Empty states

Each empty state has: a concise title, a one-sentence explanation, and the
next useful action. Do not use decorative illustrations as the sole
explanation.

| Context | Title | Action |
| --- | --- | --- |
| New transcript | “Start a task” | Focus the composer; suggest 2–3 local examples. |
| No session search matches | “No sessions match ‘…’” | Clear search. |
| No changed files | “Working tree is clean” | Refresh only if the data can be stale. |
| No plan | “No plan yet” | Explain it will appear when the agent creates one. |
| No file preview | “Select a file to preview it” | Keep keyboard focus in the file list. |

### Loading and connecting

- Use skeletons only for content whose shape is already known (session rows,
  file list rows). Skeletons never replace an actionable control for more than
  a short transition.
- For actions, show a textual state next to or inside the affected component:
  “Loading files…”, “Connecting to local agent…”, “Saving session…”.
- After 1–2 seconds, include meaningful progress/context where available.
  Indeterminate loading must still offer Cancel, Retry, or a way to continue
  elsewhere when technically possible.
- Keep layout dimensions stable while content loads.

### Errors

- State the failed operation, a human-readable reason, and next action:
  “Couldn’t read `src/app.ts`: permission denied. Check file permissions or
  retry.”
- Render errors near their origin. Use a toast only for a transient
  confirmation, not the sole record of a failed operation.
- Preserve unsent composer text, partial streamed text, selected file, and
  expansion state after recoverable errors.
- Do not disclose secrets, opaque stack traces, or full local paths beyond
  what the user has already chosen to reveal. Advanced diagnostic details can
  be copied deliberately.

### Offline and reconnecting

Use a persistent, non-modal connection banner above the transcript:

| State | Message | Behavior |
| --- | --- | --- |
| Reconnecting | “Reconnecting to local agent…” | Keep transcript readable; disable only requests that cannot queue. |
| Offline | “Local agent is unavailable. Your draft is kept on this device.” | Offer Reconnect and explain whether queued actions will run. |
| Recovered | “Connected to local agent.” | Dismiss automatically after a short period or when the next normal action occurs. |
| Event gap | “Connection was interrupted. Some live updates may be missing.” | Mark affected run as unknown/partial and offer refresh or resume. |

Never treat a WebSocket reconnect as proof that a previously running command
completed. Fetch or request terminal state before marking it done.

## 6. Keyboard interaction map

The following shortcuts apply when their target is available. Do not intercept
common browser, assistive-technology, text-editing, or operating-system
shortcuts. Show shortcuts in menus/tooltips and make all of them discoverable
from a Keyboard shortcuts dialog.

| Key | Action | Notes |
| --- | --- | --- |
| `Ctrl/Cmd + Enter` | Send from composer | Alternative to Enter; useful in multiline mode. |
| `Enter` | Send from composer | Only when not composing with an IME. |
| `Shift + Enter` | New line in composer | Never sends. |
| `Escape` | Close the topmost menu, popover, drawer sheet, or dialog | Does not clear a draft or stop a run. |
| `Ctrl/Cmd + K` | Focus session search / command launcher | Choose one consistent launcher behavior. |
| `Ctrl/Cmd + Shift + N` | New session | Focus the new session title/composer when created. |
| `Ctrl/Cmd + .` | Abort current run | Must have a visible equivalent and confirmation only if stopping is slow or ambiguous. |
| `Alt + [` / `Alt + ]` | Previous / next session | Do not override if the browser/OS claims it; provide buttons too. |
| `[` / `]` in a focused transcript card | Previous / next card | Optional enhancement only; never block normal typing. |
| `?` | Open keyboard shortcut help | Only when focus is not in editable content. |

Within lists, menus, tabs, and dialogs, follow the WAI-ARIA Authoring
Practices keyboard conventions. A custom widget requires its complete keyboard
model; native controls are preferred when they fit.

## 7. Accessibility requirements

The acceptance criteria are in
[`A11Y_CHECKLIST.md`](./A11Y_CHECKLIST.md). The following rules are mandatory
in component design and code review.

### Focus management

- Focus order follows visual order: skip link → app navigation → main header →
  transcript → composer → drawer when docked.
- Opening a menu moves focus to its first actionable item only when opened by
  keyboard. Pointer-opened transient content may leave focus on its trigger
  when that preserves expected behavior.
- Dialogs and overlay sheets move focus to a meaningful first control or
  static title, trap focus, restore focus to the trigger on close, and close
  with Escape unless an operation is non-dismissible.
- Never move focus when streamed content arrives, a tool completes, a toast
  appears, or the transcript autoscrolls.
- A visible `:focus-visible` ring is required. Use `.u-focus-ring` for
  controls whose component styles would otherwise obscure the base ring.

### Semantic and ARIA contract

| UI | Required structure |
| --- | --- |
| App regions | `<nav aria-label="Sessions">`, `<main aria-label="Conversation">`, `<aside aria-label="Workspace">`; composer is a labelled `<form>`. |
| Transcript | Ordered list/feed of labelled `article` turns; speaker identity and timestamp are programmatic. Do **not** assign `role="log"` to the entire growing transcript. |
| Active stream | A small dedicated `role="status"` / `aria-live="polite"` region outside the transcript flow; update with throttled summaries only. |
| Tool card | `article` + heading; status text; disclosure button with `aria-expanded` and `aria-controls` (or semantic `details/summary`). |
| Subagent panel | Named `section` / `article`, labelled by its heading; child activity is a list. |
| Dialog | Native `<dialog>` where viable, otherwise `role="dialog" aria-modal="true" aria-labelledby="…"`, plus `aria-describedby` for the decision context. |
| Alert dialog | `role="alertdialog"` only for urgent, interruptive confirmations requiring immediate acknowledgement. Do not overuse. |
| Toast | `role="status"` for confirmations; `role="alert"` only for time-sensitive errors. Do not put buttons only in an auto-dismissed toast. |
| Tabs | `tablist`, `tab`, `tabpanel`, selected/controls relationships, roving focus or active-descendant behavior. |

### Reduced motion

Respect `prefers-reduced-motion: reduce`. Tokens reduce durations to zero and
`base.css` disables nonessential animation/transitions. In that mode:

- Stream text appears without typewriter/cursor animation.
- Drawers, dialogs, card expansion, and toasts appear/disappear without
  movement.
- Do not auto-scroll except for direct user navigation such as “Jump to
  latest.”
- State is still shown through text, color, and structure.

## 8. Anti-patterns to avoid

- **Chat-app cosplay:** no copied visual trade dress, bubble geometry, branded
  gradients, or interaction patterns intended to evoke another product.
- **Autoscroll theft:** never pull a reader to the bottom while they inspect
  earlier context.
- **Spinner-only status:** a spinner without a status label, elapsed time, or
  cancel/retry path is insufficient.
- **Color-only semantics:** do not represent success/failure, diffs, selected
  state, required fields, or agent ownership solely with hue.
- **Everything is a card:** long assistant content should breathe. Cards are
  for bounded interactions such as tools, subagents, approvals, and errors.
- **Unstable streaming:** avoid full-list remounts, scroll jumps, flickering
  Markdown, changing card heights without reason, and reordering content.
- **Hover-only controls:** touch and keyboard users need an always-reachable
  route. Hover can reveal secondary actions, never conceal the only action.
- **Tooltip as label:** icon buttons, inputs, and important statuses require
  accessible names and visible context; tooltips are supplemental.
- **Nested focus traps:** a popover in a modal is fine; two independently
  trapping layers are not. Close or suspend the lower transient layer.
- **Destructive euphemisms:** use “Delete”, “Discard”, “Stop”, “Deny”, and
  “Apply” rather than “Done”, “OK”, or ambiguous icon-only controls.
- **Excess motion and glow:** no endless pulse, artificial terminal typing,
  parallax, or ornamental gradient. Use depth and color sparingly.
- **Tiny dense text:** never use 11–12 px for essential UI, logs users must
  debug, or long explanatory content.

## 9. Implementation review questions

Before accepting a new view or component, ask:

1. Can a user identify the current session, current agent state, and next
   possible action in under a glance?
2. Does a 30-minute transcript remain scannable without an ocean of borders?
3. Does the layout hold when a path, command, error, or model name is very
   long?
4. Is every state expressed as text and structure in addition to color?
5. Can keyboard and screen-reader users make the same decision at the same
   point in the workflow?
6. Does streaming preserve reading position and avoid excessive announcements?
7. Do the dark and light tokens maintain contrast and preserve the same
   semantic meaning?
