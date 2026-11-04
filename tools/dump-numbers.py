# 把 Numbers 表格的每个单元格（值和公式）导出成 JSON，给 migrate-numbers.mjs 用。
# 用法（在仓库外面建一个虚拟环境）：
#   python3 -m venv /tmp/np && /tmp/np/bin/pip install numbers-parser
#   /tmp/np/bin/python tools/dump-numbers.py "Shared Utilities.numbers" /tmp/dump.json
# 输出含有姓名和金额，请放在仓库外面。
# 使用 rows() 读取原始行号；不触发分组显示行映射，避免残留分类行 id 导致 KeyError。
import sys, json, datetime, decimal
from numbers_parser import Document

doc = Document(sys.argv[1])
out = []
def comment_data(comment):
    return {'text': comment.text, 'author': comment.author,
            'createdAt': comment.creation_date.isoformat(),
            'replies': [comment_data(reply) for reply in comment.replies]}

def column_name(index):
    name = ''
    while index >= 0:
        name = chr(65 + index % 26) + name
        index = index // 26 - 1
    return name

for sh in doc.sheets:
    for tb in sh.tables:
        rows = []
        comments = []
        for r, cells in enumerate(tb.rows()):
            row = []
            for c in range(tb.num_cols):
                cell = cells[c]
                v = cell.value
                if isinstance(v, (datetime.datetime, datetime.date)): v = v.isoformat()
                elif isinstance(v, datetime.timedelta): v = str(v)
                elif isinstance(v, decimal.Decimal): v = float(v)
                f = getattr(cell, 'formula', None)
                row.append({'v': v, 'f': f} if f else v)
                if cell.comments:
                    comments.append({'row': r, 'column': c, 'cell': column_name(c) + str(r + 1),
                                     'comments': [comment_data(x) for x in cell.comments]})
            rows.append(row)
        out.append({'sheet': sh.name, 'table': tb.name, 'rows': tb.num_rows, 'cols': tb.num_cols,
                    'header_rows': tb.num_header_rows, 'header_cols': tb.num_header_cols, 'data': rows,
                    'comments': comments})
with open(sys.argv[2], 'w', encoding='utf-8') as output:
    json.dump(out, output, ensure_ascii=False, indent=0, default=str)
for t in out: print(t['sheet'], '|', t['table'], '|', t['rows'], 'x', t['cols'], '| comments:', len(t['comments']))
