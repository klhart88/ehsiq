// ============================================
// EHS-IQ — Read a completed homeowner form (PDF)
//
// The PDF is read entirely in the browser with pdf-lib. Nothing is uploaded
// or stored: the answers go into the intake form on screen, and the agent
// reviews them and saves as usual.
//
// Matching works by name: each fillable box in the PDF is named after the
// intake form field it belongs to (tools/build_intake_pdf.py checks this).
// ============================================

const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
export const FORM_ID = 'ehsiq-intake-v1';

let pdfLibPromise = null;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDF_LIB_URL;
      script.onload = () => resolve(window.PDFLib);
      script.onerror = () => {
        pdfLibPromise = null;
        reject(new Error('Could not load the PDF reader. Check the internet connection and try again.'));
      };
      document.head.append(script);
    });
  }
  return pdfLibPromise;
}

/**
 * Read the answers out of a completed form.
 * @param {File} file
 * @param {{ triFields: string[], repairKeys: string[] }} spec
 * @returns {Promise<{ answers: object, answered: number, warnings: string[] }>}
 *   answers holds raw values: strings for text boxes, true/false/null for
 *   Yes/No/Not sure questions, the chosen value for other choices, and
 *   repair_categories as an array.
 */
export async function readIntakePdf(file, { triFields, repairKeys }) {
  const PDFLib = await loadPdfLib();
  let doc;
  try {
    doc = await PDFLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new Error('This file could not be opened as a PDF.');
  }

  const fields = doc.getForm().getFields();
  if (fields.length === 0) {
    throw new Error('This PDF has no fillable boxes left. It was probably printed to PDF or scanned, which turns the answers into a picture. Enter the answers by hand.');
  }
  const byName = new Map(fields.map(f => [f.getName(), f]));

  let formId = null;
  const marker = byName.get('form_id');
  if (marker instanceof PDFLib.PDFTextField) formId = marker.getText() || null;
  if (!formId && !byName.has('client_name')) {
    throw new Error('This doesn\'t look like the EHS-IQ homeowner form. Use the blank form from this page.');
  }

  const warnings = [];
  if (!formId) warnings.push('The form\'s version marker is missing, so this may be an altered copy. Check every answer.');
  else if (formId !== FORM_ID) warnings.push(`This is an older or newer copy of the form (${formId}). Check every answer, and send the homeowner the current blank form next time.`);

  const answers = { repair_categories: [] };
  let answered = 0;

  for (const [name, field] of byName) {
    if (name === 'form_id') continue;

    if (field instanceof PDFLib.PDFTextField) {
      const text = (field.getText() || '').trim();
      if (text) { answers[name] = text; answered++; }
      continue;
    }

    // Every other box is a button: a Yes/No/Not sure question, a multiple
    // choice, a repair tick box or the consent box. Read the saved answer
    // straight from the file rather than trusting the button type, because
    // some viewers (Mac Preview) change choice groups into plain checkboxes
    // when they save.
    const value = savedButtonValue(PDFLib, field);
    if (triFields.includes(name)) {
      answers[name] = value === 'Yes' ? true : value === 'No' ? false : null;
      if (value === 'Yes' || value === 'No') answered++;
    } else if (name === 'consent_given') {
      answers.consent_given = value !== null;
      if (value !== null) answered++;
    } else if (name.startsWith('repair_')) {
      const key = name.slice('repair_'.length);
      if (value !== null && repairKeys.includes(key)) { answers.repair_categories.push(key); answered++; }
    } else if (value !== null) {
      answers[name] = value;
      answered++;
    }
  }

  return { answers, answered, warnings };
}

/** The chosen value of a button field ('Yes', 'none', 'soon'...), or null if nothing is chosen. */
function savedButtonValue(PDFLib, field) {
  const read = (obj) => {
    if (obj instanceof PDFLib.PDFName) return obj.decodeText();
    if (obj instanceof PDFLib.PDFString || obj instanceof PDFLib.PDFHexString) return obj.decodeText();
    return null;
  };
  let value = read(field.acroField.dict.lookup(PDFLib.PDFName.of('V')));
  if (value === null) {
    // No saved value on the field: fall back to whichever button is drawn as on.
    for (const widget of field.acroField.getWidgets()) {
      const state = read(widget.getAppearanceState?.());
      if (state && state !== 'Off') { value = state; break; }
    }
  }
  return value && value !== 'Off' ? value : null;
}

/** Turn "10/9/2026", "10-09-26", "10092026" or "2026-10-09" into 2026-10-09; null if unreadable. */
export function toIsoDate(text) {
  if (!text) return null;
  const t = text.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y, mo, d;
  if (m) { [, y, mo, d] = m; }
  else if ((m = t.match(/^(\d{2})(\d{2})(\d{4}|\d{2})$/))) {   // 10092026 or 100926
    [, mo, d, y] = m;
    if (y.length === 2) y = `20${y}`;
  }
  else if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    [, mo, d, y] = m;
    if (y.length === 2) y = `20${y}`;
  } else return null;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 3172853225, (317) 285-3225 or +1 317.285.3225 become 317-285-3225; anything else is left as typed. */
export function formatPhone(text) {
  if (!text) return text;
  let digits = text.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : text.trim();
}
