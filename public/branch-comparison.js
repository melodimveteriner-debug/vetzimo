// The caller supplies the dealer's already authorised workspace snapshot.
export function compareBranches({ dealer, reports, salesAccess, collectionsAccess, state, from, to, method = '', inPeriod, cents }) {
  if (!dealer || !reports || !salesAccess || !collectionsAccess) return [];
  const active = state.branches.filter(branch => branch.status !== 'Pasif');
  if (active.length < 2) return [];

  // Shared branches persist transactions under one data branch. Never attribute
  // a shared ledger's turnover twice, or guess at a physical point of sale.
  const groups = new Map();
  for (const branch of active) {
    const id = branch.sharedWith || branch.id;
    if (!groups.has(id)) groups.set(id, { names: [], transactions: 0, turnover: 0, receipts: 0 });
    groups.get(id).names.push(branch.name);
  }

  const included = row => groups.has(row.branch) && inPeriod(row, from, to) && (!method || method === row.method);
  for (const sale of state.sales) {
    if (!included(sale)) continue;
    const group = groups.get(sale.branch);
    group.transactions++;
    group.turnover += cents(sale.amount);
    group.receipts += cents(sale.paid);
  }
  for (const collection of state.collections) {
    if (collection.method !== "Borç silme" && collection.method !== "İndirim" && included(collection)) groups.get(collection.branch).receipts += cents(collection.amount);
  }
  return Array.from(groups.values());
}

export function branchComparisonPanel(rows, { panel, text, escape, money, count }) {
  if (!rows.length) return '';
  const headers = ['Şube', 'Satış adedi', 'KDV dahil satış', 'Dönemde alınan tahsilat'];
  const grouped = rows.some(row => row.names.length > 1);
  const help = grouped ? '<p class="muted">' + text('Ortak kayıt kullanan şubeler aynı satırda gösterilir.') + '</p>' : '';
  const table = '<div class="table-wrap" role="region" tabindex="0" aria-label="' + text('Şube karşılaştırması') + '"><table><thead><tr>' +
    headers.map(label => '<th scope="col">' + text(label) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(row => '<tr><th scope="row" data-ui-preserve><bdi>' + row.names.map(escape).join(' / ') + '</bdi></th><td>' +
      count.format(row.transactions) + '</td><td>' + escape(money(row.turnover / 100)) + '</td><td>' + escape(money(row.receipts / 100)) + '</td></tr>').join('') +
    '</tbody></table></div>';
  return panel('Şube karşılaştırması', 'Seçili dönemin satışları ve tahsilatları', table + help);
}
