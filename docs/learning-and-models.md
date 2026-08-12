# Learning and model tools

Kakarayan combines cited corpus examples with browser-local study and optional public MT
and ASR services. Corpus lookup does not depend on model availability.

## Study deck

Users can save dictionary entries and sentence records to an IndexedDB deck. A card keeps
its FormosanBank release, corpus, source path, record ID, Formosan form, translation, and
review state. Cards therefore remain traceable even after the public site advances to a new
release.

Review scheduling and interface preferences stay in the browser. Users can export a JSON
backup and restore it on another browser. Clearing site storage removes unexported cards.

## Pronunciation and recording

Microphone access begins only after a direct user action and browser permission. A
recording remains in page memory for local playback, download, or deletion. Kakarayan does
not upload it to its query service.

ASR submission is a separate explicit action. The interface names the provider, describes
what leaves the device, and requests consent before the first submission.

## Machine translation and ASR

The published model catalogue identifies available FormosanBank Hugging Face services,
language and dialect coverage, tasks, licenses, limitations, and routes. The browser calls
the named provider directly.

Model requests:

- require explicit consent;
- reject oversized text or audio before upload;
- have timeouts and cancellation;
- show sleeping, connecting, running, success, cancellation, and failure states;
- validate provider output before presenting it;
- do not silently retry indefinitely.

Model output may be wrong and is not a replacement for a speaker, teacher, corpus citation,
or reviewed linguistic analysis. A sleeping external service can take much longer than an
ordinary corpus query.

## Orthography

Orthography tools use reviewed static conversion tables from the current release. They
apply the longest mapping once without cascading replacements. The interface does not infer
an orthography or dialect that the source did not supply.

## Failure isolation

- A model outage does not disable corpus lookup.
- A query outage does not remove saved cards, recordings already in the tab, documentation,
  catalogues, orthography tables, or prepared downloads.
- A static release mismatch prevents mixed corpus data from being shown.
- No learner account or Kakarayan write API exists in v1.

Privacy and third-party boundaries are detailed in
[rights-citation-privacy.md](rights-citation-privacy.md).
