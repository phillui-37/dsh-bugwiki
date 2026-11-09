/* Browser entry: loaded directly by DSH's Cordis module loader. */
window.__ModuleLoader__.load({
  id: 'dsh-bugwiki',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    function SettingsForm({ labels, state, onSave, onDiscard, children }) {
      if (!state.available) return h('p', null, labels.unavailable);
      return h('form', { onSubmit: event => { event.preventDefault(); onSave(); } },
        children,
        state.failed && h('p', { role: 'alert' }, labels.saveFailed),
        h('button', { type: 'submit', disabled: !state.dirty || state.invalid || state.saving }, state.saving ? labels.saving : labels.save),
        state.dirty && h('button', { type: 'button', onClick: onDiscard }, 'Discard'));
    }
    function SettingsValueField({ id, label, text, overridden, invalid, overriddenLabel, resetLabel, invalidLabel, disabled, numeric, onEdit, onReset }) {
      return h('div', null,
        h('label', { htmlFor: id }, label),
        h('input', { id, type: numeric ? 'number' : 'text', value: text, disabled, 'aria-invalid': invalid || undefined, onChange: event => onEdit(event.target.value) }),
        overridden && h('span', null, ` ${overriddenLabel}`),
        overridden && h('button', { type: 'button', disabled, onClick: onReset }, resetLabel),
        invalid && h('p', { role: 'alert' }, invalidLabel));
    }
    const fields = [
      ['wikiHome', 'Wiki directory', 'Wiki 目錄'],
      ['bashExecutable', 'Bash executable', 'Bash 執行檔'],
      ['pythonExecutable', 'Python executable', 'Python 執行檔'],
      ['pathPrefix', 'Executable search path prefix', '執行檔搜尋路徑前綴'],
      ['timeoutMs', 'Command timeout (ms)', '指令逾時（毫秒）', 1, 120000],
      ['maxOutputBytes', 'Maximum output bytes', '輸出位元組上限', 1, 1000000],
      ['maxInputBytes', 'Maximum input bytes', '輸入位元組上限', 1, 67108864],
      ['staleDays', 'Stale after days', '過期天數', 1],
      ['archiveDays', 'Archive after days', '封存天數', 1],
      ['lessonsMax', 'Maximum lessons', '經驗條目上限', 1],
      ['duplicateJaccard', 'Duplicate similarity threshold (%)', '重複相似度門檻（%）', 1, 100],
      ['duplicateMinPages', 'Minimum pages for duplicate checks', '重複檢查最少頁數', 1],
      ['reportsKeep', 'Reports to keep', '保留報告數', 1],
      ['factStaleDays', 'Fact stale after days', '事實過期天數', 1],
      ['promotedStaleDays', 'Promoted fact stale after days', '已提升事實過期天數', 1],
      ['prefix', 'Prompt prefix', '提示詞前綴'],
      ['suffix', 'Prompt suffix', '提示詞後綴'],
    ];
    const en = { description: 'Configure the Bugwiki memory graph, command limits and retention.', unavailable: 'Settings are unavailable.', readOnly: 'Settings are read-only.', saveFailed: 'Could not save. Reloaded settings may have changed; review and try again.', save: 'Save', saving: 'Saving…', overridden: 'Overridden', reset: 'Reset', invalid: 'Enter a valid value.' };
    const zh = { description: '設定 Bugwiki 記憶圖譜、指令限制與保留期限。', unavailable: '設定目前無法使用。', readOnly: '設定目前為唯讀。', saveFailed: '無法儲存。設定可能已變更，請檢查後重試。', save: '儲存', saving: '儲存中…', overridden: '已覆寫', reset: '重設', invalid: '請輸入有效值。' };
    for (const [key, english, chinese] of fields) { en[key] = english; zh[key] = chinese; }

    function Panel({ view, form, t }) {
      const [draft, setDraft] = React.useState({});
      const [saving, setSaving] = React.useState(false);
      const [failed, setFailed] = React.useState(false);
      const fence = React.useRef(undefined);
      const state = form?.state;
      const value = state?.value || {};
      const dirty = Object.keys(draft).length > 0;
      const available = state?.status === 'ready';
      const writable = Boolean(state?.writable);
      function edit(key, text) {
        if (!dirty) fence.current = state?.revision;
        setDraft(previous => ({ ...previous, [key]: { op: 'set', text } }));
        setFailed(false);
      }
      function reset(key) {
        if (!dirty) fence.current = state?.revision;
        setDraft(previous => ({ ...previous, [key]: { op: 'unset' } }));
        setFailed(false);
      }
      function parse(field, text) {
        if (field[3] === undefined) return text;
        if (!text.trim()) return undefined;
        const number = Number(text);
        return Number.isInteger(number) && number >= field[3] && (field[4] === undefined || number <= field[4]) ? number : undefined;
      }
      const invalid = fields.some(field => draft[field[0]]?.op === 'set' && parse(field, draft[field[0]].text) === undefined);
      function discard() { setDraft({}); setFailed(false); fence.current = undefined; }
      async function save() {
        if (!form || !writable || invalid || saving || !dirty) return;
        const ops = fields.filter(field => draft[field[0]]).map(field => {
          const key = field[0];
          return draft[key].op === 'unset' ? { op: 'unset', path: [key] } : { op: 'set', path: [key], value: parse(field, draft[key].text) };
        });
        setSaving(true);
        try { if (await form.mutate(ops, fence.current)) discard(); else setFailed(true); }
        catch { setFailed(true); }
        finally { setSaving(false); }
      }
      if (view === 'summary') return t('description');
      return h(SettingsForm, {
        labels: { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') },
        state: { available, writable, dirty, invalid: invalid || !writable, saving, failed }, onSave: save, onDiscard: discard,
      }, fields.map(field => {
        const key = field[0];
        const change = draft[key];
        const resolved = change?.op === 'unset' ? state?.base?.[key] : value[key];
        const text = change?.op === 'set' ? change.text : String(resolved ?? '');
        return h(SettingsValueField, { key, id: `dsh-bugwiki-${key}`, label: t(key), text,
          overridden: change ? change.op === 'set' : Object.prototype.hasOwnProperty.call(state?.user || {}, key),
          invalid: change?.op === 'set' && parse(field, text) === undefined,
          overriddenLabel: t('overridden'), resetLabel: t('reset'), invalidLabel: t('invalid'),
          disabled: !writable || saving, numeric: field[3] !== undefined,
          onEdit: text => edit(key, text), onReset: () => reset(key),
        });
      }));
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const namespace = 'dsh-bugwiki-settings';
        const t = ctx.locale.bind(namespace);
        ctx.effect(() => ctx.locale.register(namespace, { en, zh }), 'dsh-bugwiki: settings dictionaries');
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config', key: ['dsh-bugwiki', 'dsh-bugwiki'].join('#'), inject: () => ({ t }),
        }, Panel));
      },
    };
  },
});
