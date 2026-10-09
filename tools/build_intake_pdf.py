"""Build the fillable EHS-IQ homeowner form (forms/EHS-IQ_Homeowner_Form.pdf).

The PDF is a standalone file: no links, no code, nothing that calls the app.
The one connection is that each fillable box is named after the matching
field on intake.html, which is what lets the app's "Import from PDF" button
read a completed copy back in.

This script checks that connection every time it runs: every box name and
every choice value must exist on intake.html (or in REPAIR_CATEGORIES in
js/engineCore.js), and every question on intake.html must appear here. If
the intake page changes and this file doesn't, the build stops and says what
is out of step.

Run from the repo root:  python3 -I tools/build_intake_pdf.py
Needs: reportlab and pypdf  (pip install reportlab pypdf)
"""

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

from reportlab.lib.colors import HexColor, transparent, white
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'forms' / 'EHS-IQ_Homeowner_Form.pdf'
LOGO = ROOT / 'assets' / 'smartiq-mark.png'

FORM_ID = 'ehsiq-intake-v1'          # bump when field names change
FORM_VERSION_LABEL = 'Version 1.1 · October 2026'
AGENT = 'Kelvin Hart'

# SmartIQ brand
RED = HexColor('#c40000')
RED_SOFT = HexColor('#fff2f2')
INK = HexColor('#10151f')
MUTED = HexColor('#666d78')
LINE = HexColor('#e6e6eb')
FIELD_LINE = HexColor('#9a9ca6')
CHARCOAL = HexColor('#161d27')
FIELD_FILL = HexColor('#fbfbfd')

PAGE_W, PAGE_H = letter
MARGIN = 44
CONTENT_W = PAGE_W - 2 * MARGIN
BOTTOM = 58

TRI = [('Yes', 'Yes'), ('No', 'No'), ('Unknown', 'Not sure')]

# ---------------------------------------------------------------------------
# The form, in homeowner wording. Field names must match intake.html.
# ---------------------------------------------------------------------------

SECTIONS = [
    ('1. About you', [
        ('row', [('Homeowner name', 'client_name', 0.6), ('Phone number, e.g. 317-555-0123', 'client_phone', 0.4)]),
        ('row', [('If someone is filling this in for the homeowner, their name and relationship', 'completed_for_client_by', 1.0)]),
        ('consent',),
    ]),
    ('2. The home', [
        ('row', [('Street address (house number and street)', 'property_address', 1.0)]),
        ('row', [('City', 'property_city', 0.4), ('ZIP code', 'property_zip', 0.25), ('County', 'county_name', 0.35)]),
        ('row', [('Township (if you know it)', 'township', 0.5)]),
        ('tri', 'in_city_indianapolis', 'Is the home inside the City of Indianapolis?',
         'Speedway, Beech Grove, Lawrence and Southport are separate cities.'),
        ('tri', 'inside_i465', 'Is the home inside I-465?', None),
        ('tri', 'usda_rural_eligible', 'Is the home in an area USDA counts as rural?',
         'Choose "Not sure" if you don\'t know. Your agent can check.'),
        ('tri', 'owner_on_deed', 'Is the homeowner\'s name on the deed?', None),
        ('tri', 'primary_residence', 'Does the homeowner live in the home most of the year?', None),
        ('row', [('Years in the home', 'years_in_home', 0.3)]),
        ('choice', 'title_issue', 'How is the home owned?', [
            ('none', 'In the homeowner\'s name (a mortgage is fine)'),
            ('inherited_not_retitled', 'Inherited, still in a relative\'s name'),
            ('land_contract', 'Bought on a land contract'),
            ('other', 'Other'),
        ]),
        ('choice', 'home_type', 'What kind of home is it?', [
            ('site_built', 'House'),
            ('manufactured_owned_land', 'Manufactured home on land the homeowner owns'),
            ('manufactured_rented_lot', 'Manufactured home on a rented lot'),
            ('duplex', 'Duplex'),
            ('condo_multiunit', 'Condo in a larger building'),
        ]),
    ]),
    ('3. Household and income', [
        ('row', [('Age of the oldest owner', 'age_oldest_owner', 0.3), ('People living in the home', 'household_size', 0.3),
                 ('Yearly income, all sources ($)', 'household_income', 0.4)]),
        ('note', 'Count Social Security, pensions, wages and any other income for everyone living in the home.'),
        ('subhead', 'Does anyone in the home get these benefits?'),
        ('tri', 'receives_ssi', 'SSI (Supplemental Security Income)',
         'A monthly payment for people with low income who are 65+, blind or disabled. Not regular Social Security.'),
        ('tri', 'receives_medicaid', 'Medicaid', 'Health coverage for people with low income.'),
        ('tri', 'receives_snap', 'SNAP (food stamps)', 'Food help paid on an EBT card.'),
        ('tri', 'receives_energy_assistance', 'Energy Assistance (LIHEAP)', 'Help paying heating or electric bills.'),
        ('tri', 'receives_tanf', 'TANF', 'Cash assistance, mostly for families with children.'),
    ]),
    ('4. Military service and health', [
        ('tri', 'is_veteran', 'Is the homeowner a veteran, or the surviving spouse of one?', None),
        ('tri', 'va_service_connected', 'Does the VA rate a disability as service-connected?', None),
        ('row', [('VA disability rating (%)', 'va_disability_rating', 0.3)]),
        ('tri', 'has_disability', 'Does the homeowner have a disability?', None),
        ('tri', 'uses_mobility_device', 'Does the homeowner use a wheelchair or walker?', None),
        ('tri', 'recent_falls', 'Has the homeowner fallen at home in the last year?', None),
        ('tri', 'needs_daily_help', 'Does the homeowner need help with bathing, dressing, meals or medicines?', None),
    ]),
    ('5. The repair', [
        ('subhead', 'What needs fixing? Tick all that apply.'),
        ('repairs',),
        ('choice', 'urgency', 'How urgent is it?', [
            ('emergency', 'Emergency: no heat, no water, sewage backup or unsafe'),
            ('soon', 'Needed soon'),
            ('can_wait', 'Can wait'),
        ]),
        ('row', [('Repair estimate, low ($)', 'cost_estimate_low', 0.5), ('Repair estimate, high ($)', 'cost_estimate_high', 0.5)]),
    ]),
    ('6. Money matters', [
        ('choice', 'savings_band', 'Savings', [
            ('under_2000', 'Under $2,000'),
            ('2000_10000', '$2,000 to $10,000'),
            ('over_10000', 'Over $10,000'),
        ]),
        ('tri', 'taxes_current', 'Are property taxes paid up?', None),
        ('tri', 'mortgage_current', 'Are mortgage payments up to date?', 'Choose "Yes" if there is no mortgage.'),
        ('tri', 'insurance_current', 'Is there homeowners insurance on the home?', None),
        ('tri', 'can_afford_small_payment', 'Could the homeowner manage a small monthly payment?', None),
        ('row', [('Any earlier repair grants or liens on this home?', 'prior_assistance', 1.0)]),
        ('notes', 'notes', 'Anything else we should know? Describe the problem in your own words.'),
    ]),
]

# Fields on intake.html the homeowner doesn't fill in: the address lookup sets
# the first three, and the agent records how consent was given.
APP_ONLY = {'state_code', 'county_fips', 'census_tract', 'consent_method'}

# ---------------------------------------------------------------------------
# Check against intake.html and engineCore.js
# ---------------------------------------------------------------------------


class IntakeScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields, self.tri, self.options = set(), set(), {}
        self._select = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('input', 'select', 'textarea') and a.get('name'):
            self.fields.add(a['name'])
        if tag == 'select':
            self._select = a.get('name')
            self.options[self._select] = set()
        if tag == 'option' and self._select and a.get('value'):
            self.options[self._select].add(a['value'])
        if a.get('data-tri'):
            for pair in a['data-tri'].split(';'):
                self.tri.add(pair.split('|')[0])

    def handle_endtag(self, tag):
        if tag == 'select':
            self._select = None


def repair_categories():
    src = (ROOT / 'js' / 'engineCore.js').read_text()
    block = re.search(r'REPAIR_CATEGORIES\s*=\s*\{(.*?)\};', src, re.S).group(1)
    return re.findall(r"(\w+):\s*'([^']*)'", block)


def check_against_intake():
    scan = IntakeScan()
    scan.feed((ROOT / 'intake.html').read_text())
    html_fields = (scan.fields | scan.tri) - {'repair_categories'}
    problems, used = [], set()
    for _, items in SECTIONS:
        for item in items:
            kind = item[0]
            names = []
            if kind == 'row':
                names = [f[1] for f in item[1]]
            elif kind in ('tri', 'choice', 'notes'):
                names = [item[1]]
            elif kind == 'consent':
                names = ['consent_given', 'consent_date']
            for n in names:
                used.add(n)
                if n not in html_fields:
                    problems.append(f'PDF field "{n}" is not on intake.html')
            if kind == 'tri' and item[1] not in scan.tri:
                problems.append(f'"{item[1]}" is a Yes/No/Not sure question in the PDF but not on intake.html')
            if kind == 'choice':
                html_opts = scan.options.get(item[1], set())
                pdf_opts = {v for v, _ in item[3]}
                if pdf_opts != html_opts:
                    problems.append(f'choices for "{item[1]}" differ: PDF {sorted(pdf_opts)} vs intake.html {sorted(html_opts)}')
    for n in sorted(html_fields - used - APP_ONLY):
        problems.append(f'intake.html field "{n}" is missing from the PDF')
    if problems:
        sys.exit('PDF form is out of step with intake.html:\n  ' + '\n  '.join(problems))


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------


class FormWriter:
    def __init__(self, path):
        self.c = canvas.Canvas(str(path), pagesize=letter)
        self.c.setTitle('Home Repair Help: Homeowner Information Form')
        self.c.setAuthor('SmartIQ Realty')
        self.c.setSubject('EHS-IQ homeowner intake form')
        self.c.setKeywords(FORM_ID)
        self.form = self.c.acroForm
        self.page = 1
        self.first_page_header()

    # ----- page furniture -----

    def brand(self, y, size=34):
        c = self.c
        c.drawImage(str(LOGO), MARGIN, y - size, size, size, mask='auto')
        tx = MARGIN + size + 9
        c.setFillColor(CHARCOAL)
        c.setFont('Helvetica-Bold', 17 if size > 30 else 12)
        c.drawString(tx, y - (15 if size > 30 else 11), 'EHS-')
        w = c.stringWidth('EHS-', 'Helvetica-Bold', 17 if size > 30 else 12)
        c.setFillColor(RED)
        c.drawString(tx + w, y - (15 if size > 30 else 11), 'IQ')
        c.setFillColor(MUTED)
        c.setFont('Helvetica-Bold', 7.5 if size > 30 else 6.5)
        c.drawString(tx, y - (27 if size > 30 else 20), 'SMARTIQ REALTY  ·  FATHOM REALTY')

    def first_page_header(self):
        c = self.c
        top = PAGE_H - MARGIN
        self.brand(top)
        c.setFillColor(RED)
        c.setFont('Helvetica-Bold', 8)
        c.drawRightString(PAGE_W - MARGIN, top - 10, 'HOME REPAIR HELP')
        c.setFillColor(CHARCOAL)
        c.setFont('Helvetica-Bold', 19)
        c.drawRightString(PAGE_W - MARGIN, top - 30, 'Homeowner Information Form')
        y = top - 46
        c.setStrokeColor(RED)
        c.setLineWidth(2.2)
        c.line(MARGIN, y, PAGE_W - MARGIN, y)

        # How-to box
        lines = [
            ('Helvetica-Bold', 'How to fill this in'),
            ('Helvetica', 'Type in the boxes and click the circles. If you are not sure of an answer, choose "Not sure" or leave it '
                          'blank. That is fine: nothing is ruled out because an answer is missing.'),
            ('Helvetica', 'When you are done, save the file (File, then Save). Please do not use "Print to PDF": it erases the answers.'),
            ('Helvetica', 'You can also print this form and fill it in by pen.'),
        ]
        wrapped = []
        for font, text in lines:
            for i, ln in enumerate(simpleSplit(text, font, 9.5, CONTENT_W - 28)):
                wrapped.append((font, ln))
        h = 14 + len(wrapped) * 12.5 + 6
        y -= 14
        c.setFillColor(RED_SOFT)
        c.setStrokeColor(HexColor('#f3c9c9'))
        c.setLineWidth(0.8)
        c.roundRect(MARGIN, y - h, CONTENT_W, h, 12, stroke=1, fill=1)
        ty = y - 18
        for font, ln in wrapped:
            c.setFillColor(INK)
            c.setFont(font, 9.5)
            c.drawString(MARGIN + 14, ty, ln)
            ty -= 12.5
        self.y = y - h - 18

        # Hidden marker so the app knows this is its form, and which version.
        self.form.textfield(name='form_id', value=FORM_ID, x=0, y=0, width=1, height=1,
                            annotationFlags='hidden', fieldFlags='readOnly', borderWidth=0)

    def footer(self):
        c = self.c
        c.setStrokeColor(LINE)
        c.setLineWidth(0.8)
        c.line(MARGIN, 40, PAGE_W - MARGIN, 40)
        c.setFillColor(MUTED)
        c.setFont('Helvetica', 7.5)
        c.drawString(MARGIN, 28, f'EHS-IQ Homeowner Information Form  ·  {FORM_VERSION_LABEL}  ·  Prepared for {AGENT}, SmartIQ Realty')
        c.drawRightString(PAGE_W - MARGIN, 28, f'Page {self.page}')

    def new_page(self):
        self.footer()
        self.c.showPage()
        self.page += 1
        self.brand(PAGE_H - MARGIN + 4, size=24)
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(0.8)
        self.c.line(MARGIN, PAGE_H - MARGIN - 28, PAGE_W - MARGIN, PAGE_H - MARGIN - 28)
        self.y = PAGE_H - MARGIN - 48

    def need(self, h):
        if self.y - h < BOTTOM:
            self.new_page()

    # ----- building blocks -----

    def section(self, title):
        self.need(90)
        c = self.c
        c.setFont('Helvetica-Bold', 10.5)
        w = c.stringWidth(title, 'Helvetica-Bold', 10.5) + 24
        c.setFillColor(CHARCOAL)
        c.roundRect(MARGIN, self.y - 20, w, 20, 10, stroke=0, fill=1)
        c.setFillColor(white)
        c.drawString(MARGIN + 12, self.y - 14, title)
        self.y -= 32

    def label(self, x, y, text, width, size=9, font='Helvetica-Bold', color=CHARCOAL):
        c = self.c
        c.setFillColor(color)
        c.setFont(font, size)
        lines = simpleSplit(text, font, size, width)
        for i, ln in enumerate(lines):
            c.drawString(x, y - i * (size + 2.5), ln)
        return len(lines) * (size + 2.5)

    def text_box(self, name, x, y, w, h, tooltip, multiline=False, maxlen=200):
        self.form.textfield(
            name=name, tooltip=tooltip, x=x, y=y, width=w, height=h,
            borderStyle='solid', borderWidth=0.8, borderColor=FIELD_LINE, fillColor=FIELD_FILL,
            textColor=INK, forceBorder=True, fontName='Helvetica', fontSize=10 if not multiline else 9.5,
            maxlen=maxlen, fieldFlags='multiline' if multiline else '')

    def row(self, fields):
        gap = 12
        total_gap = gap * (len(fields) - 1)
        widths = [f[2] * (CONTENT_W - total_gap) if f[2] < 1 else CONTENT_W for f in fields]
        label_h = max(len(simpleSplit(f[0], 'Helvetica-Bold', 9, w)) for f, w in zip(fields, widths)) * 11.5
        h = label_h + 4 + 22 + 12
        self.need(h)
        x = MARGIN
        for (label, name, _), w in zip(fields, widths):
            self.label(x, self.y - 9, label, w)
            maxlen = 300 if name in ('property_address', 'completed_for_client_by', 'prior_assistance') else 120
            self.text_box(name, x, self.y - label_h - 4 - 22, w, 22, label, maxlen=maxlen)
            x += w + gap
        self.y -= h

    def note(self, text):
        lines = simpleSplit(text, 'Helvetica', 8.5, CONTENT_W)
        self.need(len(lines) * 11 + 6)
        self.label(MARGIN, self.y - 4, text, CONTENT_W, size=8.5, font='Helvetica', color=MUTED)
        self.y -= len(lines) * 11 + 8

    def subhead(self, text):
        self.need(40)
        self.label(MARGIN, self.y - 10, text, CONTENT_W, size=10, font='Helvetica-Bold')
        self.y -= 20

    def radio(self, name, value, x, y, label, tooltip):
        # The circle is printed on the page so it looks the same in every
        # viewer and on paper; the form widget on top only draws the dot.
        self.c.setStrokeColor(FIELD_LINE)
        self.c.setFillColor(white)
        self.c.setLineWidth(0.9)
        self.c.circle(x + 5.5, y + 5.5, 5.5, stroke=1, fill=1)
        self.form.radio(name=name, value=value, selected=False, x=x, y=y, size=11,
                        buttonStyle='circle', shape='circle', borderColor=transparent, fillColor=transparent,
                        textColor=RED, borderWidth=0, forceBorder=False, tooltip=tooltip,
                        fieldFlags='radio')
        self.c.setFillColor(INK)
        self.c.setFont('Helvetica', 9)
        self.c.drawString(x + 15, y + 2, label)

    def tri(self, name, question, help_text):
        opts_w = 186
        q_w = CONTENT_W - opts_w - 10
        q_lines = simpleSplit(question, 'Helvetica-Bold', 9.5, q_w)
        h_lines = simpleSplit(help_text, 'Helvetica', 8, q_w) if help_text else []
        h = max(len(q_lines) * 12 + len(h_lines) * 10 + 10, 26)
        self.need(h)
        top = self.y
        self.label(MARGIN, top - 11, question, q_w, size=9.5)
        if h_lines:
            self.label(MARGIN, top - 11 - len(q_lines) * 12, help_text, q_w, size=8, font='Helvetica', color=MUTED)
        ox = PAGE_W - MARGIN - opts_w
        for i, (value, text) in enumerate(TRI):
            self.radio(name, value, ox + i * 62, top - 15, text, question)
        self.y -= h
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(0.7)
        self.c.line(MARGIN, self.y + 3, PAGE_W - MARGIN, self.y + 3)
        self.y -= 3

    def choice(self, name, question, options):
        # Lay the options out in rows, wrapping when the line is full.
        self.c.setFont('Helvetica', 9)
        rows, row, used = [], [], 0
        for value, text in options:
            w = 15 + self.c.stringWidth(text, 'Helvetica', 9) + 18
            if row and used + w > CONTENT_W:
                rows.append(row)
                row, used = [], 0
            row.append((value, text, w))
            used += w
        rows.append(row)
        h = 14 + len(rows) * 17 + 10
        self.need(h)
        self.y -= 4
        self.label(MARGIN, self.y - 9, question, CONTENT_W, size=9.5)
        y = self.y - 28
        for r in rows:
            x = MARGIN
            for value, text, w in r:
                self.radio(name, value, x, y, text, question)
                x += w
            y -= 17
        self.y -= h - 4

    def consent(self):
        text = (f'I agree that {AGENT} of SmartIQ Realty may use the information on this form to look for home repair '
                'help for me, and may contact repair programs on my behalf.')
        lines = simpleSplit(text, 'Helvetica', 9.5, CONTENT_W - 24)
        h = len(lines) * 12.5 + 12 + 40
        self.need(h)
        self.form.checkbox(name='consent_given', tooltip='Consent', x=MARGIN, y=self.y - 14, size=13,
                           buttonStyle='check', borderColor=FIELD_LINE, fillColor=white, textColor=RED,
                           borderWidth=0.9, forceBorder=True, fieldFlags='')
        self.label(MARGIN + 22, self.y - 10, text, CONTENT_W - 24, size=9.5, font='Helvetica', color=INK)
        y = self.y - len(lines) * 12.5 - 14
        self.label(MARGIN, y - 9, 'Date', 120)
        self.text_box('consent_date', MARGIN, y - 33, 140, 22, 'Date (month/day/year)', maxlen=20)
        self.label(MARGIN + 150, y - 27, 'month / day / year, e.g. 10/09/2026', 220, size=8, font='Helvetica', color=MUTED)
        self.y = y - 46

    def repairs(self):
        cats = repair_categories()
        cols = 2
        per_col = (len(cats) + 1) // 2
        h = per_col * 17 + 6
        self.need(h)
        col_w = CONTENT_W / cols
        for i, (key, text) in enumerate(cats):
            col, r = divmod(i, per_col)
            x = MARGIN + col * col_w
            y = self.y - 12 - r * 17
            self.form.checkbox(name=f'repair_{key}', tooltip=text, x=x, y=y, size=11, buttonStyle='check',
                               borderColor=FIELD_LINE, fillColor=white, textColor=RED, borderWidth=0.9,
                               forceBorder=True, fieldFlags='')
            self.c.setFillColor(INK)
            self.c.setFont('Helvetica', 9)
            self.c.drawString(x + 16, y + 2, text)
        self.y -= h + 4

    def notes(self, name, label):
        h = 14 + 92 + 10
        self.need(h)
        self.label(MARGIN, self.y - 9, label, CONTENT_W)
        self.text_box(name, MARGIN, self.y - 14 - 92, CONTENT_W, 88, label, multiline=True, maxlen=3000)
        self.y -= h

    def build(self):
        for title, items in SECTIONS:
            self.section(title)
            for item in items:
                kind = item[0]
                if kind == 'row':
                    self.row(item[1])
                elif kind == 'tri':
                    self.tri(item[1], item[2], item[3])
                elif kind == 'choice':
                    self.choice(item[1], item[2], item[3])
                elif kind == 'note':
                    self.note(item[1])
                elif kind == 'subhead':
                    self.subhead(item[1])
                elif kind == 'consent':
                    self.consent()
                elif kind == 'repairs':
                    self.repairs()
                elif kind == 'notes':
                    self.notes(item[1], item[2])
            self.y -= 10
        self.need(40)
        self.label(MARGIN, self.y - 6, 'Thank you. Save this file and send it back, or hand the printed copy to your agent.',
                   CONTENT_W, size=9.5, font='Helvetica-Bold', color=CHARCOAL)
        self.footer()
        self.c.save()


def fix_radio_dots(path):
    """reportlab draws the 'selected' dot small and off-centre when the widget
    has no border (the circle is printed on the page instead). Redraw it as a
    centred red dot in every radio button's appearance."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject, StreamObject

    r, g, b = RED.red, RED.green, RED.blue
    writer = PdfWriter(clone_from=PdfReader(str(path)))
    for page in writer.pages:
        for ref in page.get('/Annots', []):
            annot = ref.get_object()
            parent = annot.get('/Parent')
            if not parent or parent.get_object().get('/FT') != '/Btn':
                continue
            if not int(parent.get_object().get('/Ff', 0)) & (1 << 15):   # radio flag
                continue
            x0, y0, x1, y1 = [float(v) for v in annot['/Rect']]
            cx, cy, rad = (x1 - x0) / 2, (y1 - y0) / 2, (x1 - x0) * 0.27
            k = rad * 0.5523
            dot = (f'q {r:.4f} {g:.4f} {b:.4f} rg 1 0 0 1 {cx:.3f} {cy:.3f} cm '
                   f'{rad:.3f} 0 m {rad:.3f} {k:.3f} {k:.3f} {rad:.3f} 0 {rad:.3f} c '
                   f'{-k:.3f} {rad:.3f} {-rad:.3f} {k:.3f} {-rad:.3f} 0 c '
                   f'{-rad:.3f} {-k:.3f} {-k:.3f} {-rad:.3f} 0 {-rad:.3f} c '
                   f'{k:.3f} {-rad:.3f} {rad:.3f} {-k:.3f} {rad:.3f} 0 c f Q').encode()
            for kind in ('/N', '/D'):
                states = annot['/AP'].get(kind)
                if not states:
                    continue
                for state in list(states.keys()):
                    if state == '/Off':
                        continue
                    stream = states[state].get_object()
                    stream.set_data(dot)
    writer.write(str(path))


# Typing help for Adobe Reader and Chrome, using the standard Acrobat format
# functions. Mac Preview ignores these, which is why the app's import also
# tidies phone numbers, dates and dollar amounts.
FORMATS = {
    'client_phone': ('AFSpecial_Keystroke(2);', 'AFSpecial_Format(2);'),
    'property_zip': ('AFSpecial_Keystroke(0);', 'AFSpecial_Format(0);'),
    'consent_date': ('AFDate_KeystrokeEx("mm/dd/yyyy");', 'AFDate_FormatEx("mm/dd/yyyy");'),
    'household_income': ('AFNumber_Keystroke(0, 0, 0, 0, "$", true);', 'AFNumber_Format(0, 0, 0, 0, "$", true);'),
    'cost_estimate_low': ('AFNumber_Keystroke(0, 0, 0, 0, "$", true);', 'AFNumber_Format(0, 0, 0, 0, "$", true);'),
    'cost_estimate_high': ('AFNumber_Keystroke(0, 0, 0, 0, "$", true);', 'AFNumber_Format(0, 0, 0, 0, "$", true);'),
    'years_in_home': ('AFNumber_Keystroke(0, 0, 0, 0, "", true);', 'AFNumber_Format(0, 0, 0, 0, "", true);'),
    'age_oldest_owner': ('AFNumber_Keystroke(0, 0, 0, 0, "", true);', 'AFNumber_Format(0, 0, 0, 0, "", true);'),
    'household_size': ('AFNumber_Keystroke(0, 0, 0, 0, "", true);', 'AFNumber_Format(0, 0, 0, 0, "", true);'),
    'va_disability_rating': ('AFNumber_Keystroke(0, 0, 0, 0, "", true);', 'AFNumber_Format(0, 0, 0, 0, "", true);'),
}


def add_format_actions(path):
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, TextStringObject

    def js(code):
        return DictionaryObject({NameObject('/S'): NameObject('/JavaScript'), NameObject('/JS'): TextStringObject(code)})

    writer = PdfWriter(clone_from=PdfReader(str(path)))
    done = set()
    for page in writer.pages:
        for ref in page.get('/Annots', []):
            annot = ref.get_object()
            field = annot if '/T' in annot else annot.get('/Parent', {}).get_object() if annot.get('/Parent') else None
            name = field.get('/T') if field else None
            if name in FORMATS:
                keystroke, fmt = FORMATS[name]
                field[NameObject('/AA')] = DictionaryObject({NameObject('/K'): js(keystroke), NameObject('/F'): js(fmt)})
                done.add(name)
    missing = set(FORMATS) - done
    if missing:
        sys.exit(f'Format actions not attached to: {sorted(missing)}')
    writer.write(str(path))


if __name__ == '__main__':
    check_against_intake()
    OUT.parent.mkdir(exist_ok=True)
    FormWriter(OUT).build()
    fix_radio_dots(OUT)
    add_format_actions(OUT)
    print(f'Wrote {OUT.relative_to(ROOT)}')
