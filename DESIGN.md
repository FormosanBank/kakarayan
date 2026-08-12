# Kakarayan interface design

Kakarayan is a working language resource, not a product-marketing site. The interface
should feel quiet, direct, credible, and easy to scan on a phone. Corpus data, source
evidence, and user actions take priority over decoration and explanatory copy.

## Principles

1. Show the tool before explaining the tool.
2. Keep result summaries compact. Load rich linguistic detail only when requested.
3. Use plain controls with visible labels and predictable browser behavior.
4. Keep English and Traditional Chinese equally usable.
5. Distinguish attested corpus evidence, reviewed learning material, and machine output.
6. Preserve identifiers, source paths, citations, rights, and release identity without
   repeating them in every collapsed result.
7. Avoid generic illustrations, animations, gradients, oversized text, dashboard chrome,
   and promotional filler.

## Visual system

The site uses a white canvas, black text, neutral gray supporting text, one-pixel rules,
and no shadows. The woven band under the navigation is the only decorative color. It is a
small visual reference to Formosan headband patterns, not a claim that one pattern
represents every community.

Core tokens live in `site/src/styles/base.css`:

| Role | Value |
| --- | --- |
| Canvas | `#ffffff` |
| Soft surface | `#fafafa` |
| Primary ink | `#000000` |
| Supporting text | `#737373` |
| Hairline | `#e5e5e5` |
| Strong hairline | `#d4d4d4` |
| Error | `#b42318` |
| Success | `#176b3a` |
| Focus ring | `rgba(59, 130, 246, 0.5)` |

Do not introduce another decorative accent. Semantic colors are allowed only when state
cannot be communicated clearly through text and structure alone.

## Typography and density

- Use the system sans stack for body text and controls.
- Use the rounded system display stack for headings.
- Use the system monospace stack for identifiers, paths, checksums, and code.
- Default body text is 16px. Most tool controls and metadata are 12px to 14px.
- Page headings are 36px on wide screens and reduce responsively.
- Prefer short page titles without a paragraph when the interface is self-explanatory.

The main content width is 1120px. Prose and the landing page use a 720px measure. Tool
workspaces should use the full available page width. Do not place a wide page around a
narrow tool card.

## Components

### Navigation

The sticky navigation is 56px tall plus the 20px woven band. The primary actions are
Lookup, Learn, Research, Docs, Download, and Developers. Secondary resources remain in the
footer and mobile menu. The locale control always shows `EN` and `繁中`.

### Buttons and fields

- Primary actions use a black pill.
- Secondary actions use a white or soft-neutral pill with a hairline border.
- Fields always have visible labels.
- Disabled actions remain visibly disabled and must have a nearby reason when the reason
  is not obvious.
- Focus uses the shared three-pixel focus ring.

### Search results

Dictionary cards show the attested form, selected meanings, occurrence count, and source
scope. Sentence search initially shows the source scope, sentence, and up to three
translations. Full tiers, audio, citation controls, and source links appear only after the
user opens a record.

Do not render hundreds of results. The first page is 25 summaries and subsequent pages use
the API cursor.

### Research tools

The dataset builder uses a two-column control and summary layout on wide screens and one
column on small screens. Column choices use compact check rows, not oversized circular
controls. Matching row counts and the finite export limit update with the preview. Prepared
full datasets are a separate route.

### Status and errors

Use short, specific messages. Name the unavailable capability and keep unrelated tools
usable. Do not expose stack traces, raw internal codes, query text, or repetitive privacy
copy in the interface.

## Responsive and accessibility requirements

- Support 320px width without horizontal page overflow.
- Use native headings, labels, fieldsets, tables, details, buttons, and links.
- Keep touch targets at least 36px high, with larger spacing on narrow screens.
- Every route must remain keyboard operable.
- Preserve visible focus and a working skip link.
- Keep `html.lang` synchronized with the selected interface locale.
- Run the focused Chromium and Axe journey on every pull request.
- Do not add motion unless it explains a changing state. Respect reduced-motion settings.

## Review checklist

- Is the primary task visible immediately?
- Is any sentence redundant or promotional?
- Does the page work in both locales?
- Are source and rights details available without dominating the result?
- Is full record data loaded only after an explicit action?
- Does the layout use the available width without crowding?
- Are empty, unavailable, loading, validation, and permission states clear?
- Does the page pass keyboard, responsive, and automated accessibility checks?
