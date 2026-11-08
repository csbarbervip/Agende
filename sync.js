// sync.js (versão 2) - horários bloqueados + agendamentos compartilhados (Supabase)
// Carregue DEPOIS do script principal do index.html.

const SB_URL = 'https://aykqgrmllckigcmophre.supabase.co'; // Project URL
const SB_KEY = 'sb_publishable_LLMA-Yx9ZKdlAe0xEcEyng_c-yyhP0a'; // chave publishable
const SB_H = {
  apikey: SB_KEY,
  'Content-Type': 'application/json'
};
// a chave antiga (eyJ...) também vai no Authorization; a nova (sb_publishable_...) só no apikey
if (SB_KEY.startsWith('eyJ')) SB_H.Authorization = 'Bearer ' + SB_KEY;
const call = (fn, body) =>
  fetch(SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: SB_H,
    body: JSON.stringify(body || {})
  });

// ---------- PIN do administrador (o mesmo definido no Supabase) ----------
let askedPin = false;
function getPin(force) {
  let pin = localStorage.getItem('cs_srvpin');
  if (!pin && (force || !askedPin)) {
    askedPin = true;
    pin = prompt('PIN do administrador (o mesmo que você definiu no Supabase):');
  }
  return pin || null;
}
function pinErrado() {
  localStorage.removeItem('cs_srvpin');
  askedPin = false;
  alert('PIN do administrador incorreto.');
}

// ---------- conversão servidor -> formato do app ----------
const toApp = r => ({
  id: Number(r.id), date: r.day, time: r.slot, svc: r.svc, svcId: r.svc_id,
  cut: r.cut, price: Number(r.price), dur: r.dur, name: r.name, wa: r.wa,
  free: r.free, status: r.status
});

// só redesenha quando a tela mostra dados (não apaga formulários)
const telaComDados = () =>
  (S.tab === 'book' && S.step === 'time') || S.tab === 'pts' ||
  (S.tab === 'adm' && (S.at === 'bloq' || S.at === 'hoje'));

// ---------- carregar bloqueios ----------
async function loadBlocked() {
  try {
    const r = await fetch(
      SB_URL + '/rest/v1/blocked_slots?select=day,slot&order=day,slot&day=gte.' + iso(new Date()),
      { headers: SB_H }
    );
    if (r.status === 401 || r.status === 403) {
      if (!window.__avisoChave) {
        window.__avisoChave = true;
        alert('Chave ou URL do Supabase incorreta no sync.js. Confira as duas primeiras linhas do arquivo.');
      }
      return false;
    }
    if (!r.ok) return false;
    const rows = await r.json(), b = {};
    rows.forEach(x => { (b[x.day] = b[x.day] || []).push(x.slot); });
    const mudou = JSON.stringify(b) !== JSON.stringify(blocked);
    blocked = b;
    return mudou;
  } catch (e) { return false; }
}

// ---------- carregar agendamentos ----------
async function loadAppts() {
  try {
    let novos;
    if (S.adm) {
      // administrador: vê todos os agendamentos
      const pin = getPin(false);
      if (!pin) return false;
      const d = new Date(); d.setDate(d.getDate() - 60);
      const r = await call('admin_get_appts', { p_pin: pin, p_from: iso(d) });
      if (!r.ok) {
        const t = await r.text();
        if (t.includes('PIN incorreto')) pinErrado();
        return false;
      }
      novos = (await r.json()).map(toApp);
    } else {
      // cliente: vê os próprios + horários ocupados (sem dados de outros)
      const rb = await call('get_busy', { p_from: iso(new Date()) });
      if (!rb.ok) return false;
      const ocupados = await rb.json();
      let proprios = [];
      if (client) {
        const rm = await call('get_my_appts', { p_wa: client.wa });
        if (!rm.ok) return false;
        proprios = (await rm.json()).map(toApp);
      }
      const meus = new Set(
        proprios.filter(a => a.status !== 'cancelado').map(a => a.date + '|' + a.time)
      );
      const outros = ocupados
        .filter(x => !meus.has(x.day + '|' + x.slot))
        .map(x => ({ id: 0, date: x.day, time: x.slot, status: 'agendado', wa: '', ghost: true }));
      novos = [...proprios, ...outros];
    }
    const mudou = JSON.stringify(novos) !== JSON.stringify(appts);
    appts = novos;
    return mudou;
  } catch (e) { return false; }
}

async function loadAll() {
  const [a, b] = await Promise.all([loadBlocked(), loadAppts()]);
  if ((a || b) && telaComDados()) render();
}

// ---------- ADMIN: bloquear / liberar horário ----------
window.togB = async function (t) {
  const day = S.bd;
  const pin = getPin(true);
  if (!pin) return;

  const antes = blocked[day] || [];
  const vaiBloquear = !antes.includes(t);
  blocked[day] = vaiBloquear ? [...antes, t] : antes.filter(x => x !== t);
  render();

  try {
    const r = await call('set_block', { p_pin: pin, p_day: day, p_slot: t, p_blocked: vaiBloquear });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('PIN incorreto')) pinErrado();
      throw new Error('falhou');
    }
    localStorage.setItem('cs_srvpin', pin);
  } catch (e) {
    blocked[day] = antes;
    render();
    alert('Não consegui salvar o bloqueio. Confira a internet e o PIN.');
  }
};

// ---------- ADMIN: concluir / cancelar agendamento ----------
window.setSt = async function (id, st) {
  const pin = getPin(true);
  if (!pin) return;
  try {
    const r = await call('admin_set_status', { p_pin: pin, p_id: id, p_status: st });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('PIN incorreto')) pinErrado();
      throw new Error('falhou');
    }
    localStorage.setItem('cs_srvpin', pin);
  } catch (e) {
    alert('Não consegui salvar. Confira a internet e o PIN.');
    return;
  }
  const a = appts.find(x => x.id === id);
  if (a) a.status = st;
  render();
};

// ---------- CLIENTE: confirmar agendamento ----------
window.confirmB = async function (free) {
  const a = {
    id: Date.now(), date: S.date, time: S.time, svc: S.svc.name, svcId: S.svc.id,
    cut: S.svc.cut, price: free ? 0 : S.svc.price, dur: S.svc.dur,
    name: client.name, wa: client.wa, free: !!free, status: 'agendado'
  };
  if (busy(a.date, a.time) || isBlk(a.date, a.time)) { S.step = 'time'; return render(); }

  try {
    const r = await call('book_appt', {
      p_id: a.id, p_day: a.date, p_slot: a.time, p_svc: a.svc, p_svc_id: a.svcId,
      p_cut: a.cut, p_price: a.price, p_dur: a.dur, p_name: a.name, p_wa: a.wa, p_free: a.free
    });
    if (!r.ok) {
      const txt = await r.text();
      if (txt.includes('HORARIO_INDISPONIVEL')) {
        alert('Esse horário acabou de ser ocupado. Escolha outro.');
        await loadAll();
        S.step = 'time';
        return render();
      }
      throw new Error('falhou');
    }
  } catch (e) {
    alert('Não consegui agendar. Confira sua internet e tente de novo.');
    return;
  }
  appts.push(a);
  S.last = a;
  S.step = 'ok';
  render();
};

// ---------- carrega assim que o admin entra no painel ----------
let admCarregado = false;
const _render = render;
window.render = function () {
  _render();
  if (S.adm && !admCarregado) { admCarregado = true; loadAll(); }
  if (!S.adm) admCarregado = false;
};

loadAll();
setInterval(loadAll, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAll(); });
