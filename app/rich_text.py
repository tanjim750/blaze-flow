"""
Project briefs are stored as a small, allow-listed subset of HTML (what the Brief editor
writes) or, for briefs written before rich text, as plain text.

``sanitize_brief`` is the one gate: anything that looks like rich text is re-serialised
from parsed tokens, so only allow-listed tags and attributes survive and every text node is
escaped. Plain text is kept as is; the frontend always renders it escaped.
"""
import re
from html import escape
from html.parser import HTMLParser

# Shared with frontend/src/lib/rich-brief.ts: a brief is rich when it opens with a block tag.
RICH_PREFIX = re.compile(r'^\s*<(p|h[1-3]|ul|ol|blockquote|div)[\s>/]', re.IGNORECASE)

ALLOWED = {
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'h1', 'h2', 'h3',
    'ul', 'ol', 'li', 'blockquote', 'a', 'label', 'input', 'span', 'div', 'code', 'hr',
}
VOID = {'br', 'input', 'hr'}
# Whose content goes too, not just the tag.
DROP_WITH_CONTENT = {'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math', 'textarea', 'select', 'title', 'head'}
ALIGN = re.compile(r'^\s*text-align\s*:\s*(left|center|right|justify)\s*;?\s*$', re.IGNORECASE)
SAFE_HREF = re.compile(r'^(https?://|mailto:)', re.IGNORECASE)
ALIGNABLE = {'p', 'h1', 'h2', 'h3'}


def is_rich(value):
    return bool(value) and bool(RICH_PREFIX.match(value))


def _attrs(tag, attrs):
    out = []
    for name, value in attrs:
        name = (name or '').lower()
        value = value if value is not None else ''
        if name == 'style' and tag in ALIGNABLE:
            match = ALIGN.match(value)
            if match:
                out.append(('style', f'text-align: {match.group(1).lower()}'))
        elif tag == 'a' and name == 'href':
            href = value.strip()
            if SAFE_HREF.match(href):
                out.append(('href', href))
        elif tag in ('ul', 'li') and name == 'data-type' and value in ('taskList', 'taskItem'):
            out.append((name, value))
        elif tag == 'li' and name == 'data-checked' and value in ('true', 'false'):
            out.append((name, value))
        elif tag == 'ol' and name == 'start' and value.isdigit():
            out.append((name, value))
        elif tag == 'input' and name == 'checked':
            out.append(('checked', 'checked'))
    if tag == 'a':
        out += [('target', '_blank'), ('rel', 'noopener noreferrer nofollow')]
    if tag == 'input':
        out = [('type', 'checkbox'), ('disabled', 'disabled')] + [a for a in out if a[0] == 'checked']
    return ''.join(f' {name}="{escape(value, quote=True)}"' for name, value in out)


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.stack = []
        self.dropping = 0

    def handle_starttag(self, tag, attrs):
        if tag in DROP_WITH_CONTENT:
            self.dropping += 1
            return
        if self.dropping or tag not in ALLOWED:
            return
        if tag == 'input' and dict(attrs).get('type', '').lower() != 'checkbox':
            return
        self.out.append(f'<{tag}{_attrs(tag, attrs)}>')
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID and self.stack and self.stack[-1] == tag:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in DROP_WITH_CONTENT:
            self.dropping = max(0, self.dropping - 1)
            return
        if self.dropping or tag not in self.stack:
            return
        while self.stack:
            open_tag = self.stack.pop()
            self.out.append(f'</{open_tag}>')
            if open_tag == tag:
                break

    def handle_data(self, data):
        if not self.dropping:
            self.out.append(escape(data, quote=False))

    def result(self):
        self.close()
        while self.stack:
            self.out.append(f'</{self.stack.pop()}>')
        return ''.join(self.out)


def sanitize_brief(value):
    """The brief as it may be stored: rich text cleaned, plain text untouched, empty → value."""
    if not value or not is_rich(value):
        return value
    parser = _Sanitizer()
    parser.feed(value)
    cleaned = parser.result()
    # Never let a cleaned brief drop out of "rich" and get shown as raw markup text.
    return cleaned if is_rich(cleaned) else f'<p>{cleaned}</p>' if cleaned.strip() else ''
