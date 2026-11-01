/* كيّال — وضع عدم الاتصال (ADR-0010 جولة 3):
 * قشرة وظيفية لا رسالة: تقرأ مخزن الجهاز نفسه (IndexedDB kayyal-offline v2)
 * وتتيح: رؤية الطابور بصدق، وتعديل المسودات بنفس مفاتيحها، وقوائم المواد/
 * الأطراف من آخر لقطة مرجعية محمية محفوظة — بلا أي رحلة شبكة، وبختم زمني صادق
 * «آخر مزامنة». لا تُرسل شيئًا من هنا أبدًا؛ الإرسال للتطبيق عند العودة.
 */
(function () {
  'use strict';

  var DB_NAME = 'kayyal-offline';
  var DB_VERSION = 2;
  var OUTBOX = 'outbox';
  var DRAFTS = 'drafts';
  var REFS = 'refcache';
  var LOCK_KEY = 'gz.session.logoutLock.v1';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    banner: $('banner'), locked: $('locked'), content: $('content'),
    opsList: $('ops-list'), opsEmpty: $('ops-empty'), opsScope: $('ops-scope'),
    draftsList: $('drafts-list'), draftsEmpty: $('drafts-empty'),
    retry: $('retry'), retryLocked: $('retry-locked'), refNote: $('ref-note'),
  };

  function isLocked() {
    try { return localStorage.getItem(LOCK_KEY) === '1'; } catch (e) { return false; }
    return false;
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'queueId' });
        if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS);
        if (!db.objectStoreNames.contains(REFS)) db.createObjectStore(REFS);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb_open_failed')); };
    });
  }

  function txAll(db, storeName) {
    return new Promise(function (resolve, reject) {
      if (!db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      var req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error || new Error('idb_read_failed')); };
    });
  }

  function txAllKeys(db, storeName, values) {
    return new Promise(function (resolve, reject) {
      var store = db.transaction([storeName], 'readwrite').objectStore(storeName);
      var pairs = values.map(function (entry) { return entry; });
      var pending = pairs.length;
      if (pending === 0) { resolve(); return; }
      pairs.forEach(function (entry) {
        var req;
        if (store.keyPath) req = store.put(entry.value);
        else req = store.put(entry.value, entry.key);
        req.onerror = function () { reject(req.error || new Error('idb_write_failed')); };
        req.onsuccess = function () { pending -= 1; if (pending === 0) resolve(); };
      });
    });
  }

  var TYPE_LABELS = { purchase: 'شراء', sale: 'بيع', payment: 'سداد', expense: 'مصروف' };
  var STATUS_LABELS = {
    queued: ['queued', 'بانتظار الشبكة'],
    syncing: ['syncing', 'جارٍ الإرسال'],
    parked: ['parked', 'متوقفة — تسجيل دخول مطلوب'],
    conflict: ['conflict', 'تعارض يحتاج مراجعة'],
    acknowledged: ['ack', 'أكّدها الخادم'],
  };
  var DRAFT_TITLES = { 'expense': 'مصروف', 'payment': 'سداد/تحصيل', 'transaction:purchase': 'شراء', 'transaction:sale': 'بيع' };
  var FIELD_LABELS = {
    amount: 'المبلغ', note: 'ملاحظة', category: 'الفئة', payment_direction: 'الاتجاه',
    material_id: 'المادة', party_id: 'الطرف', weight_kg: 'الوزن (كجم)', unit_price: 'سعر الوحدة',
  };

  function fmtAmount(body) {
    var amount = body && body.amount;
    if (typeof amount !== 'string' && typeof amount !== 'number') return '';
    return ' — ' + amount;
  }

  function renderOps(ops) {
    els.opsList.innerHTML = '';
    var pending = ops.filter(function () { return true; });
    if (pending.length === 0) { els.opsEmpty.classList.remove('hidden'); return; }
    els.opsEmpty.classList.add('hidden');
    if (els.opsScope.textContent === '' && pending[0]) els.opsScope.textContent = '';
    pending.forEach(function (op) {
      var li = document.createElement('li');
      var status = STATUS_LABELS[op.status] || ['queued', op.status];
      var span = document.createElement('span');
      span.className = 'pill pill--' + status[0];
      span.textContent = status[1];
      var text = document.createElement('span');
      text.textContent = ' ' + (TYPE_LABELS[op.type] || op.type) + fmtAmount(op.body);
      li.appendChild(span);
      li.appendChild(text);
      var meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = 'مفتاح مطابق: ' + String(op.idempotencyKey).slice(0, 8) + '… · محاولات: ' + op.attempts;
      li.appendChild(meta);
      els.opsList.appendChild(li);
    });
  }

  function optionList(refItems, idKey, labelKey) {
    return (refItems || []).map(function (item) {
      return { value: item[idKey], label: item[labelKey] || item[idKey] };
    });
  }

  function renderDraftField(draft, key, value, onSave, refData) {
    var wrap = document.createElement('label');
    var caption = document.createElement('span');
    caption.textContent = FIELD_LABELS[key] || key;
    wrap.appendChild(caption);
    var input;
    var options = null;
    if (key === 'material_id') options = optionList(refData && refData.materials, 'id', 'display_name');
    if (key === 'party_id') options = optionList(refData && refData.parties, 'id', 'name');
    if (options && options.length) {
      input = document.createElement('select');
      var empty = document.createElement('option');
      empty.value = ''; empty.textContent = '— اختر —';
      input.appendChild(empty);
      options.forEach(function (opt) {
        var option = document.createElement('option');
        option.value = opt.value; option.textContent = opt.label;
        input.appendChild(option);
      });
      input.value = value == null ? '' : String(value);
    } else {
      input = document.createElement('input');
      input.value = value == null ? '' : String(value);
    }
    input.addEventListener('change', function () {
      onSave(key, input.value);
    });
    wrap.appendChild(input);
    return wrap;
  }

  function renderDrafts(db, drafts, refData) {
    els.draftsList.innerHTML = '';
    var active = drafts.filter(function (draft) { return draft && draft.intent; });
    if (active.length === 0) { els.draftsEmpty.classList.remove('hidden'); return; }
    els.draftsEmpty.classList.add('hidden');
    active.forEach(function (draft) {
      var card = document.createElement('div');
      card.className = 'card';
      var title = document.createElement('h2');
      title.textContent = (DRAFT_TITLES[draft.formKey] || draft.formKey) + ' — مسودة';
      card.appendChild(title);
      var meta = document.createElement('p');
      meta.className = 'note';
      meta.textContent = 'حُفظت ' + new Date(draft.savedAt).toLocaleString('ar-EG') + ' · مفتاح الإرسال الأصلي محفوظ: ' + String(draft.intent.idempotencyKey).slice(0, 8) + '…';
      card.appendChild(meta);
      var fields = draft.fields || {};
      var keys = Object.keys(fields).filter(function (key) {
        return typeof fields[key] === 'string' || typeof fields[key] === 'number';
      });
      keys.forEach(function (key) {
        card.appendChild(renderDraftField(draft, key, fields[key], function (k, v) {
          var next = Object.assign({}, fields); next[k] = v;
          draft.fields = next;
          txAllKeys(db, DRAFTS, [{ key: draft.scope + '|' + draft.formKey, value: draft }]).then(function () {
            showBanner('تم حفظ تعديل المسودة على الجهاز — سيستكمل الإرسال بنفس المفتاح عند عودة الاتصال', true);
          }).catch(function () {
            showBanner('تعذّر حفظ التعديل محليًا — لم يتغير شيء', false);
          });
        }, refData));
      });
      els.draftsList.appendChild(card);
    });
  }

  function showBanner(text, ok) {
    els.banner.textContent = text;
    els.banner.className = ok ? 'ok' : '';
    els.banner.classList.remove('hidden');
  }

  function probeAndResume() {
    fetch('/api/auth/csrf', { cache: 'no-store' }).then(function (response) {
      if (response.ok) { showBanner('عاد الاتصال — يُفتح التطبيق الآن، والمعلّق سيُرسل بنفسه', true); setTimeout(function () { window.location.href = '/today'; }, 900); }
      else showBanner('الشبكة متاحة لكن الخادم لم يجب بعد — انتظر قليلًا', false);
    }).catch(function () { showBanner('ما زلتم دون اتصال — التعديلات محفوظة على الجهاز', false); });
  }

  async function main() {
    if (isLocked()) { els.locked.classList.remove('hidden'); els.retryLocked.addEventListener('click', probeAndResume); return; }
    els.content.classList.remove('hidden');
    var db;
    try { db = await openDb(); }
    catch (error) { showBanner('تعذّر فتح مخزن الجهاز — لا شيء يُعرض من هنا', false); return; }
    var ops = await txAll(db, OUTBOX);
    var drafts = await txAll(db, DRAFTS);
    var refs = await txAll(db, REFS);
    var snapshot = null;
    for (var i = 0; i < refs.length; i += 1) {
      if (refs[i] && refs[i].kind === 'snapshot') snapshot = refs[i].payload;
    }
    if (snapshot && snapshot.fetched_at) {
      els.refNote.textContent = 'القوائم المرجعية من آخر مزامنة ناجحة: ' + new Date(snapshot.fetched_at).toLocaleString('ar-EG');
    } else {
      els.refNote.textContent = 'لا لقطة مرجعية محفوظة بعد — قوائم الاختيار قد تكون بلا عناصر حتى أول اتصال ناجح.';
    }
    renderOps(ops);
    renderDrafts(db, drafts, snapshot);
    els.retry.addEventListener('click', probeAndResume);
    window.addEventListener('online', probeAndResume);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { void mainRefresh(db); }
    });
  }

  async function mainRefresh(db) {
    if (isLocked()) { window.location.reload(); return; }
    try {
      var ops = await txAll(db, OUTBOX);
      var drafts = await txAll(db, DRAFTS);
      renderOps(ops);
      var refs = await txAll(db, REFS);
      var snapshot = null;
      for (var i = 0; i < refs.length; i += 1) if (refs[i] && refs[i].kind === 'snapshot') snapshot = refs[i].payload;
      renderDrafts(db, drafts, snapshot);
    } catch (error) { /* القراءة التالية عند التبديل التالي */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
  else main();
})();
