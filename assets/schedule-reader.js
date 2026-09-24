// Files are processed on this device; only OCR/PDF libraries and language data are downloaded.
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs';
let ocrLibrary;
function loadOCR() {
  if (!ocrLibrary) ocrLibrary = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TESSERACT;
    script.onload = () => resolve(globalThis.Tesseract);
    script.onerror = () => { ocrLibrary = null; script.remove(); reject(new Error('Could not load the schedule reader. Check your connection and try again.')); };
    document.head.append(script);
  });
  return ocrLibrary;
}

export async function readSchedule(file, onProgress = () => {}) {
  if (!file || file.size > 10 * 1024 * 1024) throw new Error('Choose a PDF or image smaller than 10 MB.');
  let worker, loadingTask;
  async function recognize(input) {
    if (!worker) {
      const lib = await loadOCR();
      worker = await lib.createWorker('eng', 1, {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
        logger: message => onProgress(message.status === 'recognizing text' ? `Reading Text ${Math.round(message.progress * 100)}%` : 'Preparing Schedule Reader…')
      });
    }
    return (await worker.recognize(input)).data.text;
  }
  try {
    onProgress('Opening Schedule…');
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const pdfjs = await import(PDFJS);
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
      loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
      const pdf = await loadingTask.promise;
      if (pdf.numPages > 10) throw new Error('This schedule has more than 10 pages. Upload a shorter PDF.');
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        onProgress(`Reading Page ${n} of ${pdf.numPages}…`);
        const page = await pdf.getPage(n);
        try {
          const content = await page.getTextContent();
          let text = content.items.map(item => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
          if (text.trim().length < 20) {
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(base.width, base.height)) });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            try {
              await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
              text = await recognize(canvas);
            } finally { canvas.width = canvas.height = 0; }
          }
          pages.push(text);
        } finally { page.cleanup(); }
      }
      return pages.join('\n\n');
    }
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) throw new Error('Choose a PDF, PNG, or JPEG schedule.');
    return await recognize(file);
  } finally {
    if (worker) await worker.terminate();
    if (loadingTask) await loadingTask.destroy();
  }
}

const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const datePattern = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?)\b/gi;
function dateValue(raw, fallback) {
  let year, month, day;
  if (/^\d{4}-/.test(raw)) [year,month,day] = raw.split('-').map(Number);
  else if (/^\d/.test(raw)) {
    [month,day,year] = raw.split('/').map(Number);
    if (!year) year = fallback;
    else if (year < 100) year += 2000;
  } else {
    month = months.indexOf(raw.slice(0,3).toLowerCase()) + 1;
    day = Number(raw.match(/\d{1,2}/)[0]);
    year = Number(raw.match(/20\d{2}/)?.[0] || fallback);
  }
  const check = new Date(Date.UTC(year,month-1,day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month-1 || check.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

// Conservative candidate extraction. Caller must show editable candidates before saving.
// Bare 6:30 is kept in the title, since AM/PM cannot be safely inferred.
export function parseSchedule(text, year = new Date().getFullYear()) {
  const candidates = [];
  for (const line of String(text).split(/\r?\n/)) {
    const matches = [...line.matchAll(datePattern)];
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const date = dateValue(match[0], Number(year));
      if (!date) continue;
      let title = line.slice(match.index + match[0].length, matches[i+1]?.index ?? line.length).trim();
      const timeMatch = title.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i);
      let time = '';
      if (timeMatch) {
        time = `${String(Number(timeMatch[1]) % 12 + (timeMatch[3].toLowerCase() === 'p' ? 12 : 0)).padStart(2,'0')}:${timeMatch[2] || '00'}`;
        title = title.replace(timeMatch[0], '');
      }
      let place = '';
      const location = title.match(/\b(?:Location|Venue)\s*:\s*([^|;]+)/i);
      if (location) { place = location[1].trim(); title = title.replace(location[0],''); }
      title = title.replace(/^(?:\s|[|,:;—–-]|Monday\b|Tuesday\b|Wednesday\b|Thursday\b|Friday\b|Saturday\b|Sunday\b)+/gi,'').replace(/[\s|,:;—–-]+$/g,'').replace(/\s{2,}/g,' ').trim();
      candidates.push({ title, date, time, place });
    }
  }
  return candidates;
}
