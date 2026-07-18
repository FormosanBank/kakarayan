"""Dictionary search views.

Search paths:
- Word search (dir=word): query Token.surface_norm with prefix match
- Meaning search (dir=en|zh): query Translation.text_norm with icontains

The HTMX endpoints return HTML partials only; direct access redirects to the
index so bookmarked search URLs restore state via the index view's GET handling.

xml_lang codes in the corpus follow ISO 639-3: 'eng' for English, 'zho' for
Chinese.  These are distinct from the BCP-47 UI language codes ('en', 'zh-hant').
"""

from math import ceil

from django.db.models import Exists, OuterRef, Prefetch
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404, render
from django.urls import reverse

from corpus.ingestion.normalize import normalize_gloss, normalize_surface
from corpus.models import (
    AudioSegment,
    Corpus,
    Language,
    Morpheme,
    Token,
    Translation,
)

PAGE_SIZE_DICT = 20
PAGE_SIZE_KWIC = 30
MIN_Q_WORD = 2   # minimum chars for Formosan word search
MIN_Q_MEANING = 3  # minimum chars for meaning/translation search

# ISO 639-3 codes as stored in Translation.xml_lang
_XML_LANG_EN = 'eng'
_XML_LANG_ZH = 'zho'

# Maps Language.name → ribbon CSS modifier class.  Cycles through the 5 tribal
# accent colours so different languages get visually distinct card headers.
_RIBBON_COLORS = ['blue', 'gold', 'red', 'green', 'clay']
_lang_color_cache: dict[str, str] = {}


def _ribbon_color(language_name: str) -> str:
    if language_name not in _lang_color_cache:
        idx = len(_lang_color_cache) % len(_RIBBON_COLORS)
        _lang_color_cache[language_name] = _RIBBON_COLORS[idx]
    return _lang_color_cache[language_name]


def _search_ready(q: str, direction: str) -> bool:
    """True if q meets the minimum length for its search direction."""
    if not q:
        return False
    if direction == 'word':
        return len(normalize_surface(q)) >= MIN_Q_WORD
    q_norm = normalize_gloss(q)
    return len(q_norm) >= MIN_Q_MEANING or _has_cjk(q_norm)


def _parse_params(request):
    q = request.GET.get('q', '').strip()
    lang = request.GET.get('lang', '').strip()
    corpus_name = request.GET.get('corpus', '').strip()
    direction = request.GET.get('dir', 'word').strip()
    if direction not in ('word', 'en', 'zh'):
        direction = 'word'
    view_mode = request.GET.get('view', 'dict').strip()
    # Coerce direction so English-UI users can't reach zh search and vice-versa.
    ui_lang = getattr(request, 'LANGUAGE_CODE', 'en')
    if direction == 'zh' and not ui_lang.startswith('zh'):
        direction = 'word'
    elif direction == 'en' and ui_lang.startswith('zh'):
        direction = 'word'
    try:
        page = max(1, int(request.GET.get('page', 1)))
    except (ValueError, TypeError):
        page = 1
    translation_lang = request.GET.get('translation', '').strip()
    if translation_lang not in ('', _XML_LANG_EN, _XML_LANG_ZH):
        translation_lang = ''
    return q, lang, corpus_name, direction, view_mode, page, translation_lang


def _preferred_xml_lang(request) -> str:
    """Return the corpus translation xml_lang to prefer given the UI language.

    Returns ISO 639-3 codes ('zho', 'eng') matching what is stored in
    Translation.xml_lang.
    """
    lang = getattr(request, 'LANGUAGE_CODE', 'en')
    return _XML_LANG_ZH if lang.startswith('zh') else _XML_LANG_EN


def _translation_prefetch(preferred_lang: str) -> Prefetch:
    """Prefetch sentence-level EN and ZH translations, preferred lang first."""
    return Prefetch(
        'sentence__translations',
        queryset=Translation.objects.filter(
            xml_lang__in=[_XML_LANG_EN, _XML_LANG_ZH],
            word__isnull=True,
            morpheme__isnull=True,
        ).order_by(
            # put preferred language first: 'zho' > 'eng' alphabetically
            '-xml_lang' if preferred_lang == _XML_LANG_ZH else 'xml_lang'
        ),
        to_attr='ui_translations',
    )


def _has_cjk(text: str) -> bool:
    return any('一' <= c <= '鿿' for c in text)


def _run_search_word(q, lang, corpus_name, translation_lang=''):
    """Return a Token queryset filtered by surface_norm prefix + optional lang/corpus."""
    q_norm = normalize_surface(q)
    if not q_norm or len(q_norm) < MIN_Q_WORD:
        return Token.objects.none()
    qs = Token.objects.filter(surface_norm__startswith=q_norm)
    if lang:
        qs = qs.filter(language__name=lang)
    if corpus_name:
        qs = qs.filter(corpus__name=corpus_name)
    if translation_lang:
        qs = qs.filter(Exists(
            Translation.objects.filter(
                sentence=OuterRef('sentence'),
                xml_lang=translation_lang,
                word__isnull=True,
                morpheme__isnull=True,
            )
        ))
    return qs


def _run_search_meaning(q, lang, corpus_name, xml_lang):
    """Return a Translation queryset for sentence-level meaning search.

    xml_lang must be an ISO 639-3 code ('eng' or 'zho').
    """
    q_norm = normalize_gloss(q)
    min_len = 1 if _has_cjk(q_norm) else MIN_Q_MEANING
    if not q_norm or len(q_norm) < min_len:
        return Translation.objects.none()
    qs = Translation.objects.filter(
        text_norm__icontains=q_norm,
        xml_lang=xml_lang,
        sentence__isnull=False,
        word__isnull=True,
        morpheme__isnull=True,
    ).select_related('sentence__text__corpus', 'sentence__text__language', 'sentence__text__dialect')
    if lang:
        qs = qs.filter(sentence__text__language__name=lang)
    if corpus_name:
        qs = qs.filter(sentence__text__corpus__name=corpus_name)
    return qs


def _page_range(current: int, total: int) -> list:
    """Return page numbers to display in pagination; None represents an ellipsis."""
    if total <= 1:
        return []
    if total <= 9:
        return list(range(1, total + 1))
    keep = {1, total, current, max(1, current - 1), min(total, current + 1)}
    sorted_pages = sorted(keep)
    out: list = []
    for i, p in enumerate(sorted_pages):
        if i > 0 and p - sorted_pages[i - 1] > 1:
            out.append(None)
        out.append(p)
    return out


def _assemble_dict_results(qs, page: int, preferred_lang: str):
    """Group Token queryset into one-per-(surface_norm, language) with DISTINCT ON."""
    offset = (page - 1) * PAGE_SIZE_DICT
    # Count distinct (surface_norm, language_id) groups.  Using .values().distinct()
    # rather than DISTINCT ON + .count() because Django's count() wrapper doesn't
    # reliably count DISTINCT ON rows in all PostgreSQL versions.
    total_count = qs.values('surface_norm', 'language_id').distinct().count()
    total_pages = ceil(total_count / PAGE_SIZE_DICT) if total_count else 0
    tokens = (
        qs
        .order_by('surface_norm', 'language_id', 'id')
        .distinct('surface_norm', 'language_id')
        .select_related('sentence__text__corpus', 'word', 'language', 'dialect')
        .prefetch_related(_translation_prefetch(preferred_lang))
        [offset: offset + PAGE_SIZE_DICT]
    )
    results = []
    for t in tokens:
        results.append({
            'token': t,
            'ribbon_color': _ribbon_color(t.language.name),
            'translations': getattr(t.sentence, 'ui_translations', []),
        })
    return results, total_count, total_pages


def _assemble_kwic_results(qs, page: int, preferred_lang: str):
    """Return per-occurrence Token rows for concordance view."""
    offset = (page - 1) * PAGE_SIZE_KWIC
    total_count = qs.count()
    total_pages = ceil(total_count / PAGE_SIZE_KWIC) if total_count else 0
    tokens = (
        qs
        .order_by('language__name', 'surface_norm', 'id')
        .select_related('sentence__text__corpus', 'word', 'language', 'dialect')
        .prefetch_related(_translation_prefetch(preferred_lang))
        [offset: offset + PAGE_SIZE_KWIC]
    )
    results = []
    for t in tokens:
        results.append({
            'token': t,
            'translations': getattr(t.sentence, 'ui_translations', []),
        })
    return results, total_count, total_pages


def _assemble_meaning_results(qs, page: int):
    """Return Translation rows for meaning-direction search.

    Prefetches the sentence's tokens so templates can display the individual
    Formosan words from the matched sentence.
    """
    offset = (page - 1) * PAGE_SIZE_DICT
    total_count = qs.count()
    total_pages = ceil(total_count / PAGE_SIZE_DICT) if total_count else 0
    translations = list(
        qs
        .prefetch_related(
            Prefetch(
                'sentence__tokens',
                queryset=Token.objects.order_by('position'),
                to_attr='word_tokens',
            )
        )
        [offset: offset + PAGE_SIZE_DICT]
    )
    return translations, total_count, total_pages


def _build_context(q, lang, corpus_name, direction, view_mode, page,
                   results, meaning_results, total_count, total_pages,
                   preferred_lang='eng', translation_lang=''):
    """Shared context dict for both full-page and HTMX partial renders."""
    return {
        'q': q,
        'lang': lang,
        'corpus_name': corpus_name,
        'direction': direction,
        'view_mode': view_mode,
        'page': page,
        'results': results,
        'meaning_results': meaning_results,
        'search_ready': _search_ready(q, direction),
        'total_count': total_count,
        'total_pages': total_pages,
        'page_range': _page_range(page, total_pages),
        'preferred_lang': preferred_lang,
        'translation_lang': translation_lang,
    }


def _run_and_assemble(q, lang, corpus_name, direction, view_mode, page, preferred_lang,
                      translation_lang=''):
    """Execute the appropriate search and assemble results + pagination."""
    results = []
    meaning_results = []
    total_count = 0
    total_pages = 0

    if not q:
        return results, meaning_results, total_count, total_pages

    if direction == 'word':
        qs = _run_search_word(q, lang, corpus_name, translation_lang)
        if view_mode == 'kwic':
            results, total_count, total_pages = _assemble_kwic_results(qs, page, preferred_lang)
        else:
            results, total_count, total_pages = _assemble_dict_results(qs, page, preferred_lang)
    else:
        xml_lang = _XML_LANG_ZH if direction == 'zh' else _XML_LANG_EN
        qs = _run_search_meaning(q, lang, corpus_name, xml_lang)
        meaning_results, total_count, total_pages = _assemble_meaning_results(qs, page)

    return results, meaning_results, total_count, total_pages


def dictionary_index(request):
    """Main search page. Handles bookmarked URLs by running the search inline."""
    languages = list(Language.objects.values_list('name', flat=True).order_by('name'))
    corpora = list(Corpus.objects.values_list('name', flat=True).order_by('name'))

    q, lang, corpus_name, direction, view_mode, page, translation_lang = _parse_params(request)
    preferred_lang = _preferred_xml_lang(request)

    results, meaning_results, total_count, total_pages = _run_and_assemble(
        q, lang, corpus_name, direction, view_mode, page, preferred_lang, translation_lang
    )

    ctx = _build_context(q, lang, corpus_name, direction, view_mode, page,
                         results, meaning_results, total_count, total_pages,
                         preferred_lang, translation_lang)
    ctx.update({
        'languages': languages,
        'corpora': corpora,
        'ran_search': bool(q),
    })
    return render(request, 'corpus/dictionary/index.html', ctx)


def dictionary_search(request):
    """HTMX partial endpoint: returns _results.html fragment only."""
    if not request.htmx:
        return HttpResponseRedirect(reverse('dictionary') + '?' + request.GET.urlencode())

    q, lang, corpus_name, direction, view_mode, page, translation_lang = _parse_params(request)
    preferred_lang = _preferred_xml_lang(request)

    results, meaning_results, total_count, total_pages = _run_and_assemble(
        q, lang, corpus_name, direction, view_mode, page, preferred_lang, translation_lang
    )

    ctx = _build_context(q, lang, corpus_name, direction, view_mode, page,
                         results, meaning_results, total_count, total_pages,
                         preferred_lang, translation_lang)
    return render(request, 'corpus/dictionary/_results.html', ctx)


def word_expand(request, token_id: int):
    """HTMX partial: returns expanded dict card replacing the collapsed one."""
    if not request.htmx:
        return HttpResponseRedirect(reverse('dictionary'))

    preferred_lang = _preferred_xml_lang(request)

    token = get_object_or_404(
        Token.objects
        .select_related('sentence__text__corpus', 'word', 'language', 'dialect'),
        pk=token_id,
    )

    # Occurrence count for this exact (surface_norm, language) pair
    occurrence_count = Token.objects.filter(
        surface_norm=token.surface_norm,
        language_id=token.language_id,
    ).count()

    # All translations of the sentence (every xml_lang, not just EN/ZH)
    all_translations = list(
        Translation.objects.filter(
            sentence=token.sentence,
            word__isnull=True,
            morpheme__isnull=True,
        ).order_by('xml_lang')
    )

    # Phonetics: word-level if available, else sentence-level
    phon = ''
    if token.word_id:
        phon = token.word.phon_standard or token.word.phon_original
    if not phon:
        phon = token.sentence.phon_standard or token.sentence.phon_original

    # POS
    pos = token.word.word_class if token.word_id else ''

    # Morpheme breakdown (only for word-segmented tokens)
    morphemes = []
    if token.word_id:
        morphemes = list(
            Morpheme.objects.filter(word=token.word)
            .prefetch_related(
                Prefetch(
                    'translations',
                    queryset=Translation.objects.filter(
                        xml_lang__in=[_XML_LANG_EN, _XML_LANG_ZH],
                        sentence__isnull=True,
                        word__isnull=True,
                    ).order_by('xml_lang'),
                    to_attr='gloss_translations',
                )
            )
            .order_by('position')
        )

    # Audio — collect URL-bearing segments first (playable), then file-only
    sentence_audio = list(
        AudioSegment.objects.filter(sentence=token.sentence)
        .exclude(url='', file='')
        .order_by('-url')  # URL-bearing rows sort before file-only
    )
    word_audio = (
        list(
            AudioSegment.objects.filter(word=token.word)
            .exclude(url='', file='')
            .order_by('-url')
        )
        if token.word_id else []
    )
    audio_segments = sentence_audio + word_audio

    q = request.GET.get('q', '').strip()
    direction = request.GET.get('dir', 'word').strip()

    return render(request, 'corpus/dictionary/_card_dict_expanded.html', {
        'token': token,
        'occurrence_count': occurrence_count,
        'all_translations': all_translations,
        'phon': phon,
        'pos': pos,
        'morphemes': morphemes,
        'audio_segments': audio_segments,
        'ribbon_color': _ribbon_color(token.language.name),
        'preferred_lang': preferred_lang,
        'q': q,
        'direction': direction,
    })


def word_collapse(request, token_id: int):
    """HTMX partial: collapses an expanded dict card back to the simple view."""
    if not request.htmx:
        return HttpResponseRedirect(reverse('dictionary'))

    preferred_lang = _preferred_xml_lang(request)
    q = request.GET.get('q', '').strip()
    direction = request.GET.get('dir', 'word').strip()

    token = get_object_or_404(
        Token.objects
        .select_related('sentence__text__corpus', 'word', 'language', 'dialect')
        .prefetch_related(_translation_prefetch(preferred_lang)),
        pk=token_id,
    )

    entry = {
        'token': token,
        'ribbon_color': _ribbon_color(token.language.name),
        'translations': getattr(token.sentence, 'ui_translations', []),
    }
    return render(request, 'corpus/dictionary/_card_dict.html', {
        'entry': entry,
        'q': q,
        'direction': direction,
    })
