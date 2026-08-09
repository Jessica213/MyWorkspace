/* ============================================================
 * 成长工作台 · 云端同步引擎（Supabase）
 * ------------------------------------------------------------
 * 设计原则（不改变原有 UI / 功能 / 数据结构）：
 *  1. localStorage 仍是应用的数据源与本地缓存（离线优先）
 *  2. 登录后，云端（Supabase）成为持久层，按数据键（wb_growth_*）一行一条
 *  3. 每次写入：先落本地 → 标记脏 → 防抖推送云端
 *  4. 跨设备：Realtime + 定时轮询 + 上线/回到前台触发拉取
 *  5. 冲突策略：按键"最后提交者获胜"，本地未推送的编辑优先（不丢数据）
 *  6. 首次登录提供 localStorage → 云端迁移/合并向导
 * ============================================================ */
(function () {
  'use strict';

  var SYNC_KEYS = [
    'wb_growth_tasks', 'wb_growth_habits', 'wb_growth_habitRecords', 'wb_growth_studySubject',
    'wb_growth_media', 'wb_growth_happy', 'wb_growth_countdown', 'wb_growth_wisdomIndex',
    'wb_growth_currentGrowth', 'wb_growth_currentStudy', 'wb_growth_studyRecords',
    'wb_growth_dailyPointers', 'wb_growth_initialized'
  ];
  // 合并模式下的智能合并分组
  // ARRAY_KEYS：列表型数据（按 id 去重合并，两端都保留）
  var ARRAY_KEYS = ['wb_growth_tasks', 'wb_growth_habits', 'wb_growth_studySubject', 'wb_growth_media', 'wb_growth_happy'];
  // RECORD_KEYS：记录型数据（按记录 key 合并，本机优先）
  var RECORD_KEYS = ['wb_growth_habitRecords', 'wb_growth_studyRecords', 'wb_growth_dailyPointers'];
  var META_KEY = 'wb_growth_sync_meta';
  var CONFIG_KEY = 'wb_growth_supabase_config';
  var MIGRATED_KEY = 'wb_growth_sync_migrated';

  var ls = {
    get: function (k, f) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } },
    getRaw: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    setRaw: function (k, s) { try { localStorage.setItem(k, s); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  var config = ls.get(CONFIG_KEY, null);
  var supabase = null;
  var session = null;
  var meta = ls.get(META_KEY, {});
  var authMode = 'login';
  var syncing = false;
  var lastSyncAt = null;
  var lastError = null;
  var realtime = null;
  var pollTimer = null;
  var flushTimer = null;
  var modalOpen = false;
  var migrateIntro = '';

  // ---------- 基础工具 ----------
  function toast(msg) { try { if (window.showToast) window.showToast(msg); } catch (e) {} }
  function nowIso() { return new Date().toISOString(); }
  function isOnline() { return !window.navigator || navigator.onLine !== false; }
  function hasClient() { return window.supabase && typeof window.supabase.createClient === 'function'; }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function getUserId() { return session && session.user ? session.user.id : null; }

  function effectiveConfig() {
    var wc = (window.APP_CONFIG && window.APP_CONFIG.supabaseUrl && window.APP_CONFIG.anonKey)
      ? { url: window.APP_CONFIG.supabaseUrl, anonKey: window.APP_CONFIG.anonKey } : null;
    return wc || config;
  }
  function countPending() {
    var n = 0;
    SYNC_KEYS.forEach(function (k) { var m = meta[k]; if (m && (m.d === 'dirty' || m.d === 'deleted')) n++; });
    return n;
  }
  function isConfigured() { return !!effectiveConfig(); }

  function initClient() {
    var c = effectiveConfig();
    if (c && hasClient()) {
      try {
        supabase = window.supabase.createClient(c.url, c.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        return true;
      } catch (e) { supabase = null; return false; }
    }
    supabase = null;
    return false;
  }

  // ---------- 状态 / UI ----------
  function stateOf() {
    if (!isConfigured()) return 'noconfig';
    if (!session) return 'loggedout';
    if (!isOnline()) return 'offline';
    if (syncing) return 'busy';
    if (lastError) return 'err';
    return 'ok';
  }
  function updateStatusUI() {
    var st = stateOf();
    var dot = document.getElementById('syncDot');
    var txt = document.getElementById('syncBtnText');
    var map = { noconfig: '', loggedout: '', offline: 'off', busy: 'busy', err: 'err', ok: 'ok' };
    if (dot) dot.className = 'sync-dot' + (map[st] ? ' ' + map[st] : '');
    var label = { noconfig: '云同步', loggedout: '登录云同步', offline: '离线·待同步', busy: '同步中', err: '同步异常', ok: '已同步' }[st];
    var pending = countPending();
    if (st === 'offline' && pending) label = '离线·待同步 ' + pending;
    if (txt) txt.textContent = label;

    var stText = document.getElementById('syncStatusText');
    if (stText) stText.textContent = statusDetail();
    var acc = document.getElementById('syncAccStatus');
    if (acc) acc.textContent = statusDetail();
    var accDot = document.getElementById('syncAccDot');
    if (accDot) accDot.className = 'sync-dot' + (map[st] ? ' ' + map[st] : '');
  }
  function statusDetail() {
    var st = stateOf();
    var parts = [];
    if (st === 'offline') parts.push('当前离线');
    var p = countPending();
    if (p) parts.push('待同步 ' + p + ' 项');
    if (lastError) parts.push('上次同步失败');
    if (lastSyncAt) {
      var sec = Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 1000);
      var ago = sec < 60 ? '刚刚' : (sec < 3600 ? Math.floor(sec / 60) + ' 分钟前' : Math.floor(sec / 3600) + ' 小时前');
      parts.push('最近同步 ' + ago);
    }
    if (!isConfigured()) return '未连接 Supabase，仅本机模式';
    if (!session) return '未登录，登录后开启跨设备同步';
    return parts.length ? parts.join(' · ') : '一切同步正常';
  }

  // ---------- 同步核心 ----------
  function markDirty(key) {
    if (SYNC_KEYS.indexOf(key) === -1) return;
    var m = meta[key] || {};
    m.d = 'dirty';
    meta[key] = m;
    ls.set(META_KEY, meta);
    scheduleFlush();
    updateStatusUI();
  }
  function onLocalClear() {
    SYNC_KEYS.forEach(function (k) {
      meta[k] = { d: 'deleted', v: null };
    });
    ls.set(META_KEY, meta);
    scheduleFlush();
    updateStatusUI();
  }
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flushTimer = null; flushPending(); }, 1200);
  }

  function flushPending() {
    if (!supabase || !session || syncing) return;
    if (!isOnline()) { updateStatusUI(); return; }
    var uid = getUserId();
    if (!uid) return;

    var upserts = [], deletes = [];
    SYNC_KEYS.forEach(function (k) {
      var m = meta[k];
      var st = m && m.d;
      if (st === 'dirty') {
        var raw = ls.getRaw(k);
        if (raw !== null) {
          var val; try { val = JSON.parse(raw); } catch (e) { val = raw; }
          upserts.push({ user_id: uid, key: k, value: val, updated_at: nowIso() });
        } else {
          deletes.push(k);
          meta[k] = { d: 'deleted', v: null };
        }
      } else if (st === 'deleted') {
        deletes.push(k);
      }
    });
    ls.set(META_KEY, meta);
    if (!upserts.length && !deletes.length) { updateStatusUI(); return; }

    syncing = true; updateStatusUI();
    var jobs = [];
    if (upserts.length) {
      jobs.push(supabase.from('sync_items').upsert(upserts, { onConflict: 'user_id,key' }).select('key,updated_at'));
    }
    if (deletes.length) {
      jobs.push(supabase.from('sync_items').delete().eq('user_id', uid).in('key', deletes));
    }
    Promise.all(jobs)
      .then(function (resAll) {
        resAll.forEach(function (r) {
          if (r && r.data && Array.isArray(r.data)) {
            r.data.forEach(function (row) { if (row && row.key) meta[row.key] = { v: row.updated_at, d: 'clean', noAuto: false }; });
          }
        });
        deletes.forEach(function (k) { meta[k] = { d: 'clean', v: null, noAuto: false }; });
        ls.set(META_KEY, meta);
        lastSyncAt = nowIso();
        lastError = null;
        syncing = false;
        updateStatusUI();
      })
      .catch(function (err) {
        lastError = err && (err.message || String(err));
        syncing = false;
        updateStatusUI();
      });
  }

  function applyRemoteKey(k, value, updatedAt) {
    ls.setRaw(k, JSON.stringify(value));
    meta[k] = { v: updatedAt, d: 'clean', noAuto: false };
  }

  // 智能合并：把云端值与本机值按类型合并不丢数据
  // 返回合并后的值（并同步写回本机 localStorage）
  function smartMergeValue(k, lv, sv) {
    if (ARRAY_KEYS.indexOf(k) !== -1) {
      // 列表型：按 id 去重，本机在前、云端在后
      if (Array.isArray(lv) && Array.isArray(sv)) {
        var map = {};
        var out = [];
        function pick(it) {
          var id = (it && it.id != null) ? String(it.id) : JSON.stringify(it);
          if (map[id]) return;
          map[id] = 1;
          out.push(it);
        }
        lv.forEach(pick);
        sv.forEach(pick);
        return out;
      }
      return lv;
    }
    if (RECORD_KEYS.indexOf(k) !== -1) {
      // 记录型：按记录 key 合并，本机优先
      if (lv && typeof lv === 'object' && !Array.isArray(lv) && sv && typeof sv === 'object' && !Array.isArray(sv)) {
        var merged = {};
        Object.keys(sv).forEach(function (mk) { merged[mk] = sv[mk]; });
        Object.keys(lv).forEach(function (mk) { merged[mk] = lv[mk]; });
        return merged;
      }
      return lv;
    }
    // 其他配置类键：以本机为准
    return lv;
  }

  function pullAll() {
    if (!supabase || !session || syncing) return Promise.resolve(null);
    if (!isOnline()) { updateStatusUI(); return Promise.resolve(null); }
    var uid = getUserId();
    if (!uid) return Promise.resolve(null);

    syncing = true; updateStatusUI();
    return supabase.from('sync_items').select('key,value,updated_at').eq('user_id', uid)
      .then(function (res) {
        if (res.error) throw res.error;
        var server = {};
        (res.data || []).forEach(function (r) { server[r.key] = { value: r.value, updated_at: r.updated_at }; });

        var toPush = [], toDelete = [], changed = false;
        SYNC_KEYS.forEach(function (k) {
          var m = meta[k];
          var st = m && m.d;
          var sr = server[k];
          var raw = ls.getRaw(k);
          var localExists = raw !== null;
          if (st === 'deleted') { if (sr) toDelete.push(k); return; }
          if (st === 'dirty') { if (localExists) toPush.push(k); return; }
          if (sr) {
            var lastV = m && m.v;
            if (!lastV || sr.updated_at > lastV) {
              applyRemoteKey(k, sr.value, sr.updated_at);
              changed = true;
            } else {
              meta[k] = { v: lastV, d: 'clean', noAuto: !!(m && m.noAuto) };
            }
          } else {
            if (localExists && !(m && m.noAuto)) toPush.push(k);
          }
        });
        // 服务端有、本机没有的键 → 下载（本机唯一来源在服务端）
        Object.keys(server).forEach(function (k) {
          if (SYNC_KEYS.indexOf(k) === -1) return;
          var m = meta[k];
          if (m && (m.d === 'dirty' || m.d === 'deleted')) return;
          if (ls.getRaw(k) === null) {
            applyRemoteKey(k, server[k].value, server[k].updated_at);
            changed = true;
          }
        });
        ls.set(META_KEY, meta);
        if (changed) {
          syncGlobals();
          if (window.renderAll) { try { window.renderAll(); } catch (e) {} }
        }

        var jobs = [];
        if (toPush.length) {
          var ups = toPush.map(function (k) {
            var raw = ls.getRaw(k);
            var val; try { val = JSON.parse(raw); } catch (e) { val = raw; }
            return { user_id: uid, key: k, value: val, updated_at: nowIso() };
          });
          jobs.push(supabase.from('sync_items').upsert(ups, { onConflict: 'user_id,key' }).select('key,updated_at'));
        }
        if (toDelete.length) {
          jobs.push(supabase.from('sync_items').delete().eq('user_id', uid).in('key', toDelete));
        }
        if (jobs.length) {
          return Promise.all(jobs).then(function (resAll) {
            resAll.forEach(function (r) {
              if (r && r.data && Array.isArray(r.data)) {
                r.data.forEach(function (row) { if (row && row.key) meta[row.key] = { v: row.updated_at, d: 'clean', noAuto: false }; });
              }
            });
            ls.set(META_KEY, meta);
            lastSyncAt = nowIso();
            lastError = null;
            return true;
          });
        }
        lastSyncAt = nowIso();
        lastError = null;
        return true;
      })
      .then(function () { syncing = false; updateStatusUI(); return true; })
      .catch(function (err) {
        lastError = err && (err.message || String(err));
        syncing = false;
        updateStatusUI();
        return null;
      });
  }

  function syncGlobals() {
    try {
      if (typeof currentGrowth !== 'undefined') {
        var cg = ls.get('wb_growth_currentGrowth', 'body');
        if (cg && window.currentGrowth !== cg) window.currentGrowth = cg;
      }
      if (typeof currentStudy !== 'undefined') {
        var cs = ls.get('wb_growth_currentStudy', 'xingce');
        if (cs && window.currentStudy !== cs) window.currentStudy = cs;
      }
    } catch (e) {}
  }

  function doSync() {
    if (!supabase || !session) return Promise.resolve();
    return pullAll().then(function () { flushPending(); });
  }

  // ---------- Realtime / 轮询 / 事件 ----------
  function setupRealtime() {
    if (!supabase || !session) return;
    var uid = getUserId();
    if (!uid) return;
    if (realtime) { try { supabase.removeChannel(realtime); } catch (e) {} realtime = null; }
    realtime = supabase.channel('sync_' + uid)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'sync_items', filter: 'user_id=eq.' + uid },
        function () { if (session && isOnline()) debouncedPull(); })
      .subscribe();
  }
  var debouncedPull = debounce(function () { if (session && isOnline()) pullAll(); }, 600);
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () { if (session && isOnline()) pullAll(); }, 30000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ---------- 迁移 / 合并 ----------
  var SAMPLE = {
    tasks: ['整理本周工作周报', '完成试用期考核材料初稿', '参加部门例会', '回复公文流转单', '行测资料分析练习 50 题'],
    media: ['觉醒年代', '人生第二次'],
    happy: ['午休时在窗边晒了十分钟太阳，特别舒服。', '今天同事夸我材料写得好，开心了一下午。']
  };
  function valueLooksReal(k, val) {
    if (val === null || val === undefined) return false;
    if (k === 'wb_growth_tasks') { return Array.isArray(val) && val.length > 0 && val.some(function (t) { return SAMPLE.tasks.indexOf(t && t.text) === -1; }); }
    if (k === 'wb_growth_media') { return Array.isArray(val) && val.length > 0 && val.some(function (m) { return SAMPLE.media.indexOf(m && m.title) === -1; }); }
    if (k === 'wb_growth_happy') { return Array.isArray(val) && val.length > 0 && val.some(function (h) { return SAMPLE.happy.indexOf(h && h.text) === -1; }); }
    if (k === 'wb_growth_habitRecords') { return val && typeof val === 'object' && Object.keys(val).length > 0; }
    if (k === 'wb_growth_studyRecords') { return val && typeof val === 'object' && Object.keys(val).length > 0; }
    return false; // 配置/标量类键不参与"是否真实数据"判定
  }
  function hasRealLocalData() {
    for (var i = 0; i < SYNC_KEYS.length; i++) {
      var k = SYNC_KEYS[i], raw = ls.getRaw(k);
      if (raw !== null) {
        var v; try { v = JSON.parse(raw); } catch (e) { v = null; }
        if (valueLooksReal(k, v)) return true;
      }
    }
    return false;
  }
  function markMigrated() { ls.set(MIGRATED_KEY, true); }

  function markMigratedAndSync(msg) {
    markMigrated();
    setupRealtime();
    startPolling();
    if (msg) toast(msg);
    doSync();
    renderSyncView();
    updateStatusUI();
  }

  function prepareMigration() {
    var uid = getUserId();
    if (!supabase || !uid) { markMigratedAndSync(); return; }
    supabase.from('sync_items').select('key').eq('user_id', uid)
      .then(function (res) {
        if (res.error) { toast('查询云端数据失败，稍后在「云同步」中重试'); return; }
        var serverHasData = (res.data || []).length > 0;
        var localReal = hasRealLocalData();
        if (!serverHasData && !localReal) { markMigratedAndSync(); return; }
        if (!serverHasData && localReal) { toast('首次登录：正在把本机数据上传到云端...'); doMigrate('upload'); return; }
        if (serverHasData && !localReal) { toast('首次登录：正在从云端恢复数据...'); doMigrate('download'); return; }
        migrateIntro = '云端和本机都检测到你的真实数据。请选择合并方式，避免互相覆盖：';
        showMigrateModal('merge');
      })
      .catch(function () { toast('查询云端数据失败，请检查网络'); });
  }

  function doMigrate(mode) {
    closeMigrateModal();
    if (!supabase || !session) { toast('请先登录'); return; }
    var uid = getUserId();
    if (!uid) { toast('请先登录'); return; }
    toast('正在同步...');
    supabase.from('sync_items').select('key,value,updated_at').eq('user_id', uid)
      .then(function (res) {
        if (res.error) { toast('同步失败：' + (res.error.message || '')); return; }
        var server = {};
        (res.data || []).forEach(function (r) { server[r.key] = { value: r.value, updated_at: r.updated_at }; });

        if (mode === 'upload') {
          var rows = [];
          SYNC_KEYS.forEach(function (k) {
            var raw = ls.getRaw(k);
            if (raw !== null) {
              var v; try { v = JSON.parse(raw); } catch (e) { v = raw; }
              rows.push({ user_id: uid, key: k, value: v, updated_at: nowIso() });
            }
          });
          if (rows.length) {
            supabase.from('sync_items').upsert(rows, { onConflict: 'user_id,key' }).select('key,updated_at')
              .then(function (u) {
                if (u.error) { toast('上传失败：' + (u.error.message || '')); return; }
                (u.data || []).forEach(function (row) { if (row && row.key) meta[row.key] = { v: row.updated_at, d: 'clean', noAuto: false }; });
                ls.set(META_KEY, meta);
                markMigratedAndSync('本机数据已上传到云端');
              }).catch(function () { toast('上传失败，请检查网络'); });
          } else { markMigratedAndSync(); }
        } else if (mode === 'download') {
          Object.keys(server).forEach(function (k) {
            if (SYNC_KEYS.indexOf(k) === -1) return;
            applyRemoteKey(k, server[k].value, server[k].updated_at);
          });
          var uploadRows = [];
          SYNC_KEYS.forEach(function (k) {
            if (server[k]) return;
            var raw = ls.getRaw(k);
            if (raw !== null) {
              var v; try { v = JSON.parse(raw); } catch (e) { v = raw; }
              if (valueLooksReal(k, v)) {
                uploadRows.push({ user_id: uid, key: k, value: v, updated_at: nowIso() });
              } else {
                meta[k] = { d: 'clean', v: null, noAuto: true };
              }
            }
          });
          ls.set(META_KEY, meta);
          var finish = function () { markMigratedAndSync('已从云端恢复数据'); };
          if (uploadRows.length) {
            supabase.from('sync_items').upsert(uploadRows, { onConflict: 'user_id,key' }).select('key,updated_at')
              .then(function (u) {
                if (!u.error) (u.data || []).forEach(function (row) { if (row && row.key) meta[row.key] = { v: row.updated_at, d: 'clean', noAuto: false }; });
                ls.set(META_KEY, meta); finish();
              }).catch(finish);
          } else { finish(); }
        } else { // merge
          var mergeUpload = [];
          SYNC_KEYS.forEach(function (k) {
            var raw = ls.getRaw(k);
            var lv = null; if (raw !== null) { try { lv = JSON.parse(raw); } catch (e) { lv = raw; } }
            var sr = server[k];
            var localReal = lv !== null && valueLooksReal(k, lv);
            if (sr) {
              if (localReal) {
                var mv = smartMergeValue(k, lv, sr.value);
                // 合并结果同步写回本机，避免本地看不到云端内容
                ls.setRaw(k, JSON.stringify(mv));
                meta[k] = { d: 'clean', v: null, noAuto: false };
                mergeUpload.push({ user_id: uid, key: k, value: mv, updated_at: nowIso() });
              } else {
                applyRemoteKey(k, sr.value, sr.updated_at);
              }
            } else {
              if (localReal) {
                mergeUpload.push({ user_id: uid, key: k, value: lv, updated_at: nowIso() });
              } else {
                meta[k] = { d: 'clean', v: null, noAuto: true };
              }
            }
          });
          ls.set(META_KEY, meta);
          var finish2 = function () { markMigratedAndSync('合并完成'); };
          if (mergeUpload.length) {
            supabase.from('sync_items').upsert(mergeUpload, { onConflict: 'user_id,key' }).select('key,updated_at')
              .then(function (u) {
                if (!u.error) (u.data || []).forEach(function (row) { if (row && row.key) meta[row.key] = { v: row.updated_at, d: 'clean', noAuto: false }; });
                ls.set(META_KEY, meta); finish2();
              }).catch(finish2);
          } else { finish2(); }
        }
      })
      .catch(function () { toast('同步失败，请检查网络'); });
  }

  // ---------- 弹窗 UI ----------
  function open() {
    modalOpen = true;
    document.getElementById('syncModal').classList.add('active');
    renderSyncView();
  }
  function close() {
    document.getElementById('syncModal').classList.remove('active');
    modalOpen = false;
  }
  function renderSyncView() {
    var cfg = isConfigured();
    var v = !cfg ? 'config' : (!session ? 'login' : 'account');
    ['config', 'login', 'account'].forEach(function (x) {
      var el = document.getElementById('syncView' + x.charAt(0).toUpperCase() + x.slice(1));
      if (el) el.style.display = (x === v) ? '' : 'none';
    });
    if (v === 'config') {
      var c = effectiveConfig();
      document.getElementById('syncUrlInput').value = c ? c.url : '';
      document.getElementById('syncKeyInput').value = c ? c.anonKey : '';
    } else if (v === 'login') {
      renderAuthMode();
    } else if (v === 'account') {
      var email = (session.user && session.user.email) || '';
      document.getElementById('syncEmailText').textContent = email;
      document.getElementById('syncAvatar').textContent = (email || 'U').charAt(0).toUpperCase();
      updateStatusUI();
    }
  }
  function renderAuthMode() {
    var loginTab = document.getElementById('syncAuthTabLogin');
    var signupTab = document.getElementById('syncAuthTabSignup');
    var btn = document.getElementById('syncAuthBtn');
    var hint = document.getElementById('syncAuthHint');
    if (loginTab) loginTab.style.borderColor = authMode === 'login' ? 'var(--c-primary)' : '';
    if (loginTab) loginTab.style.background = authMode === 'login' ? 'var(--c-primary-50)' : '';
    if (signupTab) signupTab.style.borderColor = authMode === 'signup' ? 'var(--c-primary)' : '';
    if (signupTab) signupTab.style.background = authMode === 'signup' ? 'var(--c-primary-50)' : '';
    if (btn) btn.textContent = authMode === 'signup' ? '注册并登录' : '登录';
    if (hint) hint.textContent = authMode === 'signup'
      ? '注册后将自动登录。若开启了邮箱确认，请先到邮箱确认。'
      : '同一账号在手机和电脑登录后，数据自动跨设备同步。';
  }

  function saveConfig() {
    var url = document.getElementById('syncUrlInput').value.trim();
    var key = document.getElementById('syncKeyInput').value.trim();
    if (!url || !key) { toast('请填写 Supabase URL 和 anon 公钥'); return; }
    if (!/^https?:\/\//.test(url)) { toast('URL 需以 http(s):// 开头'); return; }
    config = { url: url, anonKey: key };
    ls.set(CONFIG_KEY, config);
    if (!initClient()) { toast('云同步依赖未加载，请刷新页面后重试'); }
    session = null;
    renderSyncView();
    updateStatusUI();
    toast('已保存连接信息');
  }
  function cancelConnect() { close(); }
  function editConfig() { renderSyncView(); }
  function setAuthMode(m) {
    authMode = m;
    renderAuthMode();
  }
  function submitAuth() {
    var email = document.getElementById('syncEmailInput').value.trim();
    var pass = document.getElementById('syncPasswordInput').value;
    if (!email || !pass) { toast('请填写邮箱和密码'); return; }
    if (!supabase) { toast('云同步依赖未加载，请检查网络'); return; }
    var btn = document.getElementById('syncAuthBtn');
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = '请稍候...';
    var p = authMode === 'signup'
      ? supabase.auth.signUp({ email: email, password: pass })
      : supabase.auth.signInWithPassword({ email: email, password: pass });
    p.then(function (res) {
      btn.disabled = false; btn.textContent = old;
      if (res.error) { toast(res.error.message || '操作失败'); return; }
      if (authMode === 'signup') {
        if (res.data && res.data.session) {
          onLoggedIn(res.data.session);
        } else {
          toast('注册成功，请到邮箱点击确认链接后再登录');
          document.getElementById('syncAuthHint').textContent = '注册成功！请到邮箱完成确认，再点「登录」。';
        }
        return;
      }
      if (res.data && res.data.session) onLoggedIn(res.data.session);
      else toast('登录失败，请重试');
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = old;
      toast((e && e.message) || '网络错误，请重试');
    });
  }
  function onLoggedIn(sess) {
    session = sess;
    updateStatusUI();
    var migrated = ls.get(MIGRATED_KEY, false);
    if (migrated) {
      close();
      toast('登录成功，开始同步');
      setupRealtime();
      startPolling();
      doSync();
    } else {
      prepareMigration();
      close();
    }
  }
  function logout() {
    if (!supabase) { session = null; updateStatusUI(); renderSyncView(); return; }
    supabase.auth.signOut().then(function () {
      session = null;
      try { if (realtime) supabase.removeChannel(realtime); } catch (e) {}
      realtime = null;
      stopPolling();
      ls.del(MIGRATED_KEY);
      ls.del(META_KEY);
      meta = {};
      toast('已退出登录（本机数据仍保留）');
      renderSyncView();
      updateStatusUI();
    }).catch(function () { toast('退出失败，请重试'); });
  }
  function manualSync() {
    if (!session) { toast('请先登录'); renderSyncView(); return; }
    if (!isOnline()) { toast('当前离线，联网后会自动同步'); return; }
    toast('正在同步...');
    doSync().then(function () { updateStatusUI(); });
  }
  function openMigration() {
    migrateIntro = '手动迁移 / 合并：云端与本机数据合并，本机数据不会丢失。';
    showMigrateModal('merge');
  }
  function showMigrateModal(reco) {
    document.getElementById('migrateIntro').textContent = migrateIntro || '请选择数据合并方式：';
    ['upload', 'download', 'merge'].forEach(function (m) {
      var el = document.getElementById('migrateOpt' + m.charAt(0).toUpperCase() + m.slice(1));
      if (el) el.classList.toggle('reco', m === reco);
    });
    document.getElementById('migrateModal').classList.add('active');
  }
  function closeMigrateModal() { document.getElementById('migrateModal').classList.remove('active'); }

  function createBackup() {
    var uid = getUserId();
    if (!supabase || !uid) { toast('请先登录'); return; }
    var payload = {};
    SYNC_KEYS.forEach(function (k) {
      var raw = ls.getRaw(k);
      if (raw !== null) { try { payload[k] = JSON.parse(raw); } catch (e) { payload[k] = raw; } }
    });
    supabase.from('sync_backups').insert({
      user_id: uid,
      label: '手动备份 ' + new Date().toLocaleString('zh-CN'),
      payload: payload
    }).then(function (res) {
      if (res.error) { toast('备份失败：' + (res.error.message || '')); return; }
      toast('云端备份已创建');
    }).catch(function () { toast('备份失败，请检查网络'); });
  }

  // ---------- 初始化 ----------
  function init() {
    if (effectiveConfig()) initClient();
    if (supabase) {
      supabase.auth.getSession().then(function (res) {
        if (res && res.data && res.data.session) {
          session = res.data.session;
          if (ls.get(MIGRATED_KEY, false)) {
            setupRealtime();
            startPolling();
            doSync();
          } else {
            prepareMigration();
          }
        } else {
          session = null;
        }
        updateStatusUI();
      });
      supabase.auth.onAuthStateChange(function (event, sess) {
        session = sess || null;
        if (event === 'SIGNED_OUT') {
          session = null;
          try { if (realtime) supabase.removeChannel(realtime); } catch (e) {}
          realtime = null;
          stopPolling();
          updateStatusUI();
        } else if (sess) {
          updateStatusUI();
        }
      });
    }
    window.addEventListener('online', function () { if (session) doSync(); else updateStatusUI(); });
    window.addEventListener('offline', function () { updateStatusUI(); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && session && supabase && isOnline()) doSync();
    });
    updateStatusUI();
    maybeFirstRunHint();
  }
  function maybeFirstRunHint() {
    try {
      if (!isConfigured() && !localStorage.getItem('wb_growth_sync_hint_shown')) {
        localStorage.setItem('wb_growth_sync_hint_shown', '1');
        setTimeout(function () { toast('右上角可开启「云同步」，实现手机电脑跨设备同步'); }, 1800);
      }
    } catch (e) {}
  }

  // 暴露给外部（含主脚本 save() 钩子）
  window.__sync = {
    open: open,
    close: close,
    cancelConnect: cancelConnect,
    saveConfig: saveConfig,
    editConfig: editConfig,
    setAuthMode: setAuthMode,
    submitAuth: submitAuth,
    logout: logout,
    manualSync: manualSync,
    openMigration: openMigration,
    doMigrate: doMigrate,
    createBackup: createBackup,
    markDirty: markDirty,
    onLocalClear: onLocalClear
  };
  window.closeMigrateModal = closeMigrateModal;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
