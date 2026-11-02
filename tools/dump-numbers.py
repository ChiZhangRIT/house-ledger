# 把 Numbers 表格的每个单元格（值和公式）导出成 JSON，给 migrate-numbers.mjs 用。
# 用法（在仓库外面建一个虚拟环境）：
#   python3 -m venv /tmp/np && /tmp/np/bin/pip install numbers-parser
#   /tmp/np/bin/python tools/dump-numbers.py "Shared Utilities.numbers" /tmp/dump.json
# 输出含有姓名和金额，请放在仓库外面。
# 注意：numbers-parser 4.22 遇到表格里残留的行 id 会报 KeyError（calculate_table_categories），
# 这时把 numbers_parser/model.py 里用 row_uuid_to_offset[uuid] 取值的两处改成跳过不认识的 id 即可。
import sys, json, datetime, decimal
from numbers_parser import Document

doc = Document(sys.argv[1])
out = []
for sh in doc.sheets:
    for tb in sh.tables:
        rows = []
        for r in range(tb.num_rows):
            row = []
            for c in range(tb.num_cols):
                cell = tb.cell(r, c)
                v = cell.value
                if isinstance(v, (datetime.datetime, datetime.date)): v = v.isoformat()
                elif isinstance(v, datetime.timedelta): v = str(v)
                elif isinstance(v, decimal.Decimal): v = float(v)
                f = getattr(cell, 'formula', None)
                row.append({'v': v, 'f': f} if f else v)
            rows.append(row)
        out.append({'sheet': sh.name, 'table': tb.name, 'rows': tb.num_rows, 'cols': tb.num_cols,
                    'header_rows': tb.num_header_rows, 'header_cols': tb.num_header_cols, 'data': rows})
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0, default=str)
for t in out: print(t['sheet'], '|', t['table'], '|', t['rows'], 'x', t['cols'])
