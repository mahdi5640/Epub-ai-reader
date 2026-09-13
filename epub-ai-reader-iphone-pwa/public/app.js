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

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function openPicker() {
  fileInput.click();
}

openBtn.addEventListener('click', openPicker);
emptyOpenBtn.addEventListener('click', openPicker);


/* ---------- Theme ---------- */

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


/* ---------- Context ---------- */

function extractContext(fullText, selectedText) {
  const clean = normalizeText(fullText);
  const selected = normalizeText(selectedText);

  if (!clean) return '';

  const index = clean.indexOf(selected);

  if (index < 0) {
    return clean.slice(0, 1200);
  }

  return clean.slice(
    Math.max(0, index - 500),
    Math.min(clean.length, index + selected.length + 500)
  );
}


/* ---------- Selected text ---------- */

function showSelection(text, fullText = '') {
  const cleanText = normalizeText(text);

  if (!cleanText) return;

  currentSelection = cleanText;
  currentContext = extractContext(fullText, cleanText);

  selectedPreview.textContent = cleanText;

  selectionBar.classList.remove('hidden');
}


/*
  This function reads the actual browser selection
  inside the EPUB iframe.
*/
function readSelectionFromContents(contents) {
  try {
    const win = contents.window;
    const doc = contents.document;

    if (!win || !doc) return;

    const selection = win.getSelection();

    if (!selection || selection.rangeCount === 0) return;

    const text = normalizeText(selection.toString());

    if (!text) return;

    const fullText =
      doc.body?.innerText ||
      doc.body?.textContent ||
      '';

    showSelection(text, fullText);

  } catch (error) {
    console.warn('Selection read failed:', error);
  }
}


/*
  Important:
  EPUB.js puts book content inside an iframe.

  rendition.hooks.content.register guarantees that
  these listeners are installed inside EVERY chapter
  iframe as it is created.
*/
function installSelectionHandlers(contents) {
  try {
    const doc = contents.document;

    if (!doc) return;

    let selectionTimer = null;

    const delayedRead = (delay = 50) => {
      clearTimeout(selectionTimer);

      selectionTimer = setTimeout(() => {
        readSelectionFromContents(contents);
      }, delay);
    };


    /* Mac / desktop */
    doc.addEventListener(
      'mouseup',
      () => delayedRead(30),
      true
    );


    /* iPhone / iPad */
    doc.addEventListener(
      'touchend',
      () => delayedRead(250),
      true
    );


    /*
      Works when Safari changes text selection handles,
      including long-press selection on iPhone.
    */
    doc.addEventListener(
      'selectionchange',
      () => {
        const selection =
          contents.window?.getSelection?.();

        if (!selection) return;

        const text =
          normalizeText(selection.toString());

        if (!text) return;

        delayedRead(80);
      },
      true
    );


    /*
      Make sure selection is allowed.
    */
    const style =
      doc.createElement('style');

    style.textContent = `
      body, body * {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
    `;

    doc.head?.appendChild(style);

  } catch (error) {
    console.warn(
      'Could not install EPUB selection handlers:',
      error
    );
  }
}


/* ---------- Open EPUB ---------- */

fileInput.addEventListener(
  'change',
  async (event) => {

    const file =
      event.target.files?.[0];

    if (!file) return;

    currentBookKey =
      bookKey(file);

    currentSelection = '';
    currentContext = '';

    selectionBar.classList.add('hidden');

    try {

      const buffer =
        await file.arrayBuffer();


      if (rendition) {
        try {
          rendition.destroy();
        } catch {}

        rendition = null;
      }


      if (book) {
        try {
          book.destroy();
        } catch {}

        book = null;
      }


      book = ePub(buffer);


      rendition = book.renderTo(
        'viewer',
        {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'paginated'
        }
      );


      /*
        THIS is the key fix.
        Attach handlers before displaying chapters.
      */
      rendition.hooks.content.register(
        (contents) => {
          installSelectionHandlers(contents);
        }
      );


      applyReaderTheme();


      /*
        EPUB.js native selection event.
        Kept as an additional fallback.
      */
      rendition.on(
        'selected',
        async (cfiRange, contents) => {

          try {

            let text = '';

            /*
              First try browser selection.
            */
            const nativeSelection =
              contents.window?.getSelection?.();

            if (nativeSelection) {
              text =
                normalizeText(
                  nativeSelection.toString()
                );
            }


            /*
              If that failed, ask EPUB.js/book for range.
            */
            if (!text) {

              try {
                const range =
                  await book.getRange(cfiRange);

                text =
                  normalizeText(
                    range?.toString()
                  );

              } catch (rangeError) {
                console.warn(
                  'Could not resolve EPUB range:',
                  rangeError
                );
              }
            }


            if (!text) return;


            const fullText =
              contents.document.body?.innerText ||
              contents.document.body?.textContent ||
              '';


            showSelection(
              text,
              fullText
            );

          } catch (error) {

            console.warn(
              'EPUB selected event failed:',
              error
            );

          }

        }
      );


      rendition.on(
        'relocated',
        (location) => {

          const percentage =
            location?.start?.percentage;


          $('locationText').textContent =
            Number.isFinite(percentage)
              ? `${Math.max(
                  1,
                  Math.round(
                    percentage * 100
                  )
                )}٪`
              : '—';


          const cfi =
            location?.start?.cfi;


          if (
            cfi &&
            currentBookKey
          ) {

            storage.set(
              `${currentBookKey}:position`,
              cfi
            );

          }

        }
      );


      await book.ready;


      const savedPosition =
        storage.get(
          `${currentBookKey}:position`
        );


      try {

        await rendition.display(
          savedPosition || undefined
        );

      } catch {

        await rendition.display();

      }


      emptyState.classList.add(
        'hidden'
      );

      readerWrap.classList.remove(
        'hidden'
      );


      fileInput.value = '';


    } catch (error) {

      console.error(error);

      alert(
        'باز کردن EPUB با خطا مواجه شد.'
      );

    }

  }
);


/* ---------- Reader navigation ---------- */

$('prevBtn').addEventListener(
  'click',
  () => rendition?.prev()
);

$('nextBtn').addEventListener(
  'click',
  () => rendition?.next()
);


/* ---------- AI actions ---------- */

selectionBar.addEventListener(
  'click',
  async (event) => {

    const button =
      event.target.closest(
        'button[data-mode]'
      );

    if (
      !button ||
      !currentSelection
    ) return;


    const mode =
      button.dataset.mode;


    const titleMap = {
      word: 'معنی در متن',
      translate: 'ترجمه',
      explain: 'توضیح',
      grammar: 'گرامر'
    };


    sheetTitle.textContent =
      titleMap[mode] ||
      'توضیح';


    sheetSelection.textContent =
      currentSelection;


    answer.textContent =
      'در حال دریافت پاسخ…';


    answer.classList.add(
      'loading'
    );


    answerSheet.classList.remove(
      'hidden'
    );


    selectionBar.classList.add(
      'hidden'
    );


    saveWordBtn.classList.add(
      'hidden'
    );


    lastAnswer = '';


    try {

      const response =
        await fetch(
          '/api/explain',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body: JSON.stringify({
              selection:
                currentSelection,

              context:
                currentContext,

              mode,

              targetLanguage:
                'fa'
            })
          }
        );


      let data = {};

      try {
        data =
          await response.json();
      } catch {
        throw new Error(
          `پاسخ نامعتبر از سرور (${response.status})`
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


      answer.textContent =
        lastAnswer;


      saveWordBtn.classList.remove(
        'hidden'
      );


    } catch (error) {

      console.error(error);

      answer.textContent =
        `خطا: ${error.message}`;

    } finally {

      answer.classList.remove(
        'loading'
      );

    }

  }
);


/* ---------- Answer sheets ---------- */

$('closeSheet').addEventListener(
  'click',
  () => {
    answerSheet.classList.add(
      'hidden'
    );
  }
);


$('closeWords').addEventListener(
  'click',
  () => {
    wordsSheet.classList.add(
      'hidden'
    );
  }
);


/* ---------- Theme ---------- */

const savedTheme =
  storage.get(
    'theme',
    'light'
  );


if (savedTheme === 'dark') {
  document.body.classList.add(
    'dark'
  );
}


$('themeBtn').textContent =
  savedTheme === 'dark'
    ? '☀︎'
    : '☾';


$('themeBtn').addEventListener(
  'click',
  () => {

    document.body.classList.toggle(
      'dark'
    );


    const dark =
      document.body.classList.contains(
        'dark'
      );


    storage.set(
      'theme',
      dark
        ? 'dark'
        : 'light'
    );


    $('themeBtn').textContent =
      dark
        ? '☀︎'
        : '☾';


    applyReaderTheme();

  }
);


/* ---------- Saved words ---------- */

function getWords() {
  return storage.get(
    'savedWords',
    []
  );
}


function setWords(words) {
  storage.set(
    'savedWords',
    words
  );
}


saveWordBtn.addEventListener(
  'click',
  () => {

    if (
      !currentSelection ||
      !lastAnswer
    ) return;


    const words =
      getWords();


    const entry = {
      text:
        currentSelection,

      answer:
        lastAnswer,

      savedAt:
        new Date().toISOString()
    };


    const deduped = [
      entry,

      ...words.filter(
        (word) =>
          word.text !==
          currentSelection
      )

    ].slice(
      0,
      500
    );


    setWords(
      deduped
    );


    saveWordBtn.textContent =
      '★ ذخیره شد';


    setTimeout(
      () => {
        saveWordBtn.textContent =
          '☆ ذخیره در واژه‌ها';
      },
      1200
    );

  }
);


function renderWords() {

  const words =
    getWords();


  const list =
    $('wordsList');


  if (!words.length) {

    list.innerHTML =
      '<div class="empty-words">هنوز واژه‌ای ذخیره نکرده‌ای.</div>';

    return;

  }


  list.innerHTML = '';


  for (
    const item of words
  ) {

    const card =
      document.createElement(
        'article'
      );


    card.className =
      'word-card';


    const term =
      document.createElement(
        'strong'
      );


    term.textContent =
      item.text;


    const meaning =
      document.createElement(
        'div'
      );


    meaning.className =
      'word-answer';


    meaning.textContent =
      item.answer;


    const remove =
      document.createElement(
        'button'
      );


    remove.className =
      'remove-word';


    remove.textContent =
      'حذف';


    remove.addEventListener(
      'click',
      () => {

        setWords(
          getWords().filter(
            (word) =>
              !(
                word.text ===
                  item.text &&
                word.savedAt ===
                  item.savedAt
              )
          )
        );


        renderWords();

      }
    );


    card.append(
      term,
      meaning,
      remove
    );


    list.appendChild(
      card
    );

  }

}


$('wordsBtn').addEventListener(
  'click',
  () => {

    renderWords();

    wordsSheet.classList.remove(
      'hidden'
    );

  }
);


/* ---------- Service worker ---------- */

if (
  'serviceWorker' in navigator
) {

  navigator.serviceWorker
    .register('/sw.js')
    .catch(
      (error) => {

        console.warn(
          'Service worker registration failed:',
          error
        );

      }
    );

}