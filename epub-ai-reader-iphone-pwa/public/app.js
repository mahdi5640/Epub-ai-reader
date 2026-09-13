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
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

function bookKey(file) {
  return `book:${file.name}:${file.size}:${file.lastModified}`;
}

function openPicker() {
  fileInput.click();
}

openBtn.addEventListener('click', openPicker);
emptyOpenBtn.addEventListener('click', openPicker);


/* --------------------------------------------------
   Reader theme
-------------------------------------------------- */

function applyReaderTheme() {
  if (!rendition) return;

  const dark = document.body.classList.contains('dark');

  rendition.themes.default({
    body: {
      background: dark ? '#222220' : '#fffdfa',
      color: dark ? '#f2eee7' : '#262421',
      'font-family': 'Georgia, serif',
      'line-height': '1.75',
      padding: '0 4vw !important'
    },

    p: {
      'font-size': '1.08em'
    },

    '::selection': {
      background: dark ? '#34564e' : '#cfe2db'
    }
  });
}


/* --------------------------------------------------
   Selection handling
-------------------------------------------------- */

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractContextFromText(fullText, selectedText) {
  const clean = normalizeText(fullText);
  const selected = normalizeText(selectedText);

  if (!clean) return '';
  if (!selected) return clean.slice(0, 1200);

  const index = clean.indexOf(selected);

  if (index < 0) {
    return clean.slice(0, 1200);
  }

  const before = 500;
  const after = 500;

  return clean.slice(
    Math.max(0, index - before),
    Math.min(clean.length, index + selected.length + after)
  );
}

function showSelection(text, context = '') {
  const cleanText = normalizeText(text);

  if (!cleanText) return;

  currentSelection = cleanText;
  currentContext = normalizeText(context);

  selectedPreview.textContent = cleanText;

  selectionBar.classList.remove('hidden');
}

function handleWindowSelection(contents) {
  try {
    const win = contents.window;
    const doc = contents.document;

    if (!win || !doc) return;

    const selection = win.getSelection();

    if (!selection || selection.rangeCount === 0) return;

    const text = normalizeText(selection.toString());

    if (!text) return;

    const bodyText = doc.body?.innerText || doc.body?.textContent || '';

    const context = extractContextFromText(bodyText, text);

    showSelection(text, context);

  } catch (error) {
    console.warn('Selection fallback error:', error);
  }
}

function attachSelectionListeners(contents) {
  try {
    const doc = contents.document;

    if (!doc) return;

    /*
      Desktop / Mac Safari
    */
    doc.addEventListener('mouseup', () => {
      setTimeout(() => {
        handleWindowSelection(contents);
      }, 50);
    });

    /*
      iPhone / iPad Safari
    */
    doc.addEventListener('touchend', () => {
      setTimeout(() => {
        handleWindowSelection(contents);
      }, 250);
    });

    /*
      Additional fallback
    */
    doc.addEventListener('selectionchange', () => {
      const selection = contents.window?.getSelection?.();

      if (!selection) return;

      const text = normalizeText(selection.toString());

      if (!text) return;

      setTimeout(() => {
        handleWindowSelection(contents);
      }, 80);
    });

  } catch (error) {
    console.warn('Could not attach selection listeners:', error);
  }
}


/* --------------------------------------------------
   Open EPUB
-------------------------------------------------- */

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];

  if (!file) return;

  currentBookKey = bookKey(file);

  currentSelection = '';
  currentContext = '';
  selectionBar.classList.add('hidden');

  try {
    const buffer = await file.arrayBuffer();

    if (rendition) {
      rendition.destroy();
      rendition = null;
    }

    if (book) {
      book.destroy();
      book = null;
    }

    book = ePub(buffer);

    rendition = book.renderTo('viewer', {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated'
    });

    applyReaderTheme();


    /*
      EPUB.js native selection event
    */
    rendition.on('selected', (cfiRange, contents) => {
      try {
        const range = contents.range(cfiRange);

        const text = normalizeText(range?.toString());

        if (!text) return;

        const bodyText =
          contents.document.body?.innerText ||
          contents.document.body?.textContent ||
          '';

        const context = extractContextFromText(bodyText, text);

        showSelection(text, context);

      } catch (error) {
        console.warn('EPUB selected event error:', error);
      }
    });


    /*
      Attach fallback listeners whenever a chapter/page
      is rendered into the EPUB iframe.
    */
    rendition.on('rendered', (_section, contents) => {
      attachSelectionListeners(contents);
    });


    rendition.on('relocated', (location) => {
      const percentage = location?.start?.percentage;

      $('locationText').textContent =
        Number.isFinite(percentage)
          ? `${Math.max(1, Math.round(percentage * 100))}٪`
          : '—';

      selectionBar.classList.add('hidden');

      const cfi = location?.start?.cfi;

      if (cfi && currentBookKey) {
        storage.set(`${currentBookKey}:position`, cfi);
      }
    });


    await book.ready;

    const savedPosition =
      storage.get(`${currentBookKey}:position`);

    try {
      await rendition.display(savedPosition || undefined);
    } catch {
      await rendition.display();
    }

    /*
      Attach fallback listeners to already-rendered
      contents too.
    */
    try {
      const contentsList = rendition.getContents();

      for (const contents of contentsList) {
        attachSelectionListeners(contents);
      }
    } catch (error) {
      console.warn('Initial selection setup error:', error);
    }

    emptyState.classList.add('hidden');
    readerWrap.classList.remove('hidden');

    fileInput.value = '';

  } catch (error) {
    console.error(error);

    alert(
      'باز کردن EPUB با خطا مواجه شد. لطفاً یک فایل EPUB دیگر امتحان کن.'
    );
  }
});


/* --------------------------------------------------
   Navigation
-------------------------------------------------- */

$('prevBtn').addEventListener('click', () => {
  rendition?.prev();
});

$('nextBtn').addEventListener('click', () => {
  rendition?.next();
});


/* --------------------------------------------------
   AI request
-------------------------------------------------- */

selectionBar.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-mode]');

  if (!button || !currentSelection) return;

  const mode = button.dataset.mode;

  const titleMap = {
    word: 'معنی در متن',
    translate: 'ترجمه',
    explain: 'توضیح',
    grammar: 'گرامر'
  };

  sheetTitle.textContent =
    titleMap[mode] || 'توضیح';

  sheetSelection.textContent =
    currentSelection;

  answer.textContent =
    'در حال دریافت پاسخ…';

  answer.classList.add('loading');

  answerSheet.classList.remove('hidden');
  selectionBar.classList.add('hidden');

  saveWordBtn.classList.add('hidden');

  lastAnswer = '';

  try {
    const response = await fetch('/api/explain', {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify({
        selection: currentSelection,
        context: currentContext,
        mode,
        targetLanguage: 'fa'
      })
    });

    let data = {};

    try {
      data = await response.json();
    } catch {
      throw new Error(
        `پاسخ نامعتبر از سرور دریافت شد (${response.status})`
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
        `خطای سرور (${response.status})`
      );
    }

    lastAnswer =
      data.answer ||
      'پاسخی دریافت نشد.';

    answer.textContent = lastAnswer;

    saveWordBtn.classList.remove('hidden');

  } catch (error) {
    console.error(error);

    answer.textContent =
      `خطا: ${error.message}`;
  } finally {
    answer.classList.remove('loading');
  }
});


/* --------------------------------------------------
   Answer sheet
-------------------------------------------------- */

$('closeSheet').addEventListener('click', () => {
  answerSheet.classList.add('hidden');
});

$('closeWords').addEventListener('click', () => {
  wordsSheet.classList.add('hidden');
});


/* --------------------------------------------------
   Theme
-------------------------------------------------- */

const savedTheme =
  storage.get('theme', 'light');

if (savedTheme === 'dark') {
  document.body.classList.add('dark');
}

$('themeBtn').textContent =
  savedTheme === 'dark'
    ? '☀︎'
    : '☾';

$('themeBtn').addEventListener('click', () => {
  document.body.classList.toggle('dark');

  const dark =
    document.body.classList.contains('dark');

  storage.set(
    'theme',
    dark ? 'dark' : 'light'
  );

  $('themeBtn').textContent =
    dark ? '☀︎' : '☾';

  applyReaderTheme();
});


/* --------------------------------------------------
   Saved words
-------------------------------------------------- */

function getWords() {
  return storage.get('savedWords', []);
}

function setWords(words) {
  storage.set('savedWords', words);
}

saveWordBtn.addEventListener('click', () => {
  if (!currentSelection || !lastAnswer) return;

  const words = getWords();

  const entry = {
    text: currentSelection,
    answer: lastAnswer,
    savedAt: new Date().toISOString()
  };

  const deduped = [
    entry,
    ...words.filter(
      (word) =>
        word.text !== currentSelection
    )
  ].slice(0, 500);

  setWords(deduped);

  saveWordBtn.textContent =
    '★ ذخیره شد';

  setTimeout(() => {
    saveWordBtn.textContent =
      '☆ ذخیره در واژه‌ها';
  }, 1200);
});

function renderWords() {
  const words = getWords();

  const list = $('wordsList');

  if (!words.length) {
    list.innerHTML =
      '<div class="empty-words">هنوز واژه‌ای ذخیره نکرده‌ای.</div>';

    return;
  }

  list.innerHTML = '';

  for (const item of words) {
    const card =
      document.createElement('article');

    card.className =
      'word-card';


    const term =
      document.createElement('strong');

    term.textContent =
      item.text;


    const meaning =
      document.createElement('div');

    meaning.className =
      'word-answer';

    meaning.textContent =
      item.answer;


    const remove =
      document.createElement('button');

    remove.className =
      'remove-word';

    remove.textContent =
      'حذف';

    remove.addEventListener('click', () => {
      setWords(
        getWords().filter(
          (word) =>
            !(
              word.text === item.text &&
              word.savedAt === item.savedAt
            )
        )
      );

      renderWords();
    });

    card.append(
      term,
      meaning,
      remove
    );

    list.appendChild(card);
  }
}

$('wordsBtn').addEventListener('click', () => {
  renderWords();

  wordsSheet.classList.remove('hidden');
});


/* --------------------------------------------------
   Service Worker
-------------------------------------------------- */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .catch((error) => {
      console.warn(
        'Service worker registration failed:',
        error
      );
    });
}