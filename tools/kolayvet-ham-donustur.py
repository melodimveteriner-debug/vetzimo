"""KolayVET ham veri dosyasını (kolayvet_ham_veri.json) VetZimo aktarım parçalarına çevirir.

Ağa hiçbir veri göndermez. Çıktı klasörüne sıralı parça dosyaları (01-…json, 02-…json …) ve bir rapor yazar.
Parçalar Merkez paneli › Bayi › Veri aktarımı ekranından sırayla (çoklu seçimle) içe aktarılır; aynı dosya tekrar
yüklenirse kayıtlar yinelenmez (kaynak kimlikleri sabit VetZimo kimliklerine dönüşür).

Kullanım:  python3 tools/kolayvet-ham-donustur.py kolayvet_ham_veri.json cikti-klasoru
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

PART_BYTES = 3_500_000          # sunucu sınırı 16 MB; parçalar hızlı önizleme için küçük tutulur
TODAY = date.today().isoformat()


def s(v):
    """Değeri temiz metne çevirir (None/False/'-' boş)."""
    if v is None or v is False:
        return ''
    if isinstance(v, dict):
        v = v.get('metin') if 'metin' in v else v.get('deger')
        return s(v)
    t = str(v).strip()
    return '' if t in ('-', 'null', 'None', 'undefined') else re.sub(r'\s+', ' ', t)


def stamp(v):
    """KolayVET tarih-saatini ISO UTC zaman damgasına çevirir (Türkiye saati UTC+3); saat yoksa boş döner."""
    t = s(v)
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?', t) or re.match(r'(\d{2})[./-](\d{2})[./-](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?', t)
    if not m:
        return ''
    g = m.groups()
    y, mo, d = (g[0], g[1], g[2]) if len(g[0]) == 4 else (g[2], g[1], g[0])
    try:
        import datetime as _dt
        local = _dt.datetime(int(y), int(mo), int(d), int(g[3]), int(g[4]), int(g[5] or 0))
    except ValueError:
        return ''
    return (local - _dt.timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def iso(v):
    """KolayVET tarihlerini YYYY-AA-GG yapar; geçersiz/0000 tarihleri boş döner."""
    t = s(v)
    if not t:
        return ''
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', t) or None
    if m:
        y, mo, d = m.groups()
    else:
        m = re.match(r'(\d{1,2})[./-](\d{1,2})[./-](\d{4})', t)
        if not m:
            return ''
        d, mo, y = m.groups()
    try:
        out = date(int(y), int(mo), int(d)).isoformat()
    except ValueError:
        return ''
    return out if '1900-01-01' < out <= '2100-01-01' else ''


def hhmm(v):
    m = re.search(r'T?(\d{2}):(\d{2})', s(v))
    return f'{m.group(1)}:{m.group(2)}' if m else ''


def money(v):
    """'1.250,50 ₺' · '1,250.50' · '1250.5' · 125050 (kuruş değil) → '1250.50' (VetZimo biçimi)."""
    t = s(v).replace('₺', '').replace('TL', '').replace(' ', '')
    if not t:
        return ''
    if re.fullmatch(r'-?\d{1,3}(\.\d{3})+(,\d+)?', t) or re.fullmatch(r'-?\d+,\d+', t):
        t = t.replace('.', '').replace(',', '.')
    elif re.fullmatch(r'-?\d{1,3}(,\d{3})+(\.\d+)?', t):
        t = t.replace(',', '')
    try:
        n = round(float(t), 2)
    except ValueError:
        return ''
    if n < 0:
        return ''
    return ('%.2f' % n).rstrip('0').rstrip('.') if n != int(n) else str(int(n))


def cents(v):
    m = money(v)
    return int(round(float(m) * 100)) if m else 0


def from_cents(c):
    return str(c // 100) if c % 100 == 0 else '%d.%02d' % (c // 100, c % 100)


def phone(v):
    d = re.sub(r'\D', '', s(v))
    if d.startswith('90') and len(d) == 12:
        d = '0' + d[2:]
    if len(d) == 10 and d.startswith('5'):
        d = '0' + d
    return d if len(d) == 11 and d.startswith('05') else s(v)


def form(detail, key):
    return s(((detail or {}).get('form') or {}).get(key, {}).get('deger'))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', type=Path)
    ap.add_argument('output', type=Path)
    args = ap.parse_args()
    raw = json.loads(args.source.read_text(encoding='utf-8'))
    L, D, P = raw.get('listeler', {}), raw.get('detaylar', {}), raw.get('sayfalar', {})
    report = defaultdict(Counter)
    notes = defaultdict(list)
    rec = defaultdict(list)

    # ── Müşteriler
    clients = {}
    for c in L.get('musteriler', []):
        cid = s(c.get('id'))
        det = D.get('musteri', {}).get(cid) or {}
        name = s(c.get('name')) or form(det, 'name')
        if not cid or not name:
            report['clients']['atlandı: ad/kimlik yok'] += 1
            continue
        perm = lambda k: 'Var' if ((det.get('form') or {}).get(k, {}).get('deger') is True) else 'Yok'
        row = {'id': cid, 'name': name, 'phone': phone(c.get('mobile_phone') or form(det, 'mobile_phone')),
               'phone2': phone(form(det, 'secondary_phone')), 'nationalId': s(c.get('tcidno')),
               'email': form(det, 'email'), 'birth': iso(form(det, 'birthday_date')),
               'city': form(det, 'sehir_id'), 'district': form(det, 'ilce_id'), 'neighborhood': form(det, 'mahalle_id'),
               'address': form(det, 'address'), 'notes': '\n'.join(x for x in (form(det, 'notes'), form(det, 'ozel_notlar')) if x),
               'profession': form(det, 'job'), 'registered': iso(c.get('created_at')) or TODAY,
               'sms': perm('allow_sms'), 'whatsapp': perm('allow_whatsapp'), 'emailPermission': perm('allow_email'),
               'notifications': perm('allow_push'), 'kind': 'Klinik müşterisi', 'source': 'KolayVET aktarımı'}
        clients[cid] = {k: v for k, v in row.items() if v != ''}
        report['clients']['aktarılacak'] += 1
    rec['clients'] = list(clients.values())

    # ── Hastalar
    patients = {}
    sexes = {'disi': 'Dişi', 'dişi': 'Dişi', 'erkek': 'Erkek'}
    for h in L.get('hastalar', []):
        hid = s(h.get('id'))
        det = D.get('hasta', {}).get(hid) or {}
        owner = s(h.get('musteri_id'))
        if owner not in clients:
            report['patients']['atlandı: sahibi bulunamadı'] += 1
            continue
        weight = form(det, 'kilo')
        dead = (det.get('form') or {}).get('olum_durum', {}).get('deger') is True
        neutered = form(det, 'kisirlastirilmis')
        note_lines = [x for x in (form(det, 'notlar'), form(det, 'ozel_notlar'), form(det, 'huyu'), form(det, 'ozelligi')) if x]
        if dead:
            note_lines.append('Vefat: ' + ' · '.join(x for x in (form(det, 'olum_tarihi'), form(det, 'olum_sebebi')) if x))
        row = {'id': hid, 'name': s(h.get('adi')) or 'Adsız', 'owner': owner,
               'species': s(h.get('tur_name')) or 'Diğer', 'breed': s(h.get('irk_name')) or 'Bilinmiyor',
               'sex': sexes.get(s(h.get('cinsiyet')).lower(), 'Bilinmiyor'), 'birth': iso(h.get('dogum_tarihi') or form(det, 'dogum_tarihi')),
               'chip': form(det, 'mikrocip_no'), 'chipDate': iso(form(det, 'mikrocip_tarihi')), 'passport': form(det, 'karne_no'),
               'color': form(det, 'renk'), 'weight': money(weight), 'blood': form(det, 'kan_grubu'),
               'food': ' '.join(x for x in (form(det, 'mama_marka'), form(det, 'mama_turu')) if x),
               'neutered': 'Evet' if neutered.lower() in ('evet', 'var') else 'Hayır' if neutered.lower() in ('hayır', 'hayir', 'yok') else 'Bilinmiyor',
               'temperament': 'Saldırgan' if form(det, 'saldirgan').lower() == 'evet' else '',
               'notes': '\n'.join(note_lines), 'warning': 'Vefat etti' if dead else '',
               'registered': iso(form(det, 'created_at')) or TODAY}
        if row['birth'] and row['birth'] > TODAY:
            row['birth'] = ''
        patients[hid] = {k: v for k, v in row.items() if v != ''}
        report['patients']['aktarılacak'] += 1
    rec['patients'] = list(patients.values())

    # ── Tedarikçiler
    for t in (P.get('tedarikciler') or {}).get('kayitlar', []):
        if s(t.get('id')) and s(t.get('name')):
            rec['suppliers'].append({'id': 'sup-' + s(t['id']), 'name': s(t['name'])})
    report['suppliers']['aktarılacak'] = len(rec['suppliers'])

    # ── Ürünler ve hizmetler
    for u in L.get('urunler', []):
        if not s(u.get('id')) or not s(u.get('name')):
            continue
        stock = re.sub(r'\D', '', s(u.get('stock')).split('.')[0]) or '0'
        rec['products'].append({k: v for k, v in {
            'id': 'u-' + s(u['id']), 'name': s(u['name']), 'category': s(u.get('category')) or 'Genel',
            'brand': s(u.get('marka')), 'barcode': s(u.get('barcode')), 'price': money(u.get('sale_price_float')) or '0',
            'buy': money(u.get('purchase_price_float')), 'stock': stock if u.get('stock_tracker') else '0',
            'min': re.sub(r'\D', '', s(u.get('critical_stock'))), 'unit': s(u.get('unit')) or 'Adet',
            'track': 'Evet' if u.get('stock_tracker') else 'Hayır', 'vat': '0', 'taxMode': 'KDV Dahil'}.items() if v != ''})
    for h in L.get('hizmetler', []):
        if s(h.get('id')) and s(h.get('name')):
            rec['products'].append({'id': 'h-' + s(h['id']), 'name': s(h['name']), 'category': 'Hizmet',
                                    'price': money(h.get('price')) or '0', 'stock': '0', 'track': 'Hayır', 'unit': 'Adet', 'vat': '0', 'taxMode': 'KDV Dahil'})
    report['products']['aktarılacak'] = len(rec['products'])

    # ── Aşı tanımları ve aşı kayıtları
    def unit(v):
        # "aylık", "ay", "yıllık", "yil", "gün", "hafta" → VetZimo birimleri (sonraki aşı tarihi bunlarla hesaplanır)
        t = s(v).lower().translate(str.maketrans('ıüöşçğİ', 'iuoscgi'))
        for prefix, name in (('gun', 'Gün'), ('day', 'Gün'), ('haf', 'Hafta'), ('week', 'Hafta'), ('ay', 'Ay'), ('mon', 'Ay'), ('yil', 'Yıl'), ('year', 'Yıl')):
            if t.startswith(prefix):
                return name
        return s(v)
    catalog = {}
    for a in (P.get('asi_tanimlari') or {}).get('kayitlar', []):
        if s(a.get('id')) and s(a.get('asi_adi')):
            catalog[s(a['id'])] = {'id': s(a['id']), 'name': s(a['asi_adi']), 'species': s(a.get('tur_name')),
                                   'renewEvery': s(a.get('yenileme_araligi')), 'renewUnit': unit(a.get('yenileme_formati'))}
    for a in L.get('asilar', []):
        vid = s(a.get('asi_id'))
        if vid and vid not in catalog and s(a.get('asi_adi')):
            catalog[vid] = {'id': vid, 'name': s(a['asi_adi'])}
    rec['vaccineCatalog'] = [{k: v for k, v in c.items() if v} for c in catalog.values()]
    for a in L.get('asilar', []):
        pid = s(a.get('hasta_id'))
        if pid not in patients:
            report['followups']['atlandı: hasta bulunamadı'] += 1
            continue
        planned = iso(a.get('tarih'))
        done = iso(a.get('yapilma_tarihi')) if s(a.get('status')) == 'yapildi' else ''
        if s(a.get('status')) == 'yapildi' and not done:
            done = planned
        if not planned and not done:
            report['followups']['atlandı: tarih yok'] += 1
            continue
        rec['followups'].append({k: v for k, v in {
            'id': 'a-' + s(a.get('id')), 'patient': pid, 'title': s(a.get('asi_adi')) or 'Aşı', 'date': planned or done,
            'done': done, 'vaccine': s(a.get('asi_id')) if s(a.get('asi_id')) in catalog else '',
            'status': 'Tamamlandı' if done else 'Planlandı', 'clinician': s(a.get('personel_name')), 'batch': s(a.get('seri_no'))}.items() if v != ''})
    report['vaccineCatalog']['aktarılacak'] = len(rec['vaccineCatalog'])
    report['followups']['aktarılacak'] = len(rec['followups'])

    # ── Randevular
    status_map = {'Görüşüldü': 'Tamamlandı', 'İptal Edildi': 'İptal', 'Bekliyor': 'Bekliyor'}
    for r in L.get('randevular', []):
        d = iso(r.get('start'))
        if not d:
            report['appointments']['atlandı: tarih yok'] += 1
            continue
        cid, pid = s(r.get('musteri_id')), s(r.get('hasta_id'))
        st = status_map.get(s(r.get('status_name')), 'Bekliyor')
        if st == 'Bekliyor' and d < TODAY:
            st = 'Gelmedi'
        rec['appointments'].append({k: v for k, v in {
            'id': 'r-' + s(r.get('id')), 'date': d, 'time': hhmm(r.get('start')) or '09:00', 'endTime': hhmm(r.get('end')),
            'client': cid if cid in clients else '', 'patient': pid if pid in patients and patients[pid]['owner'] == cid else '',
            'clinician': s(r.get('personel_name')), 'service': s(r.get('hizmet_name')) or 'Randevu', 'status': st,
            'notes': s(r.get('notes'))}.items() if v != ''})
    report['appointments']['aktarılacak'] = len(rec['appointments'])

    # ── Muayeneler (detay formlarından)
    for mid, m in (D.get('muayene') or {}).items():
        row = next((x for x in L.get('muayeneler', []) if s(x.get('id')) == mid), {})
        pid = s(row.get('hasta_id'))
        if pid not in patients:
            report['exams']['atlandı: hasta bulunamadı'] += 1
            continue
        w = form(m, 'agirlik')
        wkg = money(str(float(w) / 1000)) if re.fullmatch(r'\d{3,6}', w or '') else money(w)
        complaint = form(m, 'sikayet') or s(row.get('sikayet'))
        rec['exams'].append({k: v for k, v in {
            'id': 'm-' + mid, 'patient': pid, 'date': iso(form(m, 'tarih')) or iso(row.get('tarih')) or TODAY,
            'title': complaint[:120] or 'Muayene', 'complaint': complaint, 'temperature': form(m, 'derece'),
            'pulse': form(m, 'nabiz'), 'respiratory': form(m, 'solunum'), 'weight': wkg, 'plan': form(m, 'tedavi'),
            'status': 'Tamamlandı'}.items() if v != ''})
    report['exams']['aktarılacak'] = len(rec['exams'])

    # ── Satışlar (kalemleriyle) ve tahsilatlar
    sales = {}
    for x in L.get('satislar', []):
        sid = s(x.get('id'))
        d = iso(x.get('date'))
        amount = int(s(x.get('total_price2')) or 0) if re.fullmatch(r'\d+', s(x.get('total_price2'))) else cents(x.get('total_price'))
        if not sid or not d or amount <= 0:
            report['sales']['atlandı: tutar/tarih yok'] += 1
            continue
        cid = s((x.get('recipient') or {}).get('id'))
        lines, gross = [], 0
        for it in ((D.get('satis_kalem') or {}).get(sid) or {}).get('data') or []:
            q = s(it.get('quantity'))
            price = cents(it.get('unit_price'))
            if not re.fullmatch(r'[1-9]\d{0,6}', q) or not s(it.get('name')):
                lines = None
                break
            disc = cents(it.get('discount_price'))
            lines.append({'name': s(it['name'])[:200], 'quantity': q, 'price': from_cents(price), 'vat': '0', 'taxMode': 'KDV Dahil',
                          'stock': 'Hayır', **({'discountAmount': from_cents(disc)} if disc and disc <= price * int(q) else {})})
            gross += price * int(q) - (disc if disc and disc <= price * int(q) else 0)
        sale = {'id': 's-' + sid, 'date': d, 'createdAt': stamp(x.get('date')), 'amount': from_cents(amount), 'paid': '0', 'method': 'Nakit',
                'client': cid if cid in clients else '', 'detail': s(x.get('name'))[:200] or 'KolayVET satışı'}
        if lines and len(lines) <= 30 and gross == amount:
            sale['items'] = json.dumps(lines, ensure_ascii=False)
        elif lines and len(lines) <= 30 and gross > amount:
            sale['items'] = json.dumps(lines, ensure_ascii=False)
            sale['discount'] = from_cents(gross - amount)
            sale['discountType'] = 'GenelToplamTL'
            report['sales']['kalem toplamı > satış: genel indirim eklendi'] += 1
        else:
            sale['items'] = json.dumps([{'name': sale['detail'], 'quantity': '1', 'price': from_cents(amount), 'vat': '0', 'taxMode': 'KDV Dahil', 'stock': 'Hayır'}], ensure_ascii=False)
            report['sales']['kalem uyuşmadı: tek kalem olarak alındı'] += 1
        # İndirim adayları: satış kaydındaki indirim alanları ve (varsa) farklı ikinci toplam alanı. Kaynakta indirim
        # tutardan düşülmemişse müşteri yalnız indirimli tutarı öder; fark sonradan "borç" görünmesin diye aşağıda
        # tahsilat toplamıyla birebir doğrulanarak düzeltilir.
        cands = set()
        for k, v in x.items():
            if isinstance(v, (dict, list)):
                continue
            if re.search(r'discount|indirim|iskonto', k, re.I):
                d = cents(v)
                if 0 < d < amount:
                    cands.add(d)
        alt = cents(x.get('total_price'))
        if 0 < alt < amount:
            cands.add(amount - alt)
        sales[sid] = (sale, amount, lines if lines and len(lines) <= 30 else None, gross, cands)
    paid = Counter()
    method_map = {'Nakit': 'Nakit', 'Kredi Kartı': 'Kart', 'Banka Kartı': 'Kart', 'Havale & Eft': 'Havale', 'Çek - Senet': 'Çek / Senet', 'Diğer': 'Diğer'}
    last_method = {}
    for t in sorted(L.get('tahsilatlar', []), key=lambda r: s(r.get('received_date')) or s(r.get('date'))):
        oid = s(t.get('order_id'))
        amt = cents(t.get('price2') or t.get('price'))
        if oid not in sales:
            report['collections']['atlandı: satış bulunamadı'] += 1
            continue
        if amt <= 0:
            report['collections']['atlandı: tutar 0'] += 1
            continue
        sale, total = sales[oid][0], sales[oid][1]
        if paid[oid] + amt > total:
            amt = total - paid[oid]
            report['collections']['fazla tahsilat kırpıldı'] += 1
            if amt <= 0:
                continue
        d = max(iso(t.get('received_date')) or iso(t.get('date')) or sale['date'], sale['date'])
        paid[oid] += amt
        last_method[oid] = method_map.get(s(t.get('payment_method')), 'Diğer')
        rec['collections'].append({k: v for k, v in {'id': 't-' + s(t.get('id')), 'sale': 's-' + oid, 'date': d, 'createdAt': stamp(t.get('date') or t.get('created_at')),
                                                     'amount': from_cents(amt), 'method': last_method[oid], 'notes': s(t.get('notes'))}.items() if v != ''})
    # Kaynakta indirim satış tutarından düşülmemiş satışlar: tahsilat toplamı = tutar − indirim ise satış indirimli tutarla alınır.
    for oid, (sale, total, lines, gross, cands) in list(sales.items()):
        got = paid[oid]
        if 0 < got < total and (total - got) in cands:
            sale['amount'] = from_cents(got)
            if lines and gross >= got:
                sale['items'] = json.dumps(lines, ensure_ascii=False)
                sale.pop('discount', None); sale.pop('discountType', None)
                if gross > got:
                    sale['discount'] = from_cents(gross - got)
                    sale['discountType'] = 'GenelToplamTL'
            else:
                sale['items'] = json.dumps([{'name': sale['detail'], 'quantity': '1', 'price': from_cents(total), 'vat': '0', 'taxMode': 'KDV Dahil',
                                             'stock': 'Hayır', 'discountAmount': from_cents(total - got)}], ensure_ascii=False)
            sales[oid] = (sale, got, lines, gross, cands)
            report['sales']['satış indirimi tutardan düşüldü (sahte borç önlendi)'] += 1
    for oid, (sale, *_rest) in sales.items():
        if oid in last_method:
            sale['method'] = last_method[oid]
        rec['sales'].append({k: v for k, v in sale.items() if v != ''})
    report['sales']['aktarılacak'] = len(rec['sales'])
    report['collections']['aktarılacak'] = len(rec['collections'])
    open_total = sum(v[1] - paid[o] for o, v in sales.items())

    # Kimliklere tablo öneki (aynı numara farklı tablolarda çakışmasın)
    pref = {'clients': 'c-', 'patients': 'p-', 'vaccineCatalog': 'v-'}
    for kind, rows in rec.items():
        for r in rows:
            if kind in pref:
                r['id'] = pref[kind] + r['id']
            for f, k in (('owner', 'clients'), ('client', 'clients'), ('patient', 'patients'), ('vaccine', 'vaccineCatalog')):
                if r.get(f) and not str(r[f]).startswith(pref[k]):
                    r[f] = pref[k] + r[f]

    # Sıralı parçalar
    args.output.mkdir(parents=True, exist_ok=True)
    order = ['clients', 'patients', 'suppliers', 'products', 'vaccineCatalog', 'followups', 'appointments', 'exams', 'sales', 'collections']
    parts, current, size = [], {}, 0
    for kind in order:
        for r in rec.get(kind, []):
            b = len(json.dumps(r, ensure_ascii=False).encode()) + 2
            if size + b > PART_BYTES and current:
                parts.append(current)
                current, size = {}, 0
            current.setdefault(kind, []).append(r)
            size += b
    if current:
        parts.append(current)
    for i, part in enumerate(parts, 1):
        (args.output / f'{i:02d}-kolayvet-aktarim.json').write_text(
            json.dumps({'format': 'vetnet-kolayvet-v1', 'part': i, 'parts': len(parts), 'records': part}, ensure_ascii=False), encoding='utf-8')
    lines = ['KolayVET → VetZimo dönüşüm raporu', '=' * 34, f'Kaynak: {raw.get("aktarim_bilgisi", {}).get("kaynak", "")}  ·  Tarih: {raw.get("aktarim_bilgisi", {}).get("tarih", "")}', '']
    for kind in order:
        c = report.get(kind, Counter())
        lines.append(f'{kind:15} ' + ' · '.join(f'{k}: {v}' for k, v in c.items()))
    lines += ['', f'Açık bakiye (tahsil edilmemiş satış toplamı): {from_cents(open_total)} TL',
              f'Parça sayısı: {len(parts)} (sırayla yükleyin)', '',
              'Aktarılmayanlar: alış faturaları (25), laboratuvar/doküman dosyaları (KolayVET sunucusundaki görseller indirilemedi), kasa, konaklama, reçete (boş).']
    (args.output / 'RAPOR.txt').write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
