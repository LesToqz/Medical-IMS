// public/app.js — lightweight client glue

async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); }
async function postJSON(url, body) {
  const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if (!r.ok) throw new Error(await r.text()); return r.json();
}

document.addEventListener('DOMContentLoaded', async () => {
  const path = location.pathname.toLowerCase();

  // -------- Overview (index.html)
  if (path.endsWith('/') || path.endsWith('/index.html')) {
    try {
      const stats = await getJSON('/api/stats?days=30');
      // Fill Quick Stats numbers if they exist (by order in DOM)
      const vals = document.querySelectorAll('.stat .value');
      if (vals.length >= 4) {
        vals[0].textContent = stats.total_items ?? '—';
        vals[1].textContent = stats.units_in_stock ?? '—';
        vals[2].textContent = stats.low_stock ?? '—';
        vals[3].textContent = stats.expiring_soon ?? '—';
      }
      // Recent transactions table (if present)
      const tbody = document.querySelector('section.card.recent tbody, section.card:nth-of-type(3) tbody');
      if (tbody) {
        const tx = await getJSON('/api/transactions?limit=10');
        tbody.innerHTML = tx.map(t => `
          <tr>
            <td>${new Date(t.ts ?? t.time ?? Date.now()).toLocaleString()}</td>
            <td><span class="pill ${t.type==='RECEIVE'?'ok':'warn'}">${t.type}</span></td>
            <td>${t.sku ?? ''}</td>
            <td>${t.lot_no ?? ''}</td>
            <td>${t.expiry ?? ''}</td>
            <td style="text-align:right">${t.qty_change > 0 ? '+'+t.qty_change : t.qty_change}</td>
          </tr>`).join('');
      }
    } catch(e){ console.warn('Overview load failed:', e.message); }
  }

  // -------- Items (items.html)
  if (path.endsWith('/items.html')) {
    // Form: give inputs "name", "sku", "category", "unit", "min_level" in markup
    const form = document.querySelector('form');
    const tableBody = document.querySelector('table tbody');
    const search = document.querySelector('.actions input');

    async function load(searchText='') {
      const rows = await getJSON('/api/items' + (searchText?`?search=${encodeURIComponent(searchText)}`:''));
      tableBody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.sku}</td><td>${r.name}</td><td>${r.category ?? ''}</td>
          <td>${r.unit ?? ''}</td><td>${r.current_stock}</td><td>${r.min_level}</td>
          <td>${r.current_stock < r.min_level ? 'LOW' : 'OK'}</td>
        </tr>`).join('');
    }
    load();

    form?.addEventListener('submit', e => e.preventDefault());
    form?.querySelector('button')?.addEventListener('click', async () => {
      const payload = {
        name: form.querySelector('input[placeholder="Paracetamol 500mg"]')?.value || '',
        sku: form.querySelector('input[placeholder="PARA-500"]')?.value || '',
        category: form.querySelector('input[placeholder="Tablets"]')?.value || null,
        unit: form.querySelector('input[placeholder="strip"]')?.value || null,
        min_level: Number(form.querySelector('input[type="number"]')?.value || 0)
      };
      await postJSON('/api/items', payload);
      form.reset();
      load(search?.value || '');
    });

    search?.addEventListener('input', () => load(search.value));
    document.querySelector('.actions button')?.addEventListener('click', () => load(search?.value || ''));
  }

  // -------- Receive (receive.html)
  if (path.endsWith('/receive.html')) {
    const form = document.querySelector('form');
    const tbody = document.querySelector('table tbody');
    async function reloadTx() {
      const rows = await getJSON('/api/transactions?limit=10');
      tbody.innerHTML = rows
        .filter(t => t.type === 'RECEIVE')
        .map(t => `<tr><td>${new Date(t.ts).toLocaleString()}</td><td>${t.sku}</td><td>${t.lot_no}</td><td>${t.expiry}</td><td>+${t.qty_change}</td><td>${t.location ?? ''}</td></tr>`)
        .join('');
    }
    reloadTx();

    form?.addEventListener('submit', e => e.preventDefault());
    form?.querySelector('button')?.addEventListener('click', async () => {
      const payload = {
        sku: form.querySelector('input[placeholder="PARA-500"]')?.value || '',
        lot_no: form.querySelector('input[placeholder="LOT-2025-01"]')?.value || '',
        expiry_date: form.querySelector('input[type="date"]')?.value || '',
        quantity: Number(form.querySelector('input[type="number"]')?.value || 0),
        location: form.querySelector('input[placeholder^="Aisle"]')?.value || null
      };
      await postJSON('/api/receive', payload);
      form.reset();
      reloadTx();
    });
  }

  // -------- Dispatch (dispatch.html)
  if (path.endsWith('/dispatch.html')) {
    const form = document.querySelector('form');
    const tbody = document.querySelector('table tbody');

    async function reloadAlerts() {
      const rows = await getJSON('/api/alerts?days=30');
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${r.sku}</td><td>${r.name}</td><td>${r.stock}</td><td>${r.min_level}</td>
          <td>${r.earliest_expiry ?? '—'}</td>
          <td>${r.stock <= 0 ? 'OUT' : (r.stock < r.min_level ? 'LOW' : 'OK')}</td>
        </tr>`).join('');
    }
    reloadAlerts();

    form?.addEventListener('submit', e => e.preventDefault());
    form?.querySelector('button')?.addEventListener('click', async () => {
      const payload = {
        sku: form.querySelector('input[placeholder="PARA-500"]')?.value || '',
        quantity: Number(form.querySelector('input[type="number"]')?.value || 0),
        reason: form.querySelector('input[placeholder^="Issued"]')?.value || null
      };
      await postJSON('/api/dispatch', payload);
      form.reset();
      reloadAlerts();
    });
  }
});
