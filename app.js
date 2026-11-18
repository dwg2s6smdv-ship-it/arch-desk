(function () {
  'use strict';

  var DATABASE_ID = 'ZnsVx8M4xTAmMf5tkI0nAH';
  var CACHE_KEY = 'arch_desk_v2_cache';
  var DRAFT_KEY = 'arch_desk_draft_v1';
  var LOCAL_KEY = 'arch_desk_local_v1';
  var ZONE_RADAR = '我的今日雷达';
  var ZONE_TRAP = '设总防坑清单';
  var ZONE_ARCHIVE = '归档台账';
  var ZONES = ['前期方案强排', '投标项目', '项目报规'];


  var rows = [];
  var editingId = null;
  var toastTimer = null;

  var SP = window.__SMART_PAGE__;
  var db = (SP && SP.database) ? SP.database : null;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = String(text); }
    return n;
  }

  function str(v) { return (v === null || v === undefined) ? '' : String(v); }

  function bind(node) {
    node.setAttribute('data-sp-bindable', 'database');
    node.setAttribute('data-sp-database-id', DATABASE_ID);
    return node;
  }

  function renderSkeleton() {
    var boxes = [$('radarBox'), $('zone-前期方案强排'), $('zone-投标项目'), $('zone-项目报规'), $('trapBox'), $('arcBox')];
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i]) { continue; }
      boxes[i].innerHTML = '';
      var wrap = el('div', 'skel-wrap');
      for (var k = 0; k < 2; k++) {
        var line = el('div', 'skel');
        line.appendChild(el('i', ''));
        line.appendChild(el('i', ''));
        wrap.appendChild(line);
      }
      boxes[i].appendChild(wrap);
    }
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show';
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 1900);
  }

  function setSync(state, text) {
    $('syncTag').className = 'sync ' + state;
    $('syncText').textContent = text;
  }

  function zoneRows(zone) {
    var out = [];
    for (var i = 0; i < rows.length; i++) { if (rows[i].zone === zone) { out.push(rows[i]); } }
    return out;
  }

  function fmtDate(v) {
    if (!v) { return ''; }
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[2] + '-' + m[3]) : String(v);
  }

  function isOverdue(v) {
    if (!v) { return false; }
    var t = new Date(String(v).slice(0, 10) + 'T23:59:59');
    return !isNaN(t.getTime()) && t.getTime() < Date.now();
  }

  function normalize(rec) {
    return {
      id: rec._id || rec.id || '',
      name: str(rec['条目名称']),
      zone: str(rec['所属分区']),
      kind: str(rec['条目类型']),
      desc: str(rec['说明']),
      path: str(rec['链接或路径']),
      status: str(rec['状态']),
      owner: str(rec['责任人']),
      due: str(rec['截止日期']),
      order: typeof rec['排序'] === 'number' ? rec['排序'] : 999
    };
  }

  function fetchAll(cursor, acc, guard) {
    acc = acc || [];
    guard = guard || 0;
    if (guard > 40) { return Promise.resolve(acc); }
    return db.query({ databaseId: DATABASE_ID, pageSize: 200, startCursor: cursor })
      .then(function (r) {
        acc = acc.concat((r && r.results) || []);
        var next = r && r.nextCursor;
        if (r && r.hasMore && next && next !== cursor && (r.results || []).length) {
          return fetchAll(next, acc, guard + 1);
        }
        return acc;
      })
      .catch(function (err) { throw err; });
  }

  function loadLocal() {
    var raw = null;
    try { raw = localStorage.getItem(LOCAL_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.length) { return parsed; }
      } catch (e2) { /* 本地数据损坏则回落到快照 */ }
    }
    return JSON.parse(JSON.stringify(SNAPSHOT));
  }

  function persistLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(rows)); }
    catch (e) { toast('本机存储写入失败，改动未保存'); }
  }

  function loadData() {
    if (!db) {
      rows = loadLocal();
      rows.sort(function (a, b) { return a.order - b.order; });
      refreshAll();
      setSync('off', '快照版 · ' + rows.length + ' 条 · 改动存本机');
      return;
    }
    setSync('', '同步中');
    fetchAll().then(function (list) {
      rows = list.map(normalize).sort(function (a, b) { return a.order - b.order; });
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch (e) { /* 缓存失败不影响主流程 */ }
      refreshAll();
      setSync('ok', '已同步 · ' + rows.length + ' 条');
    }).catch(function (err) {
      console.error('[database] 读取失败:', err);
      renderFromCache('读取失败');
      setSync('err', '读取失败');
    });
  }

  function renderFromCache(reason) {
    rows = loadLocal();
    rows.sort(function (a, b) { return a.order - b.order; });
    refreshAll();
    setSync('off', reason + ' · 快照 ' + rows.length + ' 条');
  }

  var PROP_FIELD = {
    '条目名称': 'name', '说明': 'desc', '链接或路径': 'path', '状态': 'status',
    '所属分区': 'zone', '条目类型': 'kind', '责任人': 'owner', '截止日期': 'due', '排序': 'order'
  };

  function applyLocalProps(id, props) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id !== id) { continue; }
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) { continue; }
        var f = PROP_FIELD[k];
        if (!f) { continue; }
        var v = props[k];
        if (v.text !== undefined) { rows[i][f] = String(v.text); }
        else if (v.select !== undefined) { rows[i][f] = String(v.select); }
        else if (v.date !== undefined) { rows[i][f] = String(v.date); }
        else if (v.number !== undefined) { rows[i][f] = Number(v.number); }
      }
    }
  }

  function saveRecord(id, props, done) {
    if (!db) {
      applyLocalProps(id, props);
      persistLocal();
      done();
      return;
    }
    db.updateRecord({ databaseId: DATABASE_ID, recordId: id, properties: props })
      .then(function () { done(); })
      .catch(function (err) { console.error('[database] 保存失败:', err); toast('保存失败，请重试'); });
  }

  function radarRows() {
    var list = zoneRows(ZONE_RADAR);
    list.sort(function (a, b) {
      var da = a.status === '已完成' ? 1 : 0;
      var db2 = b.status === '已完成' ? 1 : 0;
      if (da !== db2) { return da - db2; }
      var oa = isOverdue(a.due) ? 0 : 1;
      var ob = isOverdue(b.due) ? 0 : 1;
      if (oa !== ob) { return oa - ob; }
      var ta = a.due ? Date.parse(a.due) : Infinity;
      var tb = b.due ? Date.parse(b.due) : Infinity;
      if (ta !== tb) { return ta - tb; }
      return a.order - b.order;
    });
    return list;
  }

  function renderRadar() {
    var box = $('radarBox');
    box.innerHTML = '';
    var list = radarRows();
    var dn = 0, od = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === '已完成') { dn++; }
      else if (isOverdue(list[i].due)) { od++; }
    }
    var parts = [];
    if (list.length - dn > 0) { parts.push((list.length - dn) + ' 项待办'); }
    if (od > 0) { parts.push(od + ' 项逾期'); }
    $('radarCnt').textContent = parts.length ? parts.join(' · ') : (list.length ? '已清空' : '');

    if (!list.length) {
      box.appendChild(el('div', 'empty', '雷达是空的。点右上「＋ 新增」，把今天最急的一件事写进来。'));
      return;
    }
    for (var k = 0; k < list.length; k++) { box.appendChild(todoRow(list[k])); }
  }

  function kindBadge(kind) {
    var map = { '模板': 'b-tpl', '链接': 'b-link', '提醒': 'b-tip', '表格': 'b-tab', '实体/线下': 'b-phy' };
    return el('span', 'badge ' + (map[kind] || 'b-tpl'), kind || '条目');
  }

  function mkEditBtn(r) {
    var b = el('button', 'mini ghost', '编辑');
    b.type = 'button';
    b.addEventListener('click', function () { openDialog(r); });
    return b;
  }

  function renderItem(r) {
    var isWarn = r.kind === '提醒';
    var box = bind(el('div', 'item' + (isWarn ? ' warn' : '')));

    var h = el('div', 'item-h');
    h.appendChild(kindBadge(r.kind));
    h.appendChild(el('span', 'name', r.name));
    box.appendChild(h);

    if (isWarn) {
      var line = el('div', 'warn-line');
      var parts = r.desc.split(/\s*[·\/]\s*/);
      for (var i = 0; i < parts.length; i++) {
        if (i > 0) { line.appendChild(el('em', '', '·')); }
        line.appendChild(document.createTextNode(parts[i].replace(/^\s+|\s+$/g, '')));
      }
      box.appendChild(line);
      var a0 = el('div', 'item-act');
      a0.appendChild(mkEditBtn(r));
      box.appendChild(a0);
      return box;
    }

    box.appendChild(el('div', 'desc', r.desc));
    if (r.path) { box.appendChild(el('div', 'path', r.path)); }

    var act = el('div', 'item-act');
    if (r.path) {
      var isUrl = /^https?:\/\//i.test(r.path);
      var b = el('button', 'mini', isUrl ? '打开链接' : '复制路径');
      b.type = 'button';
      b.addEventListener('click', function () {
        if (isUrl) { window.open(r.path, '_blank', 'noopener'); }
        else { copyText(r.path); }
      });
      act.appendChild(b);
    }
    act.appendChild(mkEditBtn(r));
    box.appendChild(act);
    return box;
  }

  function renderZones() {
    var total = 0;
    for (var z = 0; z < ZONES.length; z++) {
      var zone = ZONES[z];
      var box = $('zone-' + zone);
      if (!box) { continue; }
      box.innerHTML = '';
      var list = zoneRows(zone);
      total += list.length;
      var cntEl = document.querySelector('[data-zone-cnt="' + zone + '"]');
      if (cntEl) { cntEl.textContent = list.length ? list.length + ' 条' : ''; }
      if (!list.length) {
        box.appendChild(el('div', 'empty', '暂无条目'));
        continue;
      }
      for (var i = 0; i < list.length; i++) { box.appendChild(renderItem(list[i])); }
    }
    $('phaseCnt').textContent = total ? total + ' 条' : '';
    $('footCnt').textContent = String(rows.length);
  }

  function todoRow(r) {
    var done = r.status === '已完成';
    var row = bind(el('div', 'todo' + (done ? ' done' : '')));

    var cb = el('button', 'cb');
    cb.type = 'button';
    cb.setAttribute('aria-label', done ? '标记为未完成' : '标记为已完成');
    cb.addEventListener('click', function () { toggleTodo(r, done); });
    row.appendChild(cb);

    var main = el('div', 'todo-main');
    main.appendChild(el('div', 't-name', r.name));
    if (r.desc) { main.appendChild(el('div', 't-desc', r.desc)); }

    var meta = el('div', 't-meta');
    if (r.owner) { meta.appendChild(el('span', '', '责任人 ' + r.owner)); }
    if (r.due) {
      var od = !done && isOverdue(r.due);
      meta.appendChild(el('span', od ? 'od' : '', '截止 ' + fmtDate(r.due) + (od ? ' · 已逾期' : '')));
    }
    main.appendChild(meta);
    row.appendChild(main);

    var act = el('div', 'item-act');
    act.appendChild(mkEditBtn(r));
    row.appendChild(act);
    return row;
  }

  function trapCard(r, no) {
    var isWarn = r.kind === '提醒';
    var card = bind(el('div', 'trap' + (isWarn ? '' : ' tool')));

    var head = el('div', 'trap-h');
    var ns = no < 10 ? '0' + no : String(no);
    head.appendChild(el('span', 'trap-no', ns));
    head.appendChild(el('h3', '', r.name));
    card.appendChild(head);

    card.appendChild(el('p', '', r.desc));
    if (r.path) { card.appendChild(el('div', 'path', r.path)); }

    var act = el('div', 'trap-act');
    act.appendChild(mkEditBtn(r));
    card.appendChild(act);

    return card;
  }

  function renderTraps() {
    var box = $('trapBox');
    box.innerHTML = '';
    var list = zoneRows(ZONE_TRAP);
    $('trapCnt').textContent = list.length ? list.length + ' 条' : '';
    if (!list.length) {
      box.appendChild(el('div', 'empty', '暂无防坑条目。点右上「＋ 新增条目」，把踩过的坑写下来。'));
      return;
    }
    for (var i = 0; i < list.length; i++) { box.appendChild(trapCard(list[i], i + 1)); }
  }

  function renderArchive() {
    var box = $('arcBox');
    box.innerHTML = '';
    var list = zoneRows(ZONE_ARCHIVE);
    $('arcCnt').textContent = list.length ? list.length + ' 条' : '';
    if (!list.length) {
      box.appendChild(el('div', 'empty', '还没有归档入口。点右上「＋ 新增」，把复盘台账挂上来。'));
      return;
    }
    for (var i = 0; i < list.length; i++) { box.appendChild(renderItem(list[i])); }
  }

  function toggleTodo(r, wasDone) {
    var next = wasDone ? '待办' : '已完成';
    saveRecord(r.id, { '状态': { select: next } }, function () {
      r.status = next;
      refreshAll();
      toast(next === '已完成' ? '已标记完成' : '已恢复待办');
    });
  }

  function openDialog(r) {
    editingId = r.id;
    resetDeleteBtn();
    $('dlgTitle').textContent = '编辑 · ' + r.name;
    $('fName').value = r.name;
    $('fDesc').value = r.desc;
    $('fPath').value = r.path;
    $('mask').hidden = false;
    $('fName').focus();
  }

  function closeDialog() {
    $('mask').hidden = true;
    editingId = null;
  }

  function saveDialog() {
    var id = editingId;
    if (!id) { return; }
    var name = $('fName').value.replace(/^\s+|\s+$/g, '');
    if (!name) { toast('名称不能为空'); return; }
    var desc = $('fDesc').value.replace(/^\s+|\s+$/g, '');
    var path = $('fPath').value.replace(/^\s+|\s+$/g, '');
    var props = { '条目名称': { text: name }, '说明': { text: desc }, '链接或路径': { text: path } };
    saveRecord(id, props, function () {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === id) { rows[i].name = name; rows[i].desc = desc; rows[i].path = path; break; }
      }
      closeDialog();
      refreshAll();
      toast('已保存');
    });
  }

  var delArmed = false;
  var delTimer = null;

  function resetDeleteBtn() {
    delArmed = false;
    if (delTimer) { clearTimeout(delTimer); delTimer = null; }
    $('btnDelete').textContent = '删除条目';
  }

  function deleteCurrent() {
    var id = editingId;
    if (!id) { return; }

    if (!delArmed) {
      delArmed = true;
      $('btnDelete').textContent = '再点一次，确认删除';
      if (delTimer) { clearTimeout(delTimer); }
      delTimer = setTimeout(resetDeleteBtn, 3500);
      return;
    }

    resetDeleteBtn();

    if (!db) {
      closeDialog();
      var keepL = [];
      for (var j = 0; j < rows.length; j++) {
        if (rows[j].id !== id) { keepL.push(rows[j]); }
      }
      rows = keepL;
      persistLocal();
      refreshAll();
      toast('已删除 · 仅本机');
      return;
    }

    db.deleteRecord({ databaseId: DATABASE_ID, recordId: id })
      .then(function () {
        closeDialog();
        var keep = [];
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].id !== id) { keep.push(rows[i]); }
        }
        rows = keep;
        refreshAll();
        toast('已删除');
      })
      .catch(function (err) { console.error('[database] 删除失败:', err); toast('删除失败，请重试'); });
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        name: $('aName').value, desc: $('aDesc').value,
        owner: $('aOwner').value, due: $('aDue').value
      }));
    } catch (e) { /* 草稿写入失败不影响主流程 */ }
  }

  function restoreDraft() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { raw = null; }
    if (!raw) { return; }
    try {
      var d = JSON.parse(raw);
      if (d.name) { $('aName').value = d.name; }
      if (d.desc) { $('aDesc').value = d.desc; }
      if (d.owner) { $('aOwner').value = d.owner; }
      if (d.due) { $('aDue').value = d.due; }
    } catch (e2) { /* 草稿损坏则忽略 */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* 清理失败可忽略 */ }
  }

  function openAdd() {
    $('aName').value = '';
    $('aDesc').value = '';
    $('aOwner').value = '我';
    $('aDue').value = '';
    restoreDraft();
    $('mask2').hidden = false;
    $('aName').focus();
  }

  function closeAdd() { $('mask2').hidden = true; }

  function saveAdd() {
    var name = $('aName').value.replace(/^\s+|\s+$/g, '');
    if (!name) { toast('名称不能为空'); return; }
    var desc = $('aDesc').value.replace(/^\s+|\s+$/g, '');
    var owner = $('aOwner').value.replace(/^\s+|\s+$/g, '');
    var due = $('aDue').value;

    if (!db) {
      rows.push({
        id: 'local_' + Date.now(),
        name: name, zone: ZONE_RADAR, kind: '待办',
        desc: desc, path: '', status: '待办',
        owner: owner, due: due, order: nextOrder(ZONE_RADAR)
      });
      persistLocal();
      clearDraft();
      closeAdd();
      refreshAll();
      toast('已加入今日雷达 · 仅本机');
      return;
    }

    var props = {
      '条目名称': { text: name },
      '所属分区': { select: ZONE_RADAR },
      '条目类型': { select: '待办' },
      '状态': { select: '待办' },
      '排序': { number: nextOrder(ZONE_RADAR) }
    };
    if (desc) { props['说明'] = { text: desc }; }
    if (owner) { props['责任人'] = { text: owner }; }
    if (due) { props['截止日期'] = { date: due }; }
    db.addRecord({ databaseId: DATABASE_ID, properties: props })
      .then(function () {
        clearDraft();
        closeAdd();
        toast('已加入今日雷达');
        loadData();
      })
      .catch(function (err) { console.error('[database] 新增失败:', err); toast('新增失败，请重试'); });
  }

  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt)
        .then(function () { toast('路径已复制'); })
        .catch(function () { fallbackCopy(txt); });
    } else {
      fallbackCopy(txt);
    }
  }

  function fallbackCopy(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('路径已复制'); }
    catch (e) { toast('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }

  function exportBackup() {
    var d = new Date();
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    var data = { exportedAt: d.toISOString(), total: rows.length, items: rows };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '设总工作台_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 600);
  }

  function refreshAll() {
    renderRadar();
    renderZones();
    renderTraps();
    renderArchive();
  }

  $('btnRefresh').addEventListener('click', function () { loadData(); });
  $('btnExport').addEventListener('click', exportBackup);
  $('btnCancel').addEventListener('click', closeDialog);
  $('btnSave').addEventListener('click', saveDialog);
  $('btnDelete').addEventListener('click', deleteCurrent);
  $('mask').addEventListener('click', function (e) { if (e.target === $('mask')) { closeDialog(); } });
  $('btnAdd').addEventListener('click', openAdd);
  var draftInputs = [$('aName'), $('aDesc'), $('aOwner'), $('aDue')];
  for (var di = 0; di < draftInputs.length; di++) {
    if (draftInputs[di]) { draftInputs[di].addEventListener('input', saveDraft); }
  }
  $('aCancel').addEventListener('click', closeAdd);
  $('aSave').addEventListener('click', saveAdd);
  $('mask2').addEventListener('click', function (e) { if (e.target === $('mask2')) { closeAdd(); } });
  var addTarget = ZONE_TRAP;

  function openAdd3(zone) {
    addTarget = zone;
    var title = '新增防坑条目';
    var kind = '实体/线下';
    if (zone === ZONE_ARCHIVE) { title = '新增归档入口'; kind = '链接'; }
    else if (zone !== ZONE_TRAP) { title = '新增 · ' + zone; kind = '模板'; }
    $('t3Title').textContent = title;
    $('t3Name').value = '';
    $('t3Desc').value = '';
    $('t3Path').value = '';
    $('t3Kind').value = kind;
    $('mask3').hidden = false;
    $('t3Name').focus();
  }

  function closeAdd3() { $('mask3').hidden = true; }

  function nextOrder(zone) {
    var max = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].zone !== zone) { continue; }
      if (rows[i].order >= 900) { continue; }
      if (rows[i].order > max) { max = rows[i].order; }
    }
    return max + 1;
  }

  function saveAdd3() {
    var name = $('t3Name').value.replace(/^\s+|\s+$/g, '');
    if (!name) { toast('标题不能为空'); return; }
    var desc = $('t3Desc').value.replace(/^\s+|\s+$/g, '');
    var path = $('t3Path').value.replace(/^\s+|\s+$/g, '');
    var kind = $('t3Kind').value || '提醒';

    if (!db) {
      rows.push({
        id: 'local_' + Date.now(),
        name: name, zone: addTarget, kind: kind,
        desc: desc, path: path, status: '待办',
        owner: '', due: '', order: nextOrder(addTarget)
      });
      persistLocal();
      closeAdd3();
      refreshAll();
      toast('已新增 · 仅本机');
      return;
    }

    var props = {
      '条目名称': { text: name },
      '所属分区': { select: addTarget },
      '条目类型': { select: kind },
      '状态': { select: '待办' },
      '排序': { number: nextOrder(addTarget) }
    };
    if (desc) { props['说明'] = { text: desc }; }
    if (path) { props['链接或路径'] = { text: path }; }
    db.addRecord({ databaseId: DATABASE_ID, properties: props })
      .then(function () {
        closeAdd3();
        toast(addTarget === ZONE_ARCHIVE ? '已加入归档入口'
          : (addTarget === ZONE_TRAP ? '已加入防坑清单' : '已加入 ' + addTarget));
        loadData();
      })
      .catch(function (err) { console.error('[database] 新增失败:', err); toast('新增失败，请重试'); });
  }

  $('btnAddTrap').addEventListener('click', function () { openAdd3(ZONE_TRAP); });
  $('btnAddArc').addEventListener('click', function () { openAdd3(ZONE_ARCHIVE); });
  var zoneAddBtns = document.querySelectorAll('.zone-add');
  for (var za = 0; za < zoneAddBtns.length; za++) {
    (function (b) {
      b.addEventListener('click', function () { openAdd3(b.getAttribute('data-zone')); });
    })(zoneAddBtns[za]);
  }
  $('t3Cancel').addEventListener('click', closeAdd3);
  $('t3Save').addEventListener('click', saveAdd3);
  $('mask3').addEventListener('click', function (e) { if (e.target === $('mask3')) { closeAdd3(); } });

  $('btnReset').addEventListener('click', function (e) {
    e.preventDefault();
    if (!window.confirm('清空本机改动，恢复为 2026-11-18 的快照数据？')) { return; }
    try { localStorage.removeItem(LOCAL_KEY); } catch (err) { /* 忽略 */ }
    loadData();
    toast('已恢复为快照');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') { return; }
    if (!$('mask').hidden) { closeDialog(); }
    if (!$('mask2').hidden) { closeAdd(); }
    if (!$('mask3').hidden) { closeAdd3(); }
  });

  if (db && typeof db.onUpdated === 'function') {
    var timer = null;
    db.onUpdated(function (payload) {
      var ids = (payload && payload.databaseIds) || [];
      if (ids.indexOf(DATABASE_ID) === -1) { return; }
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () { loadData(); }, 400);
    });
  }

  renderSkeleton();
  loadData();
})();
