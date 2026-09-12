let book = null;
let rendition = null;
let currentSelection = '';
let currentContext = '';
let currentBookKey = '';
let lastAnswer = '';

const $ = (id) => document.getElementById(id);
const openBtn = $('openBtn');
const emptyOpenBtn = $('emptyOpenBtn');
const fileInput = $('fileInput');
const emptyState = $('emptyState');
const readerWrap = $('readerWrap');
const selectionBar = $('selectionBar');
const selectedPreview = $('selectedPreview');
const answerSheet = $('answerSheet');
const sheetSelection = $('sheetSelection');
const answer = $('answer');
const sheetTitle = $('sheetTitle');
const saveWordBtn = $('saveWordBtn');
const wordsSheet = $('wordsSheet');

const storage = {
  get(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
};

function bookKey(file) {
  return `book:${file.name}:${file.size}:${file.lastModified}`;
}

function openPicker(){ fileInput.click(); }
openBtn.addEventListener('click', openPicker);
emptyOpenBtn.addEventListener('click', openPicker);

function applyReaderTheme() {
  const dark = document.body.classList.contains('dark');
  if (!rendition) return;
  rendition.themes.default({
    body: {
      'background': dark ? '#222220' : '#fffdfa',
      'color': dark ? '#f2eee7' : '#262421',
      'font-family':'Georgia, serif',
      'line-height':'1.75',
      'padding':'0 4vw !important'
    },
    p: { 'font-size':'1.08em' },
    '::selection': { 'background': dark ? '#34564e' : '#cfe2db' }
  });
}

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  currentBookKey = bookKey(file);
  const buffer = await file.arrayBuffer();
  if (rendition) rendition.destroy();
  if (book) book.destroy();
  book = ePub(buffer);
  rendition = book.renderTo('viewer', { width:'100%', height:'100%', spread:'none', flow:'paginated' });
  applyReaderTheme();

  rendition.on('selected', (cfiRange, contents) => {
    const range = contents.range(cfiRange);
    const text = range?.toString()?.trim();
    if (!text) return;
    currentSelection = text;
    currentContext = extractContext(range, contents.document.body.innerText || '', text);
    selectedPreview.textContent = text;
    selectionBar.classList.remove('hidden');
  });

  rendition.on('relocated', (location) => {
    const p = location?.start?.percentage;
    $('locationText').textContent = Number.isFinite(p) ? `${Math.max(1, Math.round(p * 100))}٪` : '—';
    selectionBar.classList.add('hidden');
    const cfi = location?.start?.cfi;
    if (cfi && currentBookKey) storage.set(`${currentBookKey}:position`, cfi);
  });

  await book.ready;
  const savedPosition = storage.get(`${currentBookKey}:position`);
  try { await rendition.display(savedPosition || undefined); }
  catch { await rendition.display(); }
  emptyState.classList.add('hidden');
  readerWrap.classList.remove('hidden');
  fileInput.value = '';
});

function extractContext(range, fullText, selected) {
  const clean = String(fullText).replace(/\s+/g, ' ').trim();
  const target = String(selected).replace(/\s+/g, ' ').trim();
  const idx = clean.indexOf(target);
  if (idx < 0) return clean.slice(0, 1200);
  return clean.slice(Math.max(0, idx - 450), Math.min(clean.length, idx + target.length + 450));
}

$('prevBtn').addEventListener('click', () => rendition?.prev());
$('nextBtn').addEventListener('click', () => rendition?.next());
$('closeSheet').addEventListener('click', () => answerSheet.classList.add('hidden'));
$('closeWords').addEventListener('click', () => wordsSheet.classList.add('hidden'));

const savedTheme = storage.get('theme', 'light');
if (savedTheme === 'dark') document.body.classList.add('dark');
$('themeBtn').textContent = savedTheme === 'dark' ? '☀︎' : '☾';

$('themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const dark = document.body.classList.contains('dark');
  storage.set('theme', dark ? 'dark' : 'light');
  $('themeBtn').textContent = dark ? '☀︎' : '☾';
  applyReaderTheme();
});

selectionBar.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn || !currentSelection) return;
  const mode = btn.dataset.mode;
  const titleMap = {word:'معنی در متن',translate:'ترجمه',explain:'توضیح',grammar:'گرامر'};
  sheetTitle.textContent = titleMap[mode] || 'توضیح';
  sheetSelection.textContent = currentSelection;
  answer.textContent = 'در حال دریافت پاسخ…';
  answer.classList.add('loading');
  answerSheet.classList.remove('hidden');
  selectionBar.classList.add('hidden');
  saveWordBtn.classList.add('hidden');
  lastAnswer = '';

  try {
    const resp = await fetch('/api/explain', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ selection: currentSelection, context: currentContext, mode, targetLanguage:'fa' })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'خطا در دریافت پاسخ');
    lastAnswer = data.answer;
    answer.textContent = lastAnswer;
    saveWordBtn.classList.remove('hidden');
  } catch (err) {
    answer.textContent = `خطا: ${err.message}`;
  } finally {
    answer.classList.remove('loading');
  }
});

function getWords() { return storage.get('savedWords', []); }
function setWords(words) { storage.set('savedWords', words); }

saveWordBtn.addEventListener('click', () => {
  if (!currentSelection || !lastAnswer) return;
  const words = getWords();
  const entry = { text: currentSelection, answer: lastAnswer, savedAt: new Date().toISOString() };
  const deduped = [entry, ...words.filter(w => w.text !== currentSelection)].slice(0, 500);
  setWords(deduped);
  saveWordBtn.textContent = '★ ذخیره شد';
  setTimeout(() => { saveWordBtn.textContent = '☆ ذخیره در واژه‌ها'; }, 1200);
});

function renderWords() {
  const words = getWords();
  const list = $('wordsList');
  if (!words.length) {
    list.innerHTML = '<div class="empty-words">هنوز واژه‌ای ذخیره نکرده‌ای.</div>';
    return;
  }
  list.innerHTML = '';
  for (const item of words) {
    const card = document.createElement('article');
    card.className = 'word-card';
    const term = document.createElement('strong');
    term.textContent = item.text;
    const meaning = document.createElement('div');
    meaning.className = 'word-answer';
    meaning.textContent = item.answer;
    const remove = document.createElement('button');
    remove.className = 'remove-word';
    remove.textContent = 'حذف';
    remove.addEventListener('click', () => {
      setWords(getWords().filter(w => !(w.text === item.text && w.savedAt === item.savedAt)));
      renderWords();
    });
    card.append(term, meaning, remove);
    list.appendChild(card);
  }
}

$('wordsBtn').addEventListener('click', () => {
  renderWords();
  wordsSheet.classList.remove('hidden');
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
