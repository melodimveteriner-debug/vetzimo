"""Combine mapped CSV exports without sending any data over the network."""
import argparse
import csv
import json
from pathlib import Path

TABLES = ('clients', 'patients', 'suppliers', 'products', 'vaccineCatalog',
          'followups', 'stockLots', 'stockMoves')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('folder', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
records = {}
for table in TABLES:
    path = args.folder / (table + '.csv')
    if not path.is_file():
        continue
    with path.open(encoding='utf-8-sig', newline='') as file:
        sample = file.read(8192)
        file.seek(0)
        header = sample.splitlines()[0] if sample else ''
        delimiter = ';' if header.count(';') > header.count(',') else ','
        reader = csv.DictReader(file, delimiter=delimiter)
        if not reader.fieldnames or 'id' not in reader.fieldnames:
            parser.error(f'{path.name}: id sütunu gerekli')
        for row in reader:
            if None in row or None in row.values():
                parser.error(f'{path.name}: satır {reader.line_num} sütun sayısı hatalı')
            records.setdefault(table, []).append({
                key: value for key, value in row.items()
                if not any(word in key.casefold() for word in ('password', 'passwd', 'sifre', 'şifre', 'token', 'secret'))
            })
if not records:
    parser.error('Aktarılabilir CSV kaydı bulunamadı')
with args.output.open('x', encoding='utf-8') as file:
    json.dump({'format': 'vetnet-kolayvet-v1', 'records': records}, file, ensure_ascii=False)
