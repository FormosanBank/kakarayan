import re

from django import template
from django.utils.html import escape
from django.utils.safestring import mark_safe

register = template.Library()


@register.filter(is_safe=True)
def highlight(text, query):
    """Wrap occurrences of query in <mark class="kk-highlight"> (case-insensitive).

    Escapes the text first so the output is always safe to render unescaped.
    """
    if not query or not text:
        return escape(text) if text else ""
    pattern = re.compile(re.escape(str(query)), re.IGNORECASE)
    result = []
    last = 0
    for m in pattern.finditer(str(text)):
        result.append(escape(text[last : m.start()]))
        result.append(f'<mark class="kk-highlight">{escape(m.group())}</mark>')
        last = m.end()
    result.append(escape(text[last:]))
    return mark_safe("".join(result))
