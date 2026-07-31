# Learning tools and model services

## Learning principles

Kakarayan begins with Amis because the initial collaborator and learner feedback is
Amis-centered. The architecture remains capability-aware so other Formosan languages can
gain the same tools when public data, reviewed content, or models support them.

The learner interface separates three kinds of material:

1. Attested corpus examples with exact source provenance.
2. Human-reviewed teaching or orthography content with named review metadata.
3. Machine output labeled as an unreviewed draft.

The interface does not present an attestation as a universal grammar rule and does not
present model output as a correction or community endorsement.

## Dictionary and examples

Learner lookup defaults to Amis and searches the same immutable corpus shards as the
research view. Results show:

- Standard and original forms separately.
- Available translation language labels.
- Corpus and dialect.
- Source XML link pinned to the release commit.
- Record ID.
- Local save action.

The source link remains the authority when a simplified card cannot display every XML tier.

## Local study deck

Saved records become local study cards pinned to the release that supplied them. Review
state uses a deterministic small spaced-repetition schedule. The learner chooses a grade,
which updates interval and due time on the device.

The deck supports:

- Due-card review.
- JSON backup.
- Validated JSON restore.
- Anki-compatible TSV export.
- Formula-safe text fields.

There is no login, cloud synchronization, leaderboard, or hidden learner telemetry.

## Pronunciation recording

The browser MediaRecorder API captures a learner's voice after explicit microphone
permission. A recording can be played, downloaded, deleted, or optionally sent for ASR.

Recording availability depends on browser support and permission. A lack of recording or
ASR capability does not disable corpus examples or the study deck.

## Orthography

The orthography tool projects public reviewed FormosanBank conversion tables. It:

- Names the language and table.
- Lists dialect outputs.
- Applies longer input patterns before shorter ones.
- Preserves unsupported characters.
- Shows the pinned source commit and source table path.

It is labeled as orthographic conversion, not phonetic transcription or universal spelling
correction.

## Machine translation and ASR

Model tools call configured public FormosanBank Hugging Face Spaces directly from the
browser. The application does not contain a token and does not depend on a Kakarayan
backend.

The interaction includes:

- Explicit third-party consent before sending content.
- Named destination and task.
- Cold-start messaging.
- Cancellation.
- Timeout and failure states.
- Preservation of the user's source input when a call fails.
- Clear draft labeling on output.

Free public Spaces may sleep, change, rate-limit, or become unavailable. These tools are
optional enhancements.

## Model catalogue

The publisher reads only the official public Hugging Face API for the FormosanBank
organization when `--refresh-models` is used. The catalogue records:

- Repository and task.
- Public URL.
- Model-card license or `unknown`.
- Languages.
- Translation direction where discoverable from the repository name.
- Last modified time.
- Training-lineage notice visible in public metadata.
- General limitations.
- Optional browser service ID.

Known public Spaces are listed with task, URL, API URL, availability state, and a
third-party notice. `unchecked` means the Space was publicly listed but was not treated as
a guaranteed production service.

Private training data is not accessed, copied, indexed, or packaged. If a public model card
mentions private training lineage, Kakarayan displays that disclosure.

## Human-reviewed learning content

The current release supplies corpus-based learning tools and orthography tables. A future
lesson, grammar explanation, correction rule, or vocabulary set should not be added as
anonymous prose.

Reviewed material should record:

- Stable content ID.
- Language and dialect scope.
- Author.
- Community or linguistic reviewer.
- Review date and version.
- Source citations.
- Rights or license.
- Intended learner level.
- Orthography convention.
- Known limitations or regional variation.

English and Traditional Chinese versions require equivalent review. Machine translation
may help drafting but cannot be published as reviewed teaching content without human
approval.

## LLM and retrieval extensions

A future grammar assistant, vector index, MCP server, or retrieval tool should use the same
release and provenance contracts:

- Retrieve from public, reviewed sources only.
- Return source paths, record IDs, release ID, and citations.
- Keep attested examples separate from generated explanations.
- State uncertainty and variation.
- Never treat corpus frequency as a prescriptive grammar rule.
- Keep private data and personal learner data outside the index.
- Apply the same rights filter as downloadable artifacts.

Such a service would require a separate security, cost, evaluation, and governance review.
It is not implied by the current no-backend static site.

## Evaluation with collaborators

Learner feedback should cover:

- Whether search terminology is understandable without linguistic training.
- Whether original and standard labels make sense.
- Whether examples help produce or understand real Amis.
- Whether source and dialect information is visible but not distracting.
- Whether local card and recording controls feel trustworthy.
- Whether model consent and draft warnings are clear.
- Which reviewed lesson or grammar features would be most valuable next.

Community and language-expert review should guide terminology, content priority, dialect
presentation, and claims of correctness.
